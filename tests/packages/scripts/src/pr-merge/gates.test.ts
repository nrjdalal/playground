import { describe, expect, test } from "bun:test"

import {
  atHead,
  ciGate,
  gatesOf,
  marksReady,
  REQUIRED_CHECKS,
  withReadyDraft,
  type Comment,
  type PrFacts,
} from "../../../../../packages/scripts/src/pr-merge/gates"
import { SKILL_BODY } from "./bodies"
import "./scratch-config"
import { greenChecks } from "./suite"

const HEAD = "69a6a4c5e6caf46c4abda6a89de4ce6f3b309e88"
const OLD = "5740ceaa347f9c0f4e5a2f109f433e7838468b1f"
const CANARY = "6f3db1ea4cb7ea4072e0d5454da0026c89635cab"
const TREE = "1bd05088cad7c561f74d8912abe76184760003d9"

let clock = 0
const said = (body: string, author = "acme"): Comment => ({
  author,
  body,
  createdAt: new Date(Date.UTC(2026, 9, 6, 19, 0, clock++)).toISOString(),
})

const review = (sha = HEAD, score = 5) =>
  said(`## ReviewBot · round 2: ${score}/5 at ${sha.slice(0, 7)} · 0 blocking\n\nAll good.`)

const facts = (patch: Partial<PrFacts> = {}): PrFacts => ({
  aheadBy: 0,
  author: "acme",
  base: "canary",
  canary: CANARY,
  checks: greenChecks(),
  comments: [review()],
  draft: false,
  files: ["packages/scripts/src/pr-merge/gates.ts", "AGENTS.md"],
  head: HEAD,
  held: null,
  lost: [],
  mergeTree: TREE,
  n: 7,
  owner: "acme",
  state: "OPEN",
  ...patch,
})

const failing = (patch: Partial<PrFacts>) =>
  gatesOf(facts(patch))
    .filter((gate) => !gate.ok)
    .map((gate) => gate.name)

describe("atHead", () => {
  test("a verdict names the head by a prefix of seven or more characters", () => {
    expect(atHead("69a6a4c", HEAD)).toBe(true)
    expect(atHead(HEAD, HEAD)).toBe(true)
    expect(atHead("69a6a4", HEAD)).toBe(false)
    expect(atHead("5740cea", HEAD)).toBe(false)
  })
})

// Two runs of one check on a head, as a real PR's rollup listed them at 848e765.
const CANCELLED = {
  conclusion: "CANCELLED",
  name: "test",
  startedAt: "2026-10-21T14:46:01Z",
  status: "COMPLETED",
  workflowName: "Test",
}
const PASSED_RUN = { ...CANCELLED, conclusion: "SUCCESS", startedAt: "2026-10-21T14:47:24Z" }

