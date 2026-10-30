// The gates a Playground PR passes before it merges. Every gate comment is posted as the repo's owner (the reviewer, the tester, Checks and ops-checks-go all post through gh under the owner's account), so a gate reads only comments posted under that account, and nobody else can post a verdict and merge. CI is the stamp (stamp.ts): one template every tester writes, read at the head or carried to it past clean canary merges and the reviewer's look.

import {
  atHead,
  CHECKS,
  sourcesOf,
  verdictsOf,
  type GateName,
  type Verdict,
} from "@packages/config/verdicts"

import { bodyRefusal } from "./body"
import type { Lost } from "./lost"
import { JOB_CHECKS, ranSuite, statusOf, type Stamp, type StampRead } from "./stamp"

export { atHead, verdictOf, verdictsOf } from "@packages/config/verdicts"
export type { GateName, Verdict } from "@packages/config/verdicts"

// One GitHub check on the head, as `gh pr view --json statusCheckRollup` gives it: a check run (status, conclusion) or a commit status (state).
export type Check = {
  conclusion?: string | null
  context?: string
  name?: string
  startedAt?: string
  state?: string
  status?: string
  workflowName?: string
}

export type Comment = { author: string; body: string; createdAt: string; url?: string }

export type Gate = { detail: string; name: string; ok: boolean }

// A PR has UI when its diff touches web/next/, its docs pages included, so it needs a tester's drive.
export const hasUi = (files: string[]): boolean =>
  files.some((file) => file.startsWith("web/next/"))

// The dashboard's code, which only verify's stack and browser check: Checks runs verify for a PR that touches it, and a PR that touches none needs no Checks; DASHBOARD_PATHS in scripts/ops/checks/checks.py is the same list, which a test holds equal.
export const DASHBOARD_PATHS = [
  "api/hono/",
  "packages/auth/",
  "packages/config/",
  "packages/db/",
  "packages/env/",
  "web/next/",
]

export const touchesDashboard = (files: string[]): boolean =>
  files.some((file) => DASHBOARD_PATHS.some((path) => file.startsWith(path)))

export type PrFacts = {
  // How many commits canary has that the head lacks: 0 is up to date, NaN when gh's answer did not read as a count.
  aheadBy: number
  // Who opened the PR (its GitHub login).
  author: string
  base: string
  // The PR's description, held to the PR template the Changelog reads; absent only in a test, which skips that gate.
  body?: string
  // origin/canary now, and the tree of the head merged with it (git merge-tree --write-tree); mergeTree is null when they conflict or it could not be read.
  canary: string
  mergeTree: string | null
  // The stamps on canary's tip, the net after each batch: a red one stops every merge, and why they could not be read fails it; absent in a test that skips the gate.
  canaryStamps?: Stamp[] | string
  // The files the head's merge with canary conflicts in, null when it merged clean or could not be read; left out where no merge was read.
  conflicts?: string[] | null
  // The head's GitHub checks; none while GitHub Actions is off, or while the PR lacks the Cloud CI label that starts them.
  checks: Check[]
  comments: Comment[]
  draft: boolean
  files: string[]
  head: string
  // Why held-prs.json holds the PR, or null when it is not held.
  held: string | null
  // The lines canary added that a merge of canary into the PR dropped from git's own merge and the squash still lacks, or why they could not be read (lostLines).
  lost: Lost
  // The PR's number.
  n: number
  owner: string
  // The stamp the walk back from the head reads (stamp.ts), or why it could not be read.
  stamp: StampRead | string
  state: string
}

export const BASE = "canary"

// Pure: the newest verdict per gate at the head, from the owner's comments only, oldest comment first so a later one replaces an earlier.
export function verdictsAt(facts: Pick<PrFacts, "comments" | "head" | "owner">) {
  const newest = new Map<GateName, Verdict>()
  const sorted = [...facts.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const comment of sorted) {
    if (comment.author.toLowerCase() !== facts.owner.toLowerCase()) continue
    for (const verdict of verdictsOf(comment.body))
      if (atHead(verdict.at, facts.head))
        newest.set(verdict.gate, { ...verdict, createdAt: comment.createdAt, url: comment.url })
  }
  return newest
}

const PASSED = new Set(["NEUTRAL", "SKIPPED", "SUCCESS"])

// gitGuardian: the head must carry a GitGuardian check (a head it never started on ran no secret scan); outsideAuthor: the one login besides the repo's owner whose PR may merge, named on purpose.
export type GateOptions = { gitGuardian?: boolean; outsideAuthor?: string }

