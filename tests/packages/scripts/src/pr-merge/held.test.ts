import { describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { heldOf, readHeld } from "../../../../../packages/scripts/src/pr-merge/held"

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
