import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { verdictOf } from "../../../../../packages/config/src/verdicts"
import {
  gatesOf,
  type Comment,
  type PrFacts,
} from "../../../../../packages/scripts/src/pr-merge/gates"
import {
  carried,
  jobsStamp,
  stampAt,
  stampsAt,
  stampsIn,
  stampText,
  type CheckRun,
  type Reads,
  type StampKeys,
} from "../../../../../packages/scripts/src/pr-merge/stamp"
import { trainGates, trainVerdictOf } from "../../../../../packages/scripts/src/pr-merge/train"
import "./scratch-config"
import { suiteChecks } from "./suite"

const ROOT = join(import.meta.dir, "..", "..", "..", "..", "..")
const HEAD = "69a6a4c5e6caf46c4abda6a89de4ce6f3b309e88"
const OWN = "0d1e2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a"
const OLD = "5740ceaa347f9c0f4e5a2f109f433e7838468b1f"
const CANARY = "6f3db1ea4cb7ea4072e0d5454da0026c89635cab"
const OWNER = "acme-owner"

// The README's Edge cases list: each case's number and its YAML example, as the stamp's comment.
const readme = await Bun.file(join(ROOT, "packages/scripts/src/pr-merge/README.md")).text()
const section = readme.split("### Edge cases")[1]?.split("\n## ")[0] ?? ""
const examples = new Map(
  [...section.matchAll(/^(\d+)\. \*\*[^*]+\*\*:[\s\S]*?^( +)```yaml\n([\s\S]*?)^ +```$/gm)].map(
    (m) => {
      const yaml = (m[3] ?? "").replace(new RegExp(`^${m[2]}`, "gm"), "")
      return [Number(m[1]), `\`\`\`yaml\n${yaml}\`\`\``]
    },
  ),
)

const example = (n: number): StampKeys => {
  const keys = verdictOf(examples.get(n) ?? "")?.stamp
  if (!keys) throw new Error(`case ${n} has no stamp example`)
  return keys
}

let clock = 0
const said = (body: string, author = OWNER): Comment => ({
  author,
  body,
  createdAt: new Date(Date.UTC(2026, 9, 28, 20, 0, clock++)).toISOString(),
})
const stamped = (keys: StampKeys, author = OWNER) => said(stampText(keys), author)
const review = (sha: string, score = 5) =>
  said(`## ReviewBot · round 2: ${score}/5 at ${sha.slice(0, 7)} · 0 blocking`)
const suite = (sha: string, source = "18234567890") =>
  stamped({ checks: suiteChecks(source), commit: sha, status: "green" })

type Scenario = {
  aheadBy?: number
  canary?: StampKeys[]
  clean?: string[]
  comments: Comment[]
  files?: string[]
  parents?: Record<string, string[]>
}

const readsOf = ({ clean = [], parents = { [HEAD]: [OLD] } }: Scenario): Reads => ({
  clean: async (sha) => clean.includes(sha),
  onCanary: async (sha) => sha === CANARY,
  parents: async (sha) => parents[sha] ?? [],
})

const factsOf = async (scenario: Scenario): Promise<PrFacts> => ({
  aheadBy: scenario.aheadBy ?? 0,
  author: OWNER,
  base: "canary",
  canary: CANARY,
  canaryStamps: stampsAt(
    stampsIn(
      (scenario.canary ?? []).map((k) => stamped(k)),
      OWNER,
    ),
    CANARY,
  ),
  checks: [],
  comments: scenario.comments,
  draft: false,
  files: scenario.files ?? ["packages/scripts/src/pr-merge/gates.ts"],
  head: HEAD,
  held: null,
  lost: [],
  mergeTree: "1bd05088cad7c561f74d8912abe76184760003d9",
  n: 7,
  owner: OWNER,
  stamp: await stampAt(HEAD, scenario.comments, OWNER, readsOf(scenario)),
  state: "OPEN",
})

// The gates a scenario fails, by name; an empty list merges.
const failing = async (scenario: Scenario) =>
  gatesOf(await factsOf(scenario))
    .filter((gate) => !gate.ok)
    .map((gate) => gate.name)

const job = (name: string, conclusion: string | null, status = "completed"): CheckRun => ({
  conclusion,
  html_url: `https://github.com/acme/archive/actions/runs/18234567890/job/${name.length}`,
  name,
  started_at: "2026-10-28T20:00:00Z",
  status,
})
const jobs = (lint: string | null, skills: string | null, status = "completed") => [
  job("Audit, Lint, and Build", lint, status),
  job("test", skills, status),
]
const parsed = (text: string | null) => verdictOf(text ?? "")?.stamp as StampKeys

