import {
  approvalCounts,
  cachedBy,
  ciOf,
  ghGraphql,
  isRecord,
  nodes,
  PR_TTL_MS,
  str,
  type PullProblem,
} from "@/lib/dashboard/agents"
import { readFixtureMachine, readsLive } from "@/lib/dashboard/fixture"
import { org } from "@/lib/org"

// The owner's day-job queue beside the dashboard's own: their open pull requests in the work org (org.ts's `work`), read live from GitHub in one search and kept as the board's reads are. Nobody keeps it by hand, and it only reads: nothing here writes to GitHub.

// What a pull waits on, in plain words, closest to merging first; a pull waiting on several waits on the one latest in this list.
export const WAITS_ON = [
  "Nothing",
  "Checking",
  "Behind its base",
  "Blocked",
  "CI running",
  "Review",
  "CI failing",
  "Changes requested",
  "Conflicts",
  "Draft",
] as const

export type WaitsOn = (typeof WAITS_ON)[number]

export type WorkPull = {
  approvals: string
  base: string
  number: number
  repo: string
  title: string
  updatedAt: string | null
  url: string
  waitsOn: WaitsOn
}

export type WorkQueue = { label: string; problem: PullProblem | null; pulls: WorkPull[] }

type Json = Record<string, unknown>

// Pure: whether a pull's state holds each wait, the reading behind WAITS_ON.
const WAITS: Record<Exclude<WaitsOn, "Nothing">, (node: Json, ci: string) => boolean> = {
  // GitHub works out mergeability after a search asks, so a cold answer reads UNKNOWN: never ready until it says
  Checking: (node) => node.mergeable === "UNKNOWN" || node.mergeStateStatus === "UNKNOWN",
  "Behind its base": (node) => node.mergeStateStatus === "BEHIND",
  Blocked: (node) => node.mergeStateStatus === "BLOCKED",
  "CI running": (_, ci) => ci === "pending",
  Review: (node) => node.reviewDecision === "REVIEW_REQUIRED",
  "CI failing": (_, ci) => ci === "failing",
  "Changes requested": (node) => node.reviewDecision === "CHANGES_REQUESTED",
  Conflicts: (node) => node.mergeable === "CONFLICTING" || node.mergeStateStatus === "DIRTY",
  Draft: (node) => node.isDraft === true,
}

// Pure: approvals in vs needed where the base's rules say how many, else GitHub's review decision in words.
const approvalWords = (node: Json): string => {
  const { approved, required } = approvalCounts(node)
  if (required > 0) return `${approved} of ${required}`
  if (node.reviewDecision === "APPROVED") return "Approved"
  if (node.reviewDecision === "REVIEW_REQUIRED") return "Review required"
  if (node.reviewDecision === "CHANGES_REQUESTED") return "Changes requested"
  return "None required"
}

// Pure: one PullRequest node of the search as a WorkPull, or null when it is not one.
export function workPullOf(node: unknown): WorkPull | null {
  if (!isRecord(node) || typeof node.number !== "number" || !str(node.url)) return null
  const commit = nodes(node.commits)[0]?.commit
  const rollup =
    isRecord(commit) && isRecord(commit.statusCheckRollup) ? commit.statusCheckRollup : {}
  const ci = ciOf(str(rollup.state))
  const waitsOn =
    [...WAITS_ON].reverse().find((wait) => wait !== "Nothing" && WAITS[wait](node, ci)) ?? "Nothing"
  return {
    approvals: approvalWords(node),
    base: str(node.baseRefName),
    number: node.number,
    repo: isRecord(node.repository) ? str(node.repository.nameWithOwner) : "",
    title: str(node.title),
    updatedAt: Number.isNaN(Date.parse(str(node.updatedAt))) ? null : str(node.updatedAt),
    url: str(node.url),
    waitsOn,
  }
}

const timeOf = (pull: WorkPull): number =>
  pull.updatedAt ? Date.parse(pull.updatedAt) : Number.POSITIVE_INFINITY

// Pure: ready first, then by what each waits on, closest to merging first, then the oldest update first.
export const orderWork = (pulls: WorkPull[]): WorkPull[] =>
  pulls.toSorted(
    (a, b) => WAITS_ON.indexOf(a.waitsOn) - WAITS_ON.indexOf(b.waitsOn) || timeOf(a) - timeOf(b),
  )

// Pure: the search for the owner's open pulls in one org; org.ts lets only a GitHub login through, so it adds no qualifier of its own.
export const workSearch = (owner: string): string => `is:pr is:open author:@me org:${owner}`

const SEARCH = `query($q: String!) { search(query: $q, type: ISSUE, first: 50) { nodes { ... on PullRequest { baseRef { branchProtectionRule { requiredApprovingReviewCount } rules(first: 100) { nodes { parameters { ... on PullRequestParameters { requiredApprovingReviewCount } } } } } baseRefName commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } isDraft latestOpinionatedReviews(first: 20) { nodes { state } } mergeStateStatus mergeable number repository { nameWithOwner } reviewDecision title updatedAt url } } } }`

// A fixture stack asks GitHub nothing: its fixture holds the search's nodes. Made on the first read, since agents.ts, which this file reads from, also reads this one.
let searchCache: ((owner: string) => Promise<unknown[]>) | null = null
const searchWork = (owner: string): Promise<unknown[]> =>
  (searchCache ??= cachedBy<unknown[]>(PR_TTL_MS, async (key) => {
    if (!readsLive()) return readFixtureMachine().work ?? []
    const { body } = await ghGraphql(["-f", `query=${SEARCH}`, "-f", `q=${workSearch(key)}`])
    const answer: unknown = JSON.parse(body)
    const data = isRecord(answer) ? answer.data : null
    const search = isRecord(data) ? data.search : null
    if (!isRecord(search)) throw new Error("GitHub answered without the search")
    return nodes(search)
  }))(owner)

// The work queue, or null while no work org is set, which asks GitHub nothing. A failed search names why, with no pulls.
export async function readWorkQueue(
  settings: { label: string; org?: string } = org.work,
  search: (owner: string) => Promise<unknown[]> = searchWork,
): Promise<WorkQueue | null> {
  if (!settings.org) return null
  return search(settings.org).then(
    (found) => ({
      label: settings.label,
      problem: null,
      pulls: orderWork(found.map(workPullOf).filter((p): p is WorkPull => p !== null)),
    }),
    (err: unknown) => ({
      label: settings.label,
      problem: {
        reason: err instanceof Error ? err.message : "GitHub could not be read",
        setup: isRecord(err) && err.setup === true,
      },
      pulls: [],
    }),
  )
}
