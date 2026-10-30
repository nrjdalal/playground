// The stamp: one owner comment holding one YAML block, rendered and parsed by packages/config/src/verdicts.ts alone, imported by source path, so stamp-cli.ts runs with no build of packages/config; every merge path walks back from the head past clean canary merges and the reviewer's looks to the newest stamp.

import {
  CHECK_STATUSES,
  CHECKS,
  JOB_CHECKS,
  sourcesOf,
  STAMP_STATUSES,
  stampText,
  verdictOf,
  type StampCheck,
  type StampKeys,
  type StampStatus,
} from "../../../config/src/verdicts"

export { CHECK_STATUSES, CHECKS, JOB_CHECKS, sourcesOf, STAMP_STATUSES, stampText }
export type { StampCheck, StampKeys, StampStatus } from "../../../config/src/verdicts"

// A stamp as posted on the PR: its keys, at the sha7 its commit names.
export type Stamp = StampKeys & { at: string; createdAt: string; url?: string }

// One comment, as merge.ts reads them.
export type Said = { author: string; body: string; createdAt: string; url?: string }

// Pure: the stamp a comment holds, or null: another author than the repo's owner, or no stamp in it.
export function stampOf(comment: Said, owner: string): Stamp | null {
  if (comment.author.toLowerCase() !== owner.toLowerCase()) return null
  const keys = verdictOf(comment.body)?.stamp
  return keys ? { ...keys, at: keys.commit, createdAt: comment.createdAt, url: comment.url } : null
}

// Pure: every stamp posted in these comments.
export const stampsIn = (comments: Said[], owner: string): Stamp[] =>
  comments.flatMap((comment) => stampOf(comment, owner) ?? [])

// Pure: where a source ran: ci for a GitHub run id, else local or agent.
const placeOf = (source: string): string => (/^\d+$/.test(source) ? "ci" : source)

// Stamps from one place replace each other, newest last, by the places their checks ran; a tester's (one with an agent-drive check) stands apart from the reviewer's look.
const kindOf = (stamp: Stamp): string =>
  [
    ...new Set(Object.values(stamp.checks).map((check) => placeOf(check.source))),
    ...(CHECKS.drive in stamp.checks ? [CHECKS.drive] : []),
  ]
    .sort()
    .join(" ")

// The reviewer's look: a stamp with an agent-review check.
const isLook = (stamp: Stamp): boolean => CHECKS.review in stamp.checks

// A stamp GitHub's gate jobs earned: every check from a GitHub run.
const isCi = (stamp: Stamp): boolean =>
  Object.values(stamp.checks).length > 0 &&
  Object.values(stamp.checks).every((check) => placeOf(check.source) === "ci")

const byTime = (a: Stamp, b: Stamp) => a.createdAt.localeCompare(b.createdAt)

// Pure: the stamps that hold on sha, newest first: each kind's newest, and the reviewer's waiting look only while no run's stamp came after it, since its wait waits for that run; a red look stands whatever CI says.
export function stampsAt(stamps: Stamp[], sha: string): Stamp[] {
  const newest = new Map<string, Stamp>()
  for (const stamp of stamps.filter((s) => sha.startsWith(s.at)).sort(byTime))
    newest.set(kindOf(stamp), stamp)
  const held = [...newest.values()].sort(byTime).reverse()
  const ran = held.find((stamp) => !isLook(stamp))
  const waits = (stamp: Stamp) => isLook(stamp) && stamp.status === "wait"
  return held.filter((stamp) => !waits(stamp) || !ran || byTime(stamp, ran) >= 0)
}

// One commit on the walk back from the head along first parents: the stamps that hold on it, whether it is a merge of canary (two parents, its second on canary), and whether that merge is clean (git merges its two parents to its own tree with no conflict), which needs no stamp.
export type Link = { clean: boolean; merge: boolean; sha: string; stamps: Stamp[] }

// Pure: the status the stamps on one commit give together: red if any is red, else wait if any waits, else green.
export const statusOf = (stamps: Stamp[]): StampStatus =>
  stamps.some((stamp) => stamp.status === "red")
    ? "red"
    : stamps.some((stamp) => stamp.status === "wait")
      ? "wait"
      : "green"