describe("the README's edge cases (#2410)", () => {
  test("lists 18 cases or more, each with one example in the stamp's final shape", () => {
    expect(examples.size).toBeGreaterThanOrEqual(18)
    for (const n of examples.keys()) expect(example(n)).toBeTruthy()
    for (const n of Array.from({ length: 18 }, (_, i) => i + 1)) expect(examples.has(n)).toBe(true)
  })

  test("1: a green stamp that passed every JOB_CHECKS name merges, from a GitHub run or a local one", async () => {
    const green = example(1)
    expect(await failing({ comments: [review(HEAD), stamped(green)] })).toEqual([])
    const local = { ...green, checks: suiteChecks("local") }
    expect(await failing({ comments: [review(HEAD), stamped(local)] })).toEqual([])
  })

  test("2: dashboard code needs verify passed; GitHub's jobs skip verify, with its comment, off the dashboard", async () => {
    const files = ["api/hono/src/routers/dashboard.ts"]
    const base = [review(HEAD), suite(HEAD)]
    expect(await failing({ comments: [...base, stamped(example(2))], files })).toEqual([])
    expect(await failing({ comments: base, files })).toEqual(["stamp"])
    const plain = parsed(jobsStamp(undefined, HEAD, jobs("success", "success"), [], false))
    expect(plain.checks.verify).toEqual({
      comment: "The diff has no dashboard code.",
      source: "18234567890",
      status: "skip",
    })
    expect(await failing({ comments: [review(HEAD), stamped(plain)] })).toEqual([])
  })

  test("3: web/next/ needs agent-drive passed, from its tester", async () => {
    const files = ["web/next/src/app/page.tsx"]
    const base = [review(HEAD), suite(HEAD), stamped(example(2))]
    expect(await failing({ comments: [...base, stamped(example(3))], files })).toEqual([])
    expect(await failing({ comments: base, files })).toEqual(["tester"])
  })

  test("4: one failed check makes the stamp red, and nothing merges", async () => {
    const files = ["api/hono/src/routers/dashboard.ts"]
    const red = [review(HEAD), suite(HEAD), stamped(example(4))]
    expect(example(4).checks.verify?.comment).toBe("The cursor check failed.")
    expect(await failing({ comments: red, files })).toEqual(["stamp"])
  })

  test("5: a queued or running job stamps wait, and the PR waits", async () => {
    expect(example(5).status).toBe("wait")
    expect(await failing({ comments: [review(HEAD), stamped(example(5))] })).toEqual([
      "stamp",
      "suite",
    ])
    for (const status of ["queued", "in_progress"])
      expect(parsed(jobsStamp(undefined, HEAD, jobs(null, null, status))).status).toBe("wait")
    const queued = parsed(jobsStamp(undefined, HEAD, jobs(null, null, "queued")))
    expect(queued.checks["test:skills"]).toEqual(example(5).checks["test:skills"])
  })

  test("6: a cancelled job stamps wait, never red", async () => {
    const cancelled = parsed(jobsStamp(undefined, HEAD, jobs("success", "cancelled")))
    expect(cancelled.status).toBe("wait")
    expect(cancelled.checks["test:skills"]).toEqual(example(6).checks["test:skills"])
    const facts = await factsOf({ comments: [review(HEAD), stamped(cancelled)] })
    expect(gatesOf(facts).find((gate) => gate.name === "stamp")?.detail).toContain("waiting for CI")
  })

  test("7: a clean merge of canary carries the stamp and the 5/5", async () => {
    const parents = { [HEAD]: [OWN, CANARY], [OWN]: [OLD] }
    const comments = [review(OWN), suite(OWN), stamped(example(7))]
    expect(await failing({ clean: [HEAD], comments, parents })).toEqual([])
  })

  test("8: a merge that is not clean needs agent-review at the new head", async () => {
    const parents = { [HEAD]: [OWN, CANARY], [OWN]: [OLD] }
    const comments = [review(OWN), suite(OWN)]
    expect(await failing({ comments, parents })).toEqual(["review", "stamp", "suite"])
    expect(await failing({ comments: [...comments, stamped(example(8))], parents })).toEqual([])
    const wait = {
      ...example(8),
      checks: { "agent-review": { source: "agent", status: "fail" as const } },
    }
    const waiting = [...comments, stamped({ ...wait, status: "wait" })]
    expect(await failing({ comments: waiting, parents })).toEqual(["review", "stamp", "suite"])
  })

  test("9: a worker's own commit needs a new stamp and a new 5/5", async () => {
    const parents = { [HEAD]: [OWN] }
    expect(await failing({ comments: [review(OWN), suite(OWN)], parents })).toEqual([
      "review",
      "stamp",
      "suite",
    ])
    const fresh = [review(HEAD), suite(HEAD), stamped(example(9))]
    expect(await failing({ comments: fresh, parents })).toEqual([])
  })

  test("10: the worker's commit of a reviewer's patch is an own commit, so the 5/5 before it holds nothing", async () => {
    const parents = { [HEAD]: [OWN] }
    const before = [review(OWN), suite(OWN), stamped({ ...example(10), commit: OWN })]
    expect(await failing({ comments: before, parents })).toEqual(["review", "stamp", "suite"])
    const after = [review(HEAD), suite(HEAD), stamped(example(10))]
    expect(await failing({ comments: after, parents })).toEqual([])
  })

  test("11: agent-review on a commit that is not a merge of canary carries nothing", async () => {
    const parents = { [HEAD]: [OWN] }
    const comments = [review(OWN), suite(OWN), stamped(example(11))]
    expect(await failing({ comments, parents })).toEqual(["review", "stamp", "suite"])
  })

  test("12: a red canary stops every merge but a fix whose own head ran the full green", async () => {
    const canary = [example(12)]
    const behind = { aheadBy: 2, canary, comments: [review(HEAD), suite(HEAD)] }
    expect(await failing(behind)).toEqual(["canary"])
    expect(await failing({ ...behind, aheadBy: 0 })).toEqual([])
    const parents = { [HEAD]: [OWN, CANARY], [OWN]: [OLD] }
    const carriedOnly = { canary, clean: [HEAD], comments: [review(OWN), suite(OWN)], parents }
    expect(await failing(carriedOnly)).toEqual(["canary"])
  })

  test("13: a job that skipped its steps posts nothing, so only a carried green with every JOB_CHECKS name counts", async () => {
    const parents = { [HEAD]: [OWN, CANARY], [OWN]: [OLD] }
    const skipped = jobs("success", "success").map((run) => ({ ...run, skippedSteps: true }))
    const full = { clean: [HEAD], comments: [review(OWN), suite(OWN)], parents }
    const facts = await factsOf(full)
    expect(carried(facts.stamp, [])).toMatchObject({ green: true })
    expect(await failing(full)).toEqual([])
    const part = { ...full, comments: [review(OWN), stamped(example(13))] }
    const partFacts = await factsOf(part)
    expect(carried(partFacts.stamp, [])).toMatchObject({ green: false })
    const read = typeof partFacts.stamp === "string" ? undefined : partFacts.stamp
    expect(jobsStamp(read, HEAD, skipped)).toBeNull()
    expect(await failing(part)).toEqual(["suite"])
  })

  test("14: a stamp from another account reads as no stamp", async () => {
    const other = [review(HEAD), stamped(example(1), "someone-else"), stamped(example(14), "x")]
    expect(await failing({ comments: other })).toEqual(["stamp", "suite"])
  })

  test("15: of two stamps from one place at one head, the newest holds", async () => {
    const files = ["api/hono/src/routers/dashboard.ts"]
    const red = stamped(example(4))
    const green = stamped(example(15))
    const later = [review(HEAD), suite(HEAD), red, green]
    expect(await failing({ comments: later, files })).toEqual([])
    const redLast = [review(HEAD), suite(HEAD), green, stamped(example(4))]
    expect(await failing({ comments: redLast, files })).toEqual(["stamp"])
  })

  test("16: a stamp at another commit counts only when the walk carries it to the head", async () => {
    const comments = [review(HEAD), suite(OLD), stamped(example(16))]
    expect(await failing({ comments, parents: { [HEAD]: [OLD] } })).toEqual(["stamp", "suite"])
    const merged = { clean: [HEAD], comments, parents: { [HEAD]: [OLD, CANARY] } }
    expect(await failing(merged)).toEqual([])
  })

  test("17: a red agent-review, or a review below 5/5, holds the merge whatever CI says", async () => {
    const red = [review(HEAD), stamped(example(17)), suite(HEAD)]
    expect(await failing({ comments: red })).toEqual(["stamp"])
    expect(await failing({ comments: [review(HEAD, 4), suite(HEAD)] })).toEqual(["review"])
  })

  test("18: a train's step stamps train, and its land waives the suite gate once that stamp ran them all", async () => {
    const step = { ...example(18), checks: { ...suiteChecks("local"), ...example(18).checks } }
    const verdict = trainVerdictOf(stamped(step), OWNER)
    expect(verdict).toMatchObject({ at: "69a6a4c", pass: true, suite: true })
    const facts = await factsOf({ comments: [review(HEAD), stamped(example(18))] })
    const gates = gatesOf(facts)
    expect(gates.filter((gate) => !gate.ok).map((gate) => gate.name)).toEqual(["suite"])
    expect(trainGates(gates, verdict?.suite).filter((gate) => !gate.ok)).toEqual([])
  })
})