describe("gatesOf", () => {
  test("every gate passes at the head: nothing fails", () => {
    expect(failing({})).toEqual([])
  })

  test("a PR by anyone but the repo's owner is refused unless --outside-author names its author", () => {
    const outside = facts({ author: "teammate-acme" })
    const author = (options = {}) => gatesOf(outside, options).find((g) => g.name === "author")
    expect(author()).toMatchObject({ ok: false })
    expect(author()?.detail).toContain("teammate-acme")
    expect(author({ outsideAuthor: "someone-else" })?.ok).toBe(false)
    expect(author({ outsideAuthor: "Teammate-Acme" })?.ok).toBe(true)
    expect(gatesOf(facts({ author: "ACME" })).find((g) => g.name === "author")?.ok).toBe(true)
  })

  test("a review at an earlier head, or by anyone else, does not count", () => {
    expect(failing({ comments: [review(OLD)] })).toEqual(["review"])
    expect(failing({ comments: [said(review().body, "someone-else")] })).toEqual(["review"])
    expect(failing({ comments: [review(), review(HEAD, 3)] })).toEqual(["review"])
  })

  test("behind canary, a head that merges clean passes, and a conflict waits for canary merged in", () => {
    const clean = gatesOf(facts({ aheadBy: 2 })).find((gate) => gate.name === "up to date")
    expect(clean).toMatchObject({ ok: true })
    expect(clean?.detail).toBe(
      "canary has 2 commits 69a6a4c lacks; it merges clean with canary 6f3db1e",
    )
    const conflict = gatesOf(facts({ aheadBy: 2, mergeTree: null })).find(
      (gate) => gate.name === "up to date",
    )
    expect(conflict).toMatchObject({ ok: false })
    expect(conflict?.detail).toContain("canary has 2 commits 69a6a4c lacks and conflicts with it")
  })

  test("a squash that would delete lines a canary merge dropped refuses, naming each file and merge (#1052)", () => {
    const lost = [
      { commit: CANARY, line: 4, path: "a.ts" },
      { commit: CANARY, line: 9, path: "a.ts" },
      { commit: TREE, line: 1, path: "new.ts" },
    ]
    expect(failing({ lost })).toEqual(["keeps canary"])
    const gate = gatesOf(facts({ lost })).find((g) => g.name === "keeps canary")
    expect(gate?.detail).toContain(
      "the squash would delete 3 lines canary added that a merge of canary dropped, which git's own merge keeps",
    )
    expect(gate?.detail).toContain("a.ts (dropped in 6f3db1e), new.ts (dropped in 1bd0508)")
    expect(gate?.detail).toContain("git merge origin/canary")
  })

  test("a squash it could not read refuses, saying why", () => {
    const gate = gatesOf(facts({ lost: "git rev-list exited 128" })).find(
      (g) => g.name === "keeps canary",
    )
    expect(gate).toMatchObject({
      detail: "could not read what the squash deletes: git rev-list exited 128",
      ok: false,
    })
  })

  test("a PR held-prs.json lists refuses, naming the reason the file gives", () => {
    const reason = "held for the tooltip notes (builder, 16 Oct)"
    expect(failing({ held: reason })).toEqual(["held"])
    expect(gatesOf(facts({ held: reason })).find((g) => g.name === "held")?.detail).toBe(reason)
  })

  test("a draft, a closed PR or another base refuses", () => {
    expect(failing({ draft: true })).toEqual(["ready"])
    expect(failing({ state: "MERGED" })).toEqual(["open"])
    expect(failing({ base: "main" })).toEqual(["base"])
  })

  test("a body that is not the PR template refuses, and one never read is not judged", () => {
    expect(failing({ body: "Closes #2410" })).toEqual(["body"])
    expect(gatesOf(facts()).some((gate) => gate.name === "body")).toBe(false)
  })

  test("the body gate refuses an Outcome line in a PR's TL;DR, naming it", () => {
    const body = SKILL_BODY.replace("The board", "Outcome: The board")
    const gate = gatesOf(facts({ body })).find((g) => g.name === "body")
    expect(gate?.detail).toContain('labelled "Outcome:"')
  })

  test("a count of canary's lead that did not read refuses, and says so", () => {
    const gate = gatesOf(facts({ aheadBy: Number.NaN })).find((g) => g.name === "up to date")
    expect(gate).toEqual({
      detail: "could not read how far canary is ahead of 69a6a4c",
      name: "up to date",
      ok: false,
    })
  })

  test("the head's GitHub checks must all have finished and passed", () => {
    expect(ciGate([])).toEqual({ detail: "no checks reported", name: "ci", ok: true })
    const passed = [
      ...greenChecks(),
      { conclusion: "SKIPPED", name: "deploy", status: "COMPLETED" },
      { context: "ci/legacy", state: "SUCCESS" },
    ]
    expect(ciGate(passed).ok).toBe(true)
    expect(failing({ checks: passed })).toEqual([])
    const red = [
      { conclusion: "FAILURE", name: "test", status: "COMPLETED" },
      { conclusion: null, name: "lint", status: "IN_PROGRESS" },
      { context: "ci/legacy", state: "PENDING" },
    ]
    expect(ciGate(red)).toEqual({
      detail: "not passed: test failure, lint in_progress, ci/legacy pending",
      name: "ci",
      ok: false,
    })
    expect(failing({ checks: red })).toEqual(["ci"])
  })

  test("a head missing a required GitHub job refuses, naming it, until GitHub runs it", () => {
    expect(REQUIRED_CHECKS).toEqual(["Audit, Lint, and Build", "test"])
    expect(failing({ checks: [] })).toEqual(["ci"])
    const onlyTest = greenChecks().filter((check) => check.name === "test")
    expect(gatesOf(facts({ checks: onlyTest })).find((g) => g.name === "ci")).toEqual({
      detail: "no Audit, Lint, and Build check on the head yet: GitHub runs it on every push",
      name: "ci",
      ok: false,
    })
  })

  test("an older cancelled run beside a newer pass of the same check passes", () => {
    expect(ciGate([CANCELLED, PASSED_RUN])).toEqual({
      detail: "1 check passed",
      name: "ci",
      ok: true,
    })
  })

  test("a cancelled run newer than the pass refuses, judged apart by workflow", () => {
    const newest = [PASSED_RUN, { ...CANCELLED, startedAt: "2026-10-21T14:48:00Z" }]
    expect(ciGate(newest)).toEqual({ detail: "not passed: test cancelled", name: "ci", ok: false })
    const apart = [
      PASSED_RUN,
      { ...CANCELLED, startedAt: "2026-10-21T14:50:00Z", workflowName: "Other" },
    ]
    expect(ciGate(apart)).toEqual({ detail: "not passed: test cancelled", name: "ci", ok: false })
  })

  test("a queued rerun, which reads no start time yet, keeps the gate pending", () => {
    const queued = {
      ...PASSED_RUN,
      conclusion: null,
      startedAt: "0001-01-01T00:00:00Z",
      status: "QUEUED",
    }
    expect(ciGate([CANCELLED, PASSED_RUN, queued])).toEqual({
      detail: "not passed: test queued",
      name: "ci",
      ok: false,
    })
  })
})