// A green look among agents' green stamps alone (the reviewer's look, a tester's drive), which are no run.
const looked = (stamps: Stamp[]): boolean =>
  stamps.some((stamp) => stamp.checks[CHECKS.review]?.status === "pass") &&
  stamps.every(
    (stamp) =>
      stamp.status === "green" &&
      Object.values(stamp.checks).every((check) => check.source === "agent"),
  )

// Whether the walk goes on past a commit: a clean canary merge, or a merge of canary the reviewer's look says needs no CI; a look on any other commit carries nothing.
const passes = (link: Link): boolean => link.clean || (link.merge && looked(link.stamps))

// The stamps on a commit that a run posted: agents' green stamps beside a green look are no run.
const ranOn = (link: Link): Stamp[] => (looked(link.stamps) ? [] : link.stamps)

// What the stamp reads at the head: status from the nearest commit a run stamped (at), past clean merges and the reviewer's looks, since a look carries what lies under it and a red stays red, with each stamp there; passed the checks a green stamp passed on the walk, the nearest stamp naming a check deciding it; reach the head and each commit it reaches past clean merges and the reviewer's looks, nearest first, which carry the review too; why says what stopped the walk with no stamp.
export type StampRead = {
  at?: string
  passed: string[]
  reach: string[]
  stamps: Stamp[]
  status?: StampStatus
  why: string
}

// Pure: the stamp at the head, read from the walk.
export function readStamp(links: Link[]): StampRead {
  const dirty = links.findIndex((link) => !passes(link))
  const reach = links.slice(0, dirty === -1 ? links.length : dirty + 1).map((link) => link.sha)
  const ran = links.findIndex((link) => ranOn(link).length > 0)
  const stopped = links.findIndex((link) => !passes(link) && ranOn(link).length === 0)
  if (ran === -1 || (stopped !== -1 && stopped < ran)) {
    const stop = links[stopped === -1 ? links.length - 1 : stopped]
    const why = !stop
      ? "no commit could be read"
      : stopped !== -1
        ? `${stop.sha.slice(0, 7)} has no stamp and is no clean canary merge, so it needs its own (a merge that is not clean takes the reviewer's look)`
        : `no run's stamp on the canary merges back to ${stop.sha.slice(0, 7)}`
    return { passed: [], reach, stamps: [], why }
  }
  const at = links[ran] as Link
  const named = new Set<string>()
  const passed: string[] = []
  for (const link of links) {
    for (const stamp of link.stamps)
      for (const [name, check] of Object.entries(stamp.checks)) {
        if (named.has(name)) continue
        named.add(name)
        if (check.status === "pass" && stamp.status === "green") passed.push(name)
      }
    if (!passes(link)) break
  }
  return { at: at.sha, passed, reach, stamps: at.stamps, status: statusOf(at.stamps), why: "" }
}

// What the walk reads from git: a commit's parents, whether a sha is on canary, and whether a merge re-runs from its parents to its own tree with no conflict.
export type Reads = {
  clean: (sha: string) => Promise<boolean>
  onCanary: (sha: string) => Promise<boolean>
  parents: (sha: string) => Promise<string[]>
}

// How far back the walk goes before it stops.
export const WALK_LIMIT = 30

// The walk back from head along first parents, past clean canary merges and the reviewer's looks, to the first commit that is neither.
export async function walk(head: string, stamps: Stamp[], reads: Reads): Promise<Link[]> {
  const links: Link[] = []
  let sha: string | undefined = head
  while (sha && links.length < WALK_LIMIT) {
    const parents = await reads.parents(sha)
    const held = stampsAt(stamps, sha)
    const [first, second] = parents
    const merge = parents.length === 2 && !!second && (await reads.onCanary(second))
    const link = { clean: merge && (await reads.clean(sha)), merge, sha, stamps: held }
    links.push(link)
    if (!passes(link)) break
    sha = first
  }
  return links
}

// Runs git with these arguments, as merge.ts's Run does.
export type Exec = (args: string[]) => Promise<{ code: number; stderr: string; stdout: string }>

