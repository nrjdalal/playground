import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Check } from "../../../../../packages/scripts/src/pr-merge/gates"
import {
  FREEZE_LAPSE_MS,
  freezeLine,
  startFreeze,
} from "../../../../../packages/scripts/src/pr-merge/held"
import type { Run, RunResult } from "../../../../../packages/scripts/src/pr-merge/merge"
import { gateLine, rehearsalLine } from "../../../../../packages/scripts/src/pr-merge/ship-lines"
import {
  nextVersion,
  shipFactsOf,
  shipMerge,
  shipRefusals,
  type ShipFacts,
} from "../../../../../packages/scripts/src/pr-merge/ship-merge"
import "./scratch-config"
import { greenChecks } from "./suite"

const HEAD = "a11fb8850c8304a91ab714b2ff46ad89fe7411a7"
const OTHER = "6d8ab5ace7734a46201c0061cb9e961fbd5f5aa3"
const REPO = "acme/factory"

const scratch = mkdtempSync(join(tmpdir(), "ship-merge-"))
// The suite's own held list: no test reads the factory's real one.
const HELD = join(scratch, "held-prs.json")
process.env.PLAYGROUND_HELD_PRS = HELD
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const ready = (): ShipFacts => ({
  base: "main",
  body: `Two sentences.\n\n${gateLine(HEAD, false)}\n${rehearsalLine(HEAD, "PASS")}\n\n## What ships\n`,
  checks: greenChecks(),
  freeze: freezeLine("v0.0.84"),
  head: HEAD,
  state: "OPEN",
  version: "v0.0.84",
})
const refusals = (facts: Partial<ShipFacts>) => shipRefusals({ ...ready(), ...facts })
const red = (name: string, conclusion: string): Check => ({
  ...greenChecks().find((check) => check.name === name)!,
  conclusion,
})

describe("shipRefusals (#1659)", () => {
  test("a ship PR with the pin's gate and rehearsal lines, both checks green and its freeze set may merge", () => {
    expect(shipRefusals(ready())).toEqual([])
  })

  test("(a) a body with no gate line for the pin refuses, naming the gate to run", () => {
    expect(refusals({ body: rehearsalLine(HEAD, "PASS") })).toEqual([
      expect.stringContaining(`no "${gateLine(HEAD, false)}" line`),
    ])
    expect(
      refusals({ body: `${gateLine(OTHER, false)}\n${rehearsalLine(HEAD, "PASS")}` }),
    ).toHaveLength(1)
  })

  test("(a) a FAIL gate line for the pin refuses, beside a PASS line too", () => {
    const failed = `${gateLine(HEAD, true)}\n${rehearsalLine(HEAD, "PASS")}`
    expect(refusals({ body: failed })).toEqual([expect.stringContaining("FAIL")])
    expect(refusals({ body: `${gateLine(HEAD, false)}\n${failed}` })).toHaveLength(1)
  })

  test("(b) a body with no rehearsal line for the pin refuses; a not-needed one may merge", () => {
    expect(refusals({ body: gateLine(HEAD, false) })).toEqual([
      expect.stringContaining("Invitee rehearsal at"),
    ])
    expect(
      refusals({ body: `${gateLine(HEAD, false)}\n${rehearsalLine(HEAD, "FAIL")}` }),
    ).toHaveLength(1)
    expect(
      refusals({ body: `${gateLine(HEAD, false)}\n${rehearsalLine(HEAD, "not needed")}` }),
    ).toEqual([])
  })

  test("(c) a red or a missing gate check at the pin refuses, naming it, while an other check's red does not", () => {
    expect(refusals({ checks: [red("test", "FAILURE"), greenChecks()[0]!] })).toEqual([
      expect.stringContaining("test failure"),
    ])
    expect(refusals({ checks: greenChecks().filter((c) => c.name === "test") })).toEqual([
      expect.stringContaining("Audit, Lint, and Build"),
    ])
    const other = { conclusion: "FAILURE", name: "Audit canary", status: "COMPLETED" }
    expect(refusals({ checks: [...greenChecks(), other] })).toEqual([])
  })

  test("(d) no freeze, a lapsed one or another version's refuses, naming ship:freeze", () => {
    expect(refusals({ freeze: null })).toEqual([expect.stringContaining("ship:freeze v0.0.84")])
    expect(refusals({ freeze: freezeLine("v0.0.83") })).toHaveLength(1)
    expect(refusals({ freeze: "Ops: hold for the outage" })).toHaveLength(1)
  })

  test("a PR that is not an open PR into main refuses", () => {
    expect(refusals({ base: "canary" })).toEqual([expect.stringContaining("into main")])
    expect(refusals({ state: "MERGED" })).toHaveLength(1)
  })
})

test("nextVersion takes the last tag's patch plus one, and refuses a tag that is not vX.Y.Z", () => {
  expect(nextVersion("v0.0.83")).toBe("v0.0.84")
  expect(nextVersion("v1.2.9\n")).toBe("v1.2.10")
  expect(() => nextVersion("")).toThrow("not vX.Y.Z")
})

// A gh that answers the ship PR's view, the latest tag, and the merge.
const stub = (body: string) => {
  const calls: string[][] = []
  const ok = (stdout: string): RunResult => ({ code: 0, stderr: "", stdout })
  const run: Run = async (args) => {
    calls.push(args)
    const joined = args.join(" ")
    if (joined.startsWith("pr view") && joined.includes("statusCheckRollup"))
      return ok(
        JSON.stringify({
          baseRefName: "main",
          body,
          headRefOid: HEAD,
          state: "OPEN",
          statusCheckRollup: greenChecks(),
        }),
      )
    if (joined.includes("releases/latest")) return ok("v0.0.83\n")
    if (joined.startsWith("pr merge")) return ok("")
    if (joined.includes("mergeCommit")) return ok("c400e3cb57db6a8addfabacaea06c703ae1fa964\n")
    return { code: 1, stderr: `unexpected gh ${joined}`, stdout: "" }
  }
  return { calls, run }
}

describe("shipMerge (#1659)", () => {
  test("merges with a merge commit at exactly the head it read, and returns the merge commit", async () => {
    await startFreeze(HELD, "v0.0.84")
    const { calls, run } = stub(ready().body)
    expect(await shipMerge(run, REPO, 1633)).toEqual({
      sha: "c400e3cb57db6a8addfabacaea06c703ae1fa964",
    })
    expect(calls.filter((args) => args[1] === "merge")).toEqual([
      ["pr", "merge", "1633", "-R", REPO, "--merge", "--match-head-commit", HEAD],
    ])
  })

  test("(d) a freeze read past its lapse holds nothing, so it refuses", async () => {
    const written = Date.now()
    await startFreeze(HELD, "v0.0.84", new Date(written))
    const { run } = stub(ready().body)
    expect((await shipFactsOf(run, REPO, 1633, written + 60_000)).freeze).toBe(
      freezeLine("v0.0.84"),
    )
    const late = await shipFactsOf(run, REPO, 1633, written + FREEZE_LAPSE_MS + 60_000)
    expect(late.freeze).toBeNull()
    expect(shipRefusals(late)).toEqual([expect.stringContaining('no "*" line holds')])
  })

  test("a refusal merges nothing", async () => {
    await startFreeze(HELD, "v0.0.84")
    const { calls, run } = stub(rehearsalLine(HEAD, "PASS"))
    expect(await shipMerge(run, REPO, 1633)).toEqual({ refusals: [expect.any(String)] })
    expect(calls.some((args) => args[1] === "merge")).toBe(false)
  })
})