describe("marking a draft ready", () => {
  test("the owner's draft whose every other gate passes is marked ready; a failing one is not", () => {
    const draft = facts({ draft: true })
    expect(marksReady(draft, gatesOf(draft))).toBe(true)
    expect(withReadyDraft(draft, gatesOf(draft), "marked").find((g) => g.name === "ready")).toEqual(
      { detail: "marked", name: "ready", ok: true },
    )
    const red = facts({ comments: [review(HEAD, 3)], draft: true })
    expect(marksReady(red, gatesOf(red))).toBe(false)
    expect(marksReady(facts({ author: "someone", draft: true }), [])).toBe(false)
  })
})

describe("a head with no finished GitGuardian check", () => {
  const passed = { conclusion: "SUCCESS", name: "GitGuardian Security Checks", status: "COMPLETED" }
  const guarded = (patch: Partial<PrFacts>) =>
    gatesOf(facts(patch), { gitGuardian: true })
      .filter((gate) => !gate.ok)
      .map((gate) => gate.name)

  test("refuses on a guarded repo, and passes once GitGuardian has passed at the head", () => {
    expect(guarded({})).toEqual(["ci"])
    expect(guarded({ checks: [...greenChecks(), passed] })).toEqual([])
    expect(failing({})).toEqual([])
  })

  test("a GitGuardian check still running refuses ci", () => {
    const running = { conclusion: "", name: "GitGuardian Security Checks", status: "IN_PROGRESS" }
    const gates = gatesOf(facts({ checks: [...greenChecks(), running] }), { gitGuardian: true })
    expect(gates.filter((g) => !g.ok).map((g) => g.name)).toEqual(["ci"])
  })
})