// The walk's reads from git in a checkout that holds the head and origin/canary.
export const readsOf = (git: Exec): Reads => ({
  clean: async (sha) => {
    const refs = await git(["rev-parse", `${sha}^1`, `${sha}^2`, `${sha}^{tree}`])
    const [first, second, own] = refs.stdout.split("\n").map((line) => line.trim())
    if (refs.code !== 0 || !first || !second || !own) return false
    const merged = await git(["merge-tree", "--write-tree", first, second])
    return merged.code === 0 && merged.stdout.split("\n")[0]?.trim() === own
  },
  onCanary: async (sha) =>
    (await git(["merge-base", "--is-ancestor", sha, "origin/canary"])).code === 0,
  parents: async (sha) => {
    const read = await git(["rev-list", "--parents", "-n", "1", sha])
    if (read.code !== 0) throw new Error(`the parents of ${sha.slice(0, 7)} did not read`)
    return read.stdout.trim().split(/\s+/).slice(1)
  },
})

// The stamp at head from the PR's comments.
export const stampAt = async (head: string, comments: Said[], owner: string, reads: Reads) =>
  readStamp(await walk(head, stampsIn(comments, owner), reads))

// One GitHub check run on a commit, as `gh api repos/<repo>/commits/<sha>/check-runs` lists it.
export type CheckRun = {
  conclusion: string | null
  html_url: string
  id?: number
  name: string
  skippedSteps?: boolean
  started_at: string | null
  status: string
}

// Pure: whether these stamps, on one commit, ran every check GitHub's gate jobs run: each passed in a green stamp among them.
export const ranSuite = (stamps: Stamp[]): boolean =>
  Object.values(JOB_CHECKS)
    .flat()
    .every((name) =>
      stamps.some((stamp) => stamp.status === "green" && stamp.checks[name]?.status === "pass"),
    )

// Pure: whether a green stamp holds at the head and every check GitHub's gate jobs run passed in it, on the head or carried past clean canary merges and the reviewer's looks, so the jobs' own stamp adds nothing new. Never while canary's tip (its stamps, canary) is red, since only the fix's own run on its head lets it through.
export const suitePassed = (read: StampRead | undefined, canary: Stamp[] = []): boolean =>
  read?.status === "green" &&
  !(canary.length > 0 && statusOf(canary) === "red") &&
  Object.values(JOB_CHECKS)
    .flat()
    .every((name) => read.passed.includes(name))

// Pure: the stamp GitHub's gate jobs earn at sha, for go.py to post as the owner: red as soon as one failed; else wait while one is queued or running or was cancelled, since a cancelled job ran nothing; green when the newest run of each passed; each with its jobs' checks and run ids, and verify skipped when the diff has no dashboard code (dashboard false). Null while a job has no run or was skipped, when suitePassed (nothing the jobs ran is new), or when sha's CI stamp already says it.
export function jobsStamp(
  read: StampRead | undefined,
  sha: string,
  runs: CheckRun[],
  canary: Stamp[] = [],
  dashboard = true,
): string | null {
  if (suitePassed(read, canary)) return null
  const newest = Object.keys(JOB_CHECKS).map(
    (job) =>
      runs
        .filter((run) => run.name === job)
        .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0],
  )
  // a job whose steps the carry skipped ran nothing, though it ends in success
  if (newest.some((run) => !run || run.conclusion === "skipped" || run.skippedSteps)) return null
  const waits = (run?: CheckRun) => run?.status !== "completed" || run.conclusion === "cancelled"
  const failed = newest.filter((run) => !waits(run) && run?.conclusion !== "success")
  const status: StampStatus = failed.length > 0 ? "red" : newest.some(waits) ? "wait" : "green"
  const held = read?.at === sha ? read.stamps.find(isCi) : undefined
  if (held?.status === status) return null
  const checks: Record<string, StampCheck> = {}
  for (const run of newest) {
    if (!run) continue
    const source = /\/actions\/runs\/(\d+)/.exec(run.html_url)?.[1] ?? String(run.id)
    const said =
      run.status !== "completed"
        ? `The ${run.name} job is ${run.status.replace("_", " ")}.`
        : `The ${run.name} job ended ${run.conclusion}.`
    for (const name of JOB_CHECKS[run.name] ?? [])
      checks[name] =
        run.conclusion === "success"
          ? { source, status: "pass" }
          : { comment: said, source, status: waits(run) ? "skip" : "fail" }
  }
  const first = Object.values(checks)[0]
  if (!dashboard && first)
    checks[CHECKS.verify] = {
      comment: "The diff has no dashboard code.",
      source: first.source,
      status: "skip",
    }
  const keys = { checks, commit: sha, status }
  return stampText(
    status === "red"
      ? { ...keys, remark: `The ${failed.map((run) => run?.name).join(" and ")} job failed.` }
      : keys,
  )
}
