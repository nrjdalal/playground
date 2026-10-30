import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Comment, PrFacts } from "../../../../../packages/scripts/src/pr-merge/gates"
import type { Outcome, Run, RunResult } from "../../../../../packages/scripts/src/pr-merge/merge"
import { mergeReady } from "../../../../../packages/scripts/src/pr-merge/ready"
import type { StampRead } from "../../../../../packages/scripts/src/pr-merge/stamp"
import { SKILL_BODY } from "./bodies"
import "./scratch-config"
import { SUITE, suiteChecks } from "./suite"

const scratch = mkdtempSync(join(tmpdir(), "pr-ready-"))
process.env.PLAYGROUND_MERGE_LOCK_DIR = join(scratch, "default-lock")
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const REPO = "o/r"
const OWNER = "o"
const HEAD = "a".repeat(40)
const OWN = "b".repeat(40)
const CANARY = "c".repeat(40)
const TREE = "e".repeat(40)
const ok = (stdout = ""): RunResult => ({ code: 0, stderr: "", stdout })
const said = (body: string, author = OWNER): Comment => ({
  author,
  body,
  createdAt: "2026-10-19T10:00:00.000Z",
})

// A green stamp as the walk reads it: on the head, or carried from at past clean canary merges.
const green = (at = HEAD): StampRead => ({
  at,
  passed: SUITE,
  reach: at === HEAD ? [HEAD] : [HEAD, at],
  stamps: [
    {
      at: at.slice(0, 7),
      checks: suiteChecks(),
      commit: at.slice(0, 7),
      createdAt: "2026-10-19T09:00:00.000Z",
      status: "green",
    },
  ],
  status: "green",
  why: "",
})

// A PR every gate passes at HEAD, behind canary by one commit, whose merge with canary gives TREE.
const factsOf = (over: Partial<PrFacts> = {}): PrFacts => ({
  aheadBy: 1,
  author: OWNER,
  base: "canary",
  body: SKILL_BODY,
  canary: CANARY,
  checks: [],
  comments: [said(`## ReviewBot · round 1: 5/5 at ${HEAD.slice(0, 7)} · 0 blocking`)],
  draft: false,
  files: ["packages/scripts/src/x.ts"],
  head: HEAD,
  held: null,
  lost: [],
  mergeTree: TREE,
  n: 7,
  owner: OWNER,
  stamp: green(),
  state: "OPEN",
  ...over,
})

// A stubbed gh holding one open PR, #7; it keeps each merge asked for.
function world(facts: PrFacts) {
  const merges: number[] = []
  const run: Run = async (args) => {
    const joined = args.join(" ")
    if (joined.startsWith("pr list"))
      return ok(JSON.stringify({ author: OWNER, draft: false, n: 7 }))
    return { code: 1, stderr: `unexpected gh ${joined}`, stdout: "" }
  }
  const lockRoot = mkdtempSync(join(scratch, "lock-"))
  const queue = join(lockRoot, "merge-queue.json")
  writeFileSync(queue, JSON.stringify({ queue: [{ pr: 7 }] }))
  const local = {
    facts: async () => facts,
    git: async () => ok(),
    lockRoot,
    merge: async (n: number): Promise<Outcome> => {
      merges.push(n)
      return { gates: [], kind: "merged", sha: "f".repeat(40) }
    },
    queue,
  }
  return { local, merges, ready: () => mergeReady({ repo: REPO }, run, local) }
}

describe("pr:train ready", () => {
  test("a PR whose every gate passes merges through pr:merge, naming its stamp", async () => {
    const w = world(factsOf())
    const readied = await w.ready()
    expect(w.merges).toEqual([7])
    expect(readied.merged).toMatchObject({ n: 7, why: "green @ aaaaaaa · local" })
  })

  test("a stamp carried past a clean canary merge merges with no new run", async () => {
    const w = world(factsOf({ head: HEAD, stamp: green(OWN) }))
    expect((await w.ready()).merged?.n).toBe(7)
  })

  test("the owner's draft whose only failing gate is ready still merges", async () => {
    const w = world(factsOf({ draft: true }))
    expect((await w.ready()).merged?.n).toBe(7)
  })

  test("a stamp that waits, or none, merges nothing", async () => {
    const wait = world(factsOf({ stamp: { ...green(), status: "wait" } }))
    expect(await wait.ready()).toEqual({ refused: [] })
    const none = world(factsOf({ stamp: { passed: [], reach: [HEAD], stamps: [], why: "none" } }))
    expect(await none.ready()).toEqual({ refused: [] })
    expect([...wait.merges, ...none.merges]).toEqual([])
  })

  test("a PR template body merges, and a body that is not the template holds it", async () => {
    expect((await world(factsOf({ body: SKILL_BODY })).ready()).merged?.n).toBe(7)
    const short = world(factsOf({ body: "Outcome: one line.\n" }))
    expect(await short.ready()).toEqual({ refused: [] })
    expect(short.merges).toEqual([])
  })

  test("a refusal from pr:merge is named and nothing reads as merged", async () => {
    const w = world(factsOf())
    w.local.merge = async () => ({ gates: [], holder: "12", kind: "locked" })
    const readied = await w.ready()
    expect(readied.merged).toBeUndefined()
    expect(readied.refused).toEqual([{ n: 7, why: "the merge lock is held by 12" }])
  })
})