// Pure: the author gate: the repo's owner (every factory session pushes as it), or the login --outside-author names, since an outside PR's code would run here and merges only on a lead's go.
function authorGate(facts: PrFacts, outsideAuthor?: string): Gate {
  const by = facts.author.toLowerCase()
  if (by === facts.owner.toLowerCase())
    return { detail: `by ${facts.author}`, name: "author", ok: true }
  if (outsideAuthor && by === outsideAuthor.toLowerCase()) {
    return { detail: `by ${facts.author}, named by --outside-author`, name: "author", ok: true }
  }
  return {
    detail: `by ${facts.author}, not ${facts.owner}: an outside PR merges only on a lead's go, with --outside-author ${facts.author}`,
    name: "author",
    ok: false,
  }
}

export const isGitGuardian = (check: Check): boolean =>
  /^GitGuardian\b/i.test(check.name ?? check.context ?? "")

// Pure: each check's newest run, keyed by workflow and name (a commit status by context), since a rerun or a close and reopen leaves older runs in the rollup; a run not yet finished counts as newest, since a queued one reads no start time.
export function newestRuns(checks: Check[]): Check[] {
  const rank = (check: Check) =>
    check.state === undefined && check.status?.toUpperCase() !== "COMPLETED"
      ? "~"
      : (check.startedAt ?? "")
  const newest = new Map<string, Check>()
  for (const check of checks) {
    const key =
      check.state === undefined
        ? `run ${check.workflowName ?? ""} ${check.name ?? ""}`
        : `status ${check.context ?? ""}`
    const held = newest.get(key)
    if (!held || rank(check) > rank(held)) newest.set(key, check)
  }
  return [...newest.values()]
}

// Pure: the head's GitHub checks as one gate: every check's newest run finished and passed, or none reported (GitHub Actions off). gitGuardian refuses a head with no GitGuardian check.
export function ciGate(
  all: Check[],
  { gitGuardian = false }: { gitGuardian?: boolean } = {},
): Gate {
  const checks = newestRuns(all)
  if (gitGuardian && !checks.some(isGitGuardian)) {
    return {
      detail:
        "no GitGuardian check on the head: it never started, so no secret scan ran; close and reopen the PR to start it on this head, which keeps its review and go; push again only if it has not started about 10 minutes after the reopen, which needs a fresh review and go",
      name: "ci",
      ok: false,
    }
  }
  if (checks.length === 0) return { detail: "no checks reported", name: "ci", ok: true }
  const bad = checks.filter((check) =>
    check.state !== undefined
      ? check.state.toUpperCase() !== "SUCCESS"
      : check.status?.toUpperCase() !== "COMPLETED" ||
        !PASSED.has(check.conclusion?.toUpperCase() ?? ""),
  )
  if (bad.length === 0) {
    const count = `${checks.length} check${checks.length === 1 ? "" : "s"}`
    return { detail: `${count} passed`, name: "ci", ok: true }
  }
  const names = bad.map((check) => {
    const name = check.name ?? check.context ?? "a check"
    const how =
      check.state ?? (check.status?.toUpperCase() === "COMPLETED" ? check.conclusion : check.status)
    return `${name} ${String(how ?? "unknown").toLowerCase()}`
  })
  return { detail: `not passed: ${names.join(", ")}`, name: "ci", ok: false }
}

// Pure: the up-to-date gate: a head with everything on canary, or one behind it that merges with canary clean, since a clean merge carries its stamp; a conflict needs canary merged in and the reviewer's look.
function upToDate(facts: PrFacts): Gate {
  const sha7 = facts.head.slice(0, 7)
  const name = "up to date"
  if (!Number.isInteger(facts.aheadBy))
    return { detail: `could not read how far ${BASE} is ahead of ${sha7}`, name, ok: false }
  if (facts.aheadBy === 0) return { detail: `${sha7} has everything on ${BASE}`, name, ok: true }
  const behind = `${BASE} has ${facts.aheadBy} commit${facts.aheadBy === 1 ? "" : "s"} ${sha7} lacks`
  return facts.mergeTree
    ? {
        detail: `${behind}; it merges clean with ${BASE} ${facts.canary.slice(0, 7)}, which carries its stamp`,
        name,
        ok: true,
      }
    : {
        detail: `${behind} and conflicts with it; merge ${BASE} in, and the reviewer's look stamps the merge`,
        name,
        ok: false,
      }
}

