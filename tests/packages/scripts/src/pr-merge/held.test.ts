import { describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  endFreeze,
  FREEZE_LAPSE_MS,
  heldOf,
  readHeld,
  startFreeze,
} from "../../../../../packages/scripts/src/pr-merge/held"

const REPO = "acme/archive"
const file = (held: unknown) => JSON.stringify({ held })

describe("heldOf", () => {
  test("names the reason the file gives for this PR", () => {
    const text = file({ "acme/archive#742": "held for Merritt's tooltip notes (builder)" })
    expect(heldOf(text, REPO, 742)).toBe("held for Merritt's tooltip notes (builder)")
  })

  test("holds nothing when the file is missing or lists the PR in another repo or by another number", () => {
    expect(heldOf(null, REPO, 742)).toBeNull()
    const text = file({
      "acme-labs/acme-app#742": "x",
      "acme/archive#743": "y",
    })
    expect(heldOf(text, REPO, 742)).toBeNull()
  })

  test('a "*" key holds every PR with its reason, and a PR\'s own line keeps its own', () => {
    const text = file({ "*": "merges held until v0.0.35 ships", "acme/archive#9": "own reason" })
    expect(heldOf(text, REPO, 742)).toBe("merges held until v0.0.35 ships")
    expect(heldOf(text, "acme-labs/acme-app", 1)).toBe("merges held until v0.0.35 ships")
    expect(heldOf(text, REPO, 9)).toBe("own reason")
    expect(heldOf(file({ "*": "" }), REPO, 1)).toBe("no reason given")
  })

  test("refuses every PR when the file does not read, so a hold is never lost to a typo", () => {
    for (const text of ["{", file(["acme/archive#742"]), JSON.stringify({ prs: {} })]) {
      expect(heldOf(text, REPO, 1)).toStartWith("held-prs.json does not read")
    }
  })

  test("holds a listed PR whose reason is empty or not text, saying no reason was given", () => {
    expect(heldOf(file({ "acme/archive#9": "" }), REPO, 9)).toBe("no reason given")
    expect(heldOf(file({ "acme/archive#9": 1 }), REPO, 9)).toBe("no reason given")
  })
})

test("readHeld reads the file at the path, a missing file holding nothing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "held-"))
  const path = join(dir, "held-prs.json")
  expect(await readHeld(path, REPO, 742)).toBeNull()
  writeFileSync(path, file({ "acme/archive#742": "on hold" }))
  expect(await readHeld(path, REPO, 742)).toBe("on hold")
})

test("readHeld holds every PR when the path cannot be read, a folder or no permission", async () => {
  const dir = mkdtempSync(join(tmpdir(), "held-"))
  const folder = join(dir, "held-prs.json")
  mkdirSync(folder)
  expect(await readHeld(folder, REPO, 1)).toStartWith("held-prs.json does not read")
  const locked = join(dir, "locked.json")
  writeFileSync(locked, file({}))
  chmodSync(locked, 0o000)
  try {
    expect(await readHeld(locked, REPO, 1)).toStartWith("held-prs.json does not read")
  } finally {
    chmodSync(locked, 0o600)
  }
})

// a ship that stopped without clearing its "*" line would hold every PR for good, so the line lapses, while a PR's own line, which Ops removes on a lead's word, never does
describe("the ship's freeze", () => {
  const NOW = Date.parse("2026-11-03T14:00:00.000Z")
  const at = (ago: number) => new Date(NOW - ago).toISOString()
  const frozen = (ago: number, own: Record<string, string> = {}) =>
    JSON.stringify({
      held: { "*": "v0.0.38 ships: canary is frozen until its tag lands", ...own },
      since: { "*": at(ago) },
    })

  test('a fresh "*" line holds every PR, and one past the lapse holds nothing', () => {
    expect(heldOf(frozen(FREEZE_LAPSE_MS - 1), REPO, 742, NOW)).toStartWith("v0.0.38 ships")
    expect(heldOf(frozen(FREEZE_LAPSE_MS), REPO, 742, NOW)).toBeNull()
  })

  test('a PR\'s own line as old as a lapsed "*" line still holds it', () => {
    const text = frozen(FREEZE_LAPSE_MS * 3, { "acme/archive#9": "held for the owner's word" })
    expect(heldOf(text, REPO, 9, NOW)).toBe("held for the owner's word")
    expect(heldOf(text, REPO, 10, NOW)).toBeNull()
  })

  test('a "*" line with no readable time, one Ops wrote by hand, never lapses', () => {
    expect(heldOf(file({ "*": "by hand" }), REPO, 1, NOW)).toBe("by hand")
    const bad = JSON.stringify({ held: { "*": "by hand" }, since: { "*": "yesterday" } })
    expect(heldOf(bad, REPO, 1, NOW)).toBe("by hand")
  })

  test('startFreeze writes the "*" line with its time, keeping every other line, and endFreeze removes both', async () => {
    const path = join(mkdtempSync(join(tmpdir(), "held-")), "ops", "held-prs.json")
    expect(await endFreeze(path)).toBe(false)
    const reason = await startFreeze(path, "v0.0.38", new Date(NOW))
    expect(reason).toBe("v0.0.38 ships: canary is frozen until its tag lands")
    writeFileSync(
      path,
      JSON.stringify({
        ...JSON.parse(readFileSync(path, "utf8")),
        held: { "*": reason, "acme/archive#9": "own" },
      }),
    )
    await startFreeze(path, "v0.0.38", new Date(NOW + 60_000))
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      held: { "*": reason, "acme/archive#9": "own" },
      since: { "*": new Date(NOW + 60_000).toISOString() },
    })
    expect(await readHeld(path, REPO, 742)).toBe(reason)
    expect(await endFreeze(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ held: { "acme/archive#9": "own" } })
    expect(await readHeld(path, REPO, 742)).toBeNull()
  })

  test("a file that does not read is left as it is, and the freeze says why", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "held-")), "held-prs.json")
    writeFileSync(path, "{")
    await expect(startFreeze(path, "v0.0.38")).rejects.toThrow("does not read")
    await expect(endFreeze(path)).rejects.toThrow("does not read")
    expect(readFileSync(path, "utf8")).toBe("{")
  })
})