// Pure: the gate that refuses a squash deleting lines canary added that a merge of canary into the PR dropped from git's own merge, as a merge with -s ours does while canary still reads as merged in.
function keepsCanary(lost: Lost): Gate {
  const name = "keeps canary"
  if (typeof lost === "string")
    return { detail: `could not read what the squash deletes: ${lost}`, name, ok: false }
  if (lost.length === 0)
    return {
      detail: `no merge of ${BASE} into the PR dropped a line git's own merge keeps`,
      name,
      ok: true,
    }
  const byFile = new Map<string, Set<string>>()
  for (const line of lost)
    byFile.set(line.path, (byFile.get(line.path) ?? new Set()).add(line.commit.slice(0, 7)))
  const where = [...byFile]
    .map(([path, merges]) => `${path} (dropped in ${[...merges].join(", ")})`)
    .join(", ")
  return {
    detail: `the squash would delete ${lost.length} line${lost.length === 1 ? "" : "s"} ${BASE} added that a merge of ${BASE} dropped, which git's own merge keeps: ${where}. Only a squash that holds them again clears this, so a new merge of ${BASE} leaves them lost: redo that merge plainly (reset the branch to the commit before it, then git merge origin/${BASE}, resolving each conflict with both sides' meaning) and re-apply your change in a commit of your own, or keep the lines, and re-gate`,
    name,
    ok: false,
  }
}

// Pure: whether PR n at its head merges clean with canary now, and as which tree, read from git merge-tree's exit code, never its tree line alone (a merge judged clean by its tree line was a conflict).
export function mergeLine(
  n: number,
  facts: Pick<PrFacts, "canary" | "conflicts" | "head" | "mergeTree">,
): string {
  const at = `#${n} at ${facts.head.slice(0, 7)}`
  const canary = `${BASE} ${facts.canary.slice(0, 7)}`
  if (facts.mergeTree)
    return `${at} merges clean with ${canary} as tree ${facts.mergeTree.slice(0, 7)}`
  if (facts.conflicts?.length)
    return `${at} conflicts with ${canary} in ${facts.conflicts.join(", ")}`
  return `${at}: its merge with ${canary} could not be read`
}

// Pure: whether the merge path marks this draft ready: the owner's own draft whose every other gate in gates passes. gates is what the caller judges: pr:merge every gate, a train all but the stamp and up to date.
export const marksReady = (facts: PrFacts, gates: Gate[]): boolean =>
  facts.draft &&
  facts.author.toLowerCase() === facts.owner.toLowerCase() &&
  gates.every((gate) => gate.ok || gate.name === "ready")

// Pure: gates with the ready gate passed, saying why, for a draft the merge path marks ready.
export const withReadyDraft = (facts: PrFacts, gates: Gate[], detail: string): Gate[] =>
  marksReady(facts, gates)
    ? gates.map((gate) => (gate.name === "ready" ? { ...gate, detail, ok: true } : gate))
    : gates

// Pure: the stamp gate: green merges, once a diff touching dashboard code (DASHBOARD_PATHS) also passed Checks' verify; wait waits for CI; red, or no stamp, is not ready.
function stampGate(read: StampRead | string, files: string[]): Gate {
  const name = "stamp"
  if (typeof read === "string")
    return { detail: `could not read the stamp: ${read}`, name, ok: false }
  if (!read.status || !read.at) return { detail: `no stamp: ${read.why}`, name, ok: false }
  const at = read.at.slice(0, 7)
  const lines = read.stamps
    .map((stamp) => `${stamp.status} @ ${at} · ${sourcesOf(stamp)}`)
    .join(", ")
  if (read.status !== "green")
    return {
      detail: `${lines}: ${read.status === "wait" ? "waiting for CI" : "red, so not ready"}`,
      name,
      ok: false,
    }
  if (touchesDashboard(files) && !read.passed.includes(CHECKS.verify))
    return {
      detail: `${lines}, but no green stamp passed ✓ verify (from Checks, for dashboard code)`,
      name,
      ok: false,
    }
  return { detail: lines, name, ok: true }
}

// Pure: the suite gate: a green stamp on the walk passed every check GitHub's jobs run, so no PR merges on Checks' verify alone; a train's land waives it once its step's own stamp ran them all.
function suiteGate(read: StampRead | string): Gate {
  const name = "suite"
  const missing = Object.values(JOB_CHECKS)
    .flat()
    .filter((check) => typeof read === "string" || !read.passed.includes(check))
  return missing.length === 0
    ? { detail: "a green stamp passed every check GitHub's jobs run", name, ok: true }
    : {
        detail: `no green stamp passed ${missing.join(", ")}: GitHub's jobs run them (ask your lead for bun run ci:go <n> <sha7>)`,
        name,
        ok: false,
      }
}

// Pure: the tester gate: a diff touching web/next/ needs a green stamp that passed the tester's drive; a train keeps it, since a train's run drives no page.
function testerGate(read: StampRead | string, files: string[]): Gate {
  const name = "tester"
  if (!hasUi(files)) return { detail: "no web/next/ in the diff", name, ok: true }
  return typeof read !== "string" && read.passed.includes(CHECKS.drive)
    ? { detail: `a green stamp passed ✓ ${CHECKS.drive}`, name, ok: true }
    : {
        detail: `no green stamp passed ✓ ${CHECKS.drive} (from a tester, for web/next/)`,
        name,
        ok: false,
      }
}

// Pure: the net: canary's own run after each batch stamps its tip, and a red one stops every merge but the fix: a PR whose head holds canary's tip and whose own run passed every check GitHub's jobs run on that head, so its squash is the tree that ran green.
function canaryGate(facts: PrFacts, stamps: Stamp[] | string): Gate {
  const c7 = facts.canary.slice(0, 7)
  if (typeof stamps === "string")
    return { detail: `could not read ${BASE} ${c7}'s stamps: ${stamps}`, name: BASE, ok: false }
  if (stamps.length === 0 || statusOf(stamps) !== "red")
    return { detail: `${BASE} ${c7} is not stamped red`, name: BASE, ok: true }
  const read = typeof facts.stamp === "string" ? undefined : facts.stamp
  return facts.aheadBy === 0 && read?.at === facts.head && ranSuite(read.stamps)
    ? {
        detail: `${BASE} ${c7} is stamped red, and this head holds it and ran green, so it fixes it`,
        name: BASE,
        ok: true,
      }
    : {
        detail: `${BASE} ${c7} is stamped red, so every merge waits for the fix: a PR that merges ${BASE} in and runs green on its head`,
        name: BASE,
        ok: false,
      }
}

// Pure: the newest review on the head, or on the nearest commit it reaches past clean canary merges and the reviewer's looks, which carry the 5/5 as they carry the stamp.
function reviewGate(facts: PrFacts): Gate {
  const reach = typeof facts.stamp === "string" ? [] : facts.stamp.reach
  for (const head of reach.length > 0 ? reach : [facts.head]) {
    const review = verdictsAt({ ...facts, head }).get("review")
    if (!review) continue
    const from = atHead(review.at, facts.head) ? "" : `, carried from ${review.at.slice(0, 7)}`
    return {
      detail: review.pass ? `${review.text}${from}` : `newest review is not a pass: ${review.text}`,
      name: "review",
      ok: review.pass,
    }
  }
  return {
    detail: `missing 5/5 review (## ReviewBot · round <n>: 5/5 at <sha7>) at ${facts.head.slice(0, 7)} from ${facts.owner}`,
    name: "review",
    ok: false,
  }
}

// Pure: every gate, in the order a PR meets them, each saying what it found at the head. The PR merges only when every one is ok.
export function gatesOf(facts: PrFacts, { gitGuardian, outsideAuthor }: GateOptions = {}): Gate[] {
  const gates: Gate[] = [
    {
      detail: facts.state === "OPEN" ? "open" : `the PR is ${facts.state.toLowerCase()}`,
      name: "open",
      ok: facts.state === "OPEN",
    },
    authorGate(facts, outsideAuthor),
    {
      detail: facts.held ?? "not in held-prs.json",
      name: "held",
      ok: facts.held === null,
    },
    {
      detail: facts.draft ? "the PR is a draft; mark it ready first" : "ready for review",
      name: "ready",
      ok: !facts.draft,
    },
    {
      detail:
        facts.base === BASE
          ? `into ${BASE}`
          : `into ${facts.base}, not ${BASE}; pr:merge merges only into ${BASE}`,
      name: "base",
      ok: facts.base === BASE,
    },
    upToDate(facts),
    keepsCanary(facts.lost),
  ]
  if (facts.canaryStamps !== undefined) gates.push(canaryGate(facts, facts.canaryStamps))
  gates.push(ciGate(facts.checks, { gitGuardian }))
  if (facts.body !== undefined) {
    const why = bodyRefusal(facts.body)
    gates.push(
      why
        ? { detail: `${why}; fix the body (no push)`, name: "body", ok: false }
        : { detail: "the PR template", name: "body", ok: true },
    )
  }
  gates.push(
    reviewGate(facts),
    stampGate(facts.stamp, facts.files),
    suiteGate(facts.stamp),
    testerGate(facts.stamp, facts.files),
  )
  return gates
}
