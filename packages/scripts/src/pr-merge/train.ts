// The merge train: every queued PR whose gates pass at its head rides one train branch off canary, ops-checks checks the train's head once, and a green train merges each PR into canary in order; a red one is halved until the PR that broke it is found. Each step on the train is the squash GitHub will make (git merge-tree of the PR's head onto the step before, committed with that step as its one parent), so every step's tree is exactly the tree canary holds once that PR merges, and nothing merges unless Checks passed that very tree.
import { mkdir, readdir, rename } from "node:fs/promises"
import { join } from "node:path"

import type { LockStore } from "@packages/redis"

import {
  BASE,
  gatesOf,
  marksReady,
  withReadyDraft,
  type Comment,
  type Gate,
  type PrFacts,
} from "./gates"
import {
  commentsOf,
  type Ended,
  endSessions,
  factsOf,
  gateOptions,
  gh,
  liveEnded,
  lockRootOf,
  MARKED,
  markReady,
  parseMergeTree,
  queuePath,
  readQueue,
  realLockRoot,
  repoOf,
  runGh,
  runGit,
  squashAt,
  storeOf,
  takeLock,
  type Run,
} from "./merge"
import { CHECKS, ranSuite, sourcesOf, stampOf, stampsAt, statusOf, type Stamp } from "./stamp"

export { queuePath, readQueue } from "./merge"

// One PR on the train: its head, the step commit that squashes it onto the step before, and that commit's tree.
export type Step = { commit: string; head: string; n: number; tree: string }

// A PR left off the train: what its merge conflicted with (canary, or the PR ahead of it), and the files.
export type Drop = { files: string[]; head: string; n: number; why: string; with: string }

export type Train = {
  branch: string
  canary: string
  createdAt: string
  dropped: Drop[]
  id: string
  repo: string
  steps: Step[]
}

// A train's stamp on one step, as Checks posts it on every PR up to that step: a stamp holding a train check, at the step's commit, which no other train or PR has.
export type TrainVerdict = { at: string; pass: boolean; suite: boolean; text: string; url?: string }

// Pure: the train stamp a comment by owner holds, null for any other comment.
export function trainVerdictOf(comment: Comment, owner: string): TrainVerdict | null {
  const stamp = stampOf(comment, owner)
  if (!stamp || !(CHECKS.train in stamp.checks)) return null
  const text = `${stamp.status} @ ${stamp.at} · ${sourcesOf(stamp)}`
  return {
    at: stamp.at,
    pass: stamp.status === "green",
    suite: ranSuite([stamp]),
    text,
    url: comment.url,
  }
}

const startsWith = (full: string, short: string) =>
  short.length >= 7 && full.toLowerCase().startsWith(short.toLowerCase())

// Pure: the newest verdict per step of this train, from the owner's comments on any PR in it, by the step commit its stamp names.
export function stepVerdicts(train: Train, comments: Comment[], owner: string) {
  const newest = new Map<number, TrainVerdict>()
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const comment of sorted) {
    const verdict = trainVerdictOf(comment, owner)
    if (!verdict) continue
    const k = train.steps.findIndex((step) => startsWith(step.commit, verdict.at))
    if (k >= 0) newest.set(k + 1, verdict)
  }
  return newest
}

// What to do next with a train: check a step's commit (k, 1-based, PRs 1..k), land the first k PRs (with the PR that broke step k + 1 leaving), or nothing when it carries no PR.
export type Next =
  | { kind: "check"; step: number }
  | { culprit?: number; kind: "land"; upTo: number }
  | { kind: "empty" }

// Pure: bisects the train over its steps, each a prefix of it. The whole train first; green lands it all; red halves between the longest green prefix and the shortest red one until they are one step apart, and that step's PR is the one that broke it. The green prefix lands, and the PRs after the culprit wait for the next train.
export function nextStep(steps: number, results: Map<number, boolean>): Next {
  if (steps === 0) return { kind: "empty" }
  if (results.get(steps) === true) return { kind: "land", upTo: steps }
  let lo = 0
  for (const [k, pass] of results) if (pass && k > lo) lo = k
  let hi = Number.POSITIVE_INFINITY
  for (const [k, pass] of results) if (!pass && k > lo && k < hi) hi = k
  if (!Number.isFinite(hi)) return { kind: "check", step: steps }
  if (hi - lo === 1) return { culprit: hi, kind: "land", upTo: lo }
  return { kind: "check", step: Math.floor((lo + hi) / 2) }
}

// One open PR the train considers: its facts, and where the merge queue puts it.
export type Candidate = { facts: PrFacts; n: number }

// The pr:merge gates a train never asks for, up to date and the stamp, which the train's own stamp on each step replaces; it keeps the tester gate, since its run drives no page.
export const TRAIN_SKIPS = new Set(["stamp", "up to date"])

// Pure: the gates a train judges; suite waives the suite gate: true to ride, since the step's run is still to come, and at land only when the passed step's stamp ran every check GitHub's jobs run.
export const trainGates = (gates: Gate[], suite = false): Gate[] =>
  gates.filter((gate) => !TRAIN_SKIPS.has(gate.name) && !(suite && gate.name === "suite"))

// Pure: whether the newest stamp or train word on a PR, at any head (a stamp, a train's green, or a train's note that it left), is a failure, and at which sha; a stamp counts with every other stamp that holds at its sha, so a tester's green never clears a red from Checks. A train's red is on every PR up to the red step, so only the note to the PR that broke it counts against a PR.
export function lastChecks(
  comments: Comment[],
  owner: string,
): { at: string; pass: boolean } | null {
  let last: { at: string; left?: boolean; pass: boolean } | null = null
  const seen: Stamp[] = []
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const comment of sorted) {
    if (comment.author.toLowerCase() !== owner.toLowerCase()) continue
    const train = trainVerdictOf(comment, owner)
    if (train) {
      if (train.pass) last = { at: train.at, pass: true }
      continue
    }
    const left = LEFT.exec(comment.body.trimStart().split("\n")[0] ?? "")
    if (left?.groups?.head) {
      last = { at: left.groups.head, left: true, pass: false }
      continue
    }
    const stamp = stampOf(comment, owner)
    if (!stamp || stamp.status === "wait") continue
    seen.push(stamp)
    const pass = statusOf(stampsAt(seen, stamp.at)) === "green"
    // a stamp on the head alone says nothing of its merge with the train it broke, so it leaves that note standing
    if (pass && last && !last.pass && last.left && startsWith(last.at, stamp.at)) continue
    last = { at: stamp.at, pass }
  }
  return last && { at: last.at, pass: last.pass }
}

// Pure: a PR's place in the merge queue, any PR it does not list after every one it does, by number.
const placeIn = (queue: number[]) => (n: number) => {
  const i = queue.indexOf(n)
  return i === -1 ? queue.length + n : i
}

// The first line of the note a culprit gets when it leaves a train.
const LEFT = new RegExp(
  "^Train\\s+\\S+:\\s*#\\d+\\s+left the train at\\s+(?<head>[0-9a-f]{7,40}):\\s*Checks failed",
  "i",
)

// Pure: the order a train takes PRs in, with no head-of-line blocking: queued PRs in the merge queue's order, then any other, by number; a PR whose newest Checks or CI word failed at an earlier head rejoins at the back, and one that failed at its current head stays off until it is fixed.
export function trainOrder(
  candidates: Candidate[],
  queue: number[],
): { order: Candidate[]; held: { n: number; why: string }[] } {
  const place = placeIn(queue)
  const front: Candidate[] = []
  const back: Candidate[] = []
  const held: { n: number; why: string }[] = []
  for (const candidate of [...candidates].sort((a, b) => place(a.n) - place(b.n))) {
    const last = lastChecks(candidate.facts.comments, candidate.facts.owner)
    if (last && !last.pass && startsWith(candidate.facts.head, last.at)) {
      held.push({
        n: candidate.n,
        why: `its stamp is red at its head ${last.at.slice(0, 7)}`,
      })
    } else if (last && !last.pass) back.push(candidate)
    else front.push(candidate)
  }
  return { held, order: [...front, ...back] }
}

const IDENTITY = ["-c", "user.name=pr:train", "-c", "user.email=pr-train@localhost"]

const git1 = async (git: Run, args: string[]): Promise<string> => {
  const result = await git(args)
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${result.code}: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

// git merge-tree --write-tree of two commits: the tree, or the files that conflict.
async function mergeTree(
  git: Run,
  ours: string,
  theirs: string,
): Promise<{ tree: string } | { files: string[] }> {
  const result = await git(["merge-tree", "--write-tree", "--name-only", ours, theirs])
  const merged = parseMergeTree(result)
  if (!merged) {
    throw new Error(
      `git merge-tree ${ours} ${theirs} exited ${result.code}: ${result.stderr.trim()}`,
    )
  }
  return merged.clean ? { tree: merged.tree } : { files: merged.files }
}

// Squashes each PR's head onto canary and the steps before it, in order, as GitHub's squash merge will; a PR whose merge conflicts is dropped, naming what it conflicts with: canary itself, else each PR ahead of it whose head alone conflicts with it.
export async function chainOf(
  git: Run,
  canary: string,
  picks: { head: string; n: number }[],
  id: string,
): Promise<{ dropped: Drop[]; steps: Step[] }> {
  const steps: Step[] = []
  const dropped: Drop[] = []
  let base = canary
  for (const pick of picks) {
    const merged = await mergeTree(git, base, pick.head)
    if ("files" in merged) {
      const alone = await mergeTree(git, canary, pick.head)
      const ahead: string[] = []
      if ("tree" in alone) {
        for (const step of steps) {
          if ("files" in (await mergeTree(git, step.head, pick.head))) ahead.push(`#${step.n}`)
        }
      }
      const against = "files" in alone ? BASE : ahead.join(", ") || "the PRs ahead of it"
      dropped.push({
        files: merged.files,
        head: pick.head,
        n: pick.n,
        why: `conflicts with ${against} in ${merged.files.join(", ")}`,
        with: against,
      })
      continue
    }
    const message = `train ${id}: #${pick.n} at ${pick.head.slice(0, 7)}`
    const commit = await git1(git, [
      ...IDENTITY,
      "commit-tree",
      merged.tree,
      "-p",
      base,
      "-m",
      message,
    ])
    steps.push({ commit, head: pick.head, n: pick.n, tree: merged.tree })
    base = commit
  }
  return { dropped, steps }
}

// Where trains are kept: trains/<id>.json beside the merge lock, and trains/done/ once a train has ended.
export const trainsDir = (lockRoot: string) => join(lockRoot, "trains")

export const readTrain = async (lockRoot: string, id: string): Promise<Train> => {
  if (!/^[0-9A-Za-z-]+$/.test(id)) throw new Error(`no train named ${id}`)
  const file = Bun.file(join(trainsDir(lockRoot), `${id}.json`))
  if (!(await file.exists())) throw new Error(`no train named ${id} in ${trainsDir(lockRoot)}`)
  return (await file.json()) as Train
}

// The newest train still running, so ops-checks can say `next` and `land` without remembering its id.
export async function currentTrain(lockRoot: string): Promise<string | null> {
  const names = await readdir(trainsDir(lockRoot)).catch(() => [] as string[])
  const ids = names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5))
  return ids.sort().at(-1) ?? null
}

export type TrainOptions = { repo?: string }

// What runs outside GitHub: git in this checkout, the folder the lock and trains live in, the merge queue, the clock, how a PR's facts are read (factsOf, unless a test hands its own), and the Redis store that holds the lock (as pr:merge's).
export type TrainLocal = {
  ended?: Ended
  facts?: (run: Run, repo: string, n: number) => Promise<PrFacts>
  git?: Run
  lockRoot?: string
  now?: () => Date
  queue?: string
  store?: LockStore | null
}

// The scripts whose runs are real, ci:go's for its forecast; anywhere else, as under test, a run needs a git stub and a scratch lockRoot.
const REAL_RUNS = ["go-cli.ts", "train-cli.ts"]

export function resolve(local: TrainLocal, main = Bun.main) {
  const git = local.git ?? runGit
  const lockRoot = local.lockRoot ?? lockRootOf()
  const cli = REAL_RUNS.some((file) => main === join(import.meta.dir, file))
  if (!cli && (!local.git || lockRoot === realLockRoot())) {
    throw new Error("pr:train under test needs a git stub and a scratch lockRoot")
  }
  return {
    cli,
    facts: local.facts ?? ((run: Run, repo: string, n: number) => factsOf(run, repo, n, git)),
    git,
    lockRoot,
    now: local.now ?? (() => new Date()),
    queue: local.queue ?? queuePath(),
  }
}

// The repo owner's open PRs into canary, by number, drafts only when asked; a PR by anyone else never rides a train.
async function openPrs(run: Run, repo: string, drafts = false): Promise<number[]> {
  const owner = repo.split("/")[0]?.toLowerCase() ?? ""
  const listed = await gh(run, [
    "pr",
    "list",
    "-R",
    repo,
    "--base",
    BASE,
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,author,isDraft",
    "--jq",
    ".[] | {author: .author.login, draft: .isDraft, n: .number} | tojson",
  ])
  return listed
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { author: string; draft: boolean; n: number })
    .filter((pr) => pr.author.toLowerCase() === owner && (drafts || !pr.draft))
    .map((pr) => pr.n)
}

async function fetchHeads(git: Run, ns: number[]) {
  await git1(git, ["fetch", "--quiet", "origin", BASE, ...ns.map((n) => `refs/pull/${n}/head`)])
  return git1(git, ["rev-parse", `origin/${BASE}`])
}

// Pure: PR numbers in the merge queue's order, then any others by number.
export const sortByQueue = (ns: number[], queue: number[]): number[] => {
  const place = placeIn(queue)
  return [...ns].sort((a, b) => place(a) - place(b))
}

const headOf = async (run: Run, repo: string, n: number) =>
  gh(run, ["pr", "view", String(n), "-R", repo, "--json", "headRefOid", "--jq", ".headRefOid"])

export type Forecast = { canary: string; conflicts: Drop[]; order: number[] }

// The early merge test: each open PR, gated or not and drafts included, merged onto canary and every PR ahead of it in the queue, so a conflict with a PR still in review is found and fixed before that PR lands rather than after. Writes nothing on GitHub.
export async function forecast(
  { repo }: TrainOptions,
  run: Run = runGh,
  local: TrainLocal = {},
): Promise<Forecast> {
  const { git, queue } = resolve(local)
  const name = await repoOf(run, repo)
  const order = sortByQueue(await openPrs(run, name, true), await readQueue(queue))
  const canary = await fetchHeads(git, order)
  const picks = await Promise.all(order.map(async (n) => ({ head: await headOf(run, name, n), n })))
  const { dropped } = await chainOf(git, canary, picks, "forecast")
  return { canary, conflicts: dropped, order }
}

// The owner's open PRs a train takes, in trainOrder, a draft that passes but for ready included: each whose gates (all of pr:merge's but up to date and the stamp, which the train's own run replaces) pass at its head, and why each other one is held.
export async function gatedOf(
  run: Run,
  name: string,
  facts: (run: Run, repo: string, n: number) => Promise<PrFacts>,
  queue: string,
): Promise<{ held: { n: number; why: string }[]; order: Candidate[] }> {
  const options = await gateOptions(name)
  const held: { n: number; why: string }[] = []
  const candidates: Candidate[] = []
  for (const n of await openPrs(run, name, true)) {
    const read = await facts(run, name, n)
    const gates = trainGates(gatesOf(read, options), true)
    const failed = withReadyDraft(read, gates, MARKED).filter((gate) => !gate.ok)
    if (failed.length === 0) candidates.push({ facts: read, n })
    else
      held.push({
        n,
        why: `not gated: ${failed.map((gate) => (gate.name === "held" ? `held (${gate.detail})` : gate.name)).join(", ")}`,
      })
  }
  const { held: failing, order } = trainOrder(candidates, await readQueue(queue))
  return { held: [...held, ...failing], order }
}

export type Built = {
  held: { n: number; why: string }[]
  train: Train | null
}

const timeId = (date: Date) =>
  date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")

// Builds a train: every open PR of the owner's whose gates (all but up to date and the stamp, which the train's own run replaces) pass at its head, a draft included when only ready fails, since land marks it ready, in trainOrder, squashed in turn onto canary; each one that conflicts is dropped and told so on its PR. The train's branch is pushed for ops-checks to fetch, and the train is kept in trains/<id>.json. dryRun builds the steps locally and tells nobody, pushes nothing and keeps nothing.
export async function buildTrain(
  { dryRun = false, repo }: TrainOptions & { dryRun?: boolean },
  run: Run = runGh,
  local: TrainLocal = {},
): Promise<Built> {
  const { facts, git, lockRoot, now, queue } = resolve(local)
  const running = await currentTrain(lockRoot)
  if (running && !dryRun) throw new Error(`train ${running} is still running; land or end it first`)
  const name = await repoOf(run, repo)
  const owner = name.split("/")[0]?.toLowerCase() ?? ""
  const { held, order } = await gatedOf(run, name, facts, queue)
  if (order.length === 0) return { held, train: null }
  const canary = await fetchHeads(
    git,
    order.map((c) => c.n),
  )
  const id = timeId(now())
  const picks = order.map((c) => ({ head: c.facts.head, n: c.n }))
  const { dropped, steps } = await chainOf(git, canary, picks, id)
  const train: Train = {
    branch: `train/${id}`,
    canary,
    createdAt: now().toISOString(),
    dropped,
    id,
    repo: name,
    steps,
  }
  if (dryRun) return { held, train }
  const last = steps.at(-1)
  if (last)
    await git1(git, ["push", "--quiet", "origin", `${last.commit}:refs/heads/${train.branch}`])
  await mkdir(trainsDir(lockRoot), { recursive: true })
  if (steps.length > 0)
    await Bun.write(join(trainsDir(lockRoot), `${id}.json`), `${JSON.stringify(train, null, 2)}\n`)
  for (const drop of dropped) {
    const told = new RegExp(`^Train \\S+: #${drop.n} left out at ${drop.head.slice(0, 7)}:`)
    const said = await commentsOf(run, name, drop.n)
    if (said.some((c) => c.author.toLowerCase() === owner && told.test(c.body))) continue
    const body = [
      `Train ${id}: #${drop.n} left out at ${drop.head.slice(0, 7)}: it ${drop.why}.`,
      "",
      `Merge ${drop.with === BASE ? BASE : `the head of ${drop.with}`} into this branch and resolve, and it rides the next train.`,
    ].join("\n")
    await gh(run, ["pr", "comment", String(drop.n), "-R", name, "--body", body])
  }
  return { held, train }
}

// Every comment on the train's PRs, which carry its step stamps.
async function trainComments(run: Run, train: Train): Promise<Comment[]> {
  const all: Comment[] = []
  for (const step of train.steps) all.push(...(await commentsOf(run, train.repo, step.n)))
  return all
}

export type Judged = { next: Next; train: Train; verdicts: Map<number, TrainVerdict> }

// Reads a train's step stamps and says what comes next: the step to check, or the PRs to land.
export async function judgeTrain(
  id: string,
  run: Run = runGh,
  local: TrainLocal = {},
): Promise<Judged> {
  const { lockRoot } = resolve(local)
  const train = await readTrain(lockRoot, id)
  const owner = train.repo.split("/")[0] ?? ""
  const verdicts = stepVerdicts(train, await trainComments(run, train), owner)
  const results = new Map([...verdicts].map(([k, v]) => [k, v.pass]))
  return { next: nextStep(train.steps.length, results), train, verdicts }
}

// Deletes a train's branch and moves its record into trains/done/.
export async function endTrain(id: string, local: TrainLocal = {}): Promise<void> {
  const { git, lockRoot } = resolve(local)
  const train = await readTrain(lockRoot, id)
  const deleted = await git(["push", "--quiet", "origin", "--delete", train.branch])
  if (deleted.code !== 0 && !/remote ref does not exist/i.test(deleted.stderr)) {
    throw new Error(
      `git push --delete ${train.branch} exited ${deleted.code}: ${deleted.stderr.trim()}`,
    )
  }
  await mkdir(join(trainsDir(lockRoot), "done"), { recursive: true })
  await rename(
    join(trainsDir(lockRoot), `${id}.json`),
    join(trainsDir(lockRoot), "done", `${id}.json`),
  )
}

export type Landed =
  | { kind: "check"; step: number }
  | { holder: string; kind: "locked" }
  | { kind: "refused"; problems: string[] }
  | {
      culprit?: number
      kind: "landed"
      merged: { n: number; sha: string }[]
      notEnded?: string
      stopped?: string
    }

// Lands what a train's verdicts allow, under the factory's merge lock: canary must still be the train's, every PR up to the landed step still at its step's head, passing its gates (all but up to date and the stamp) and carrying the owner's green train stamp for that step; then each squash-merges in order, the merge of each predicted first and canary's tree checked after it against its step's tree, stopping at the first that differs. The PRs merged are told the train and its Checks, a culprit is told it left, and the train ends.
export async function landTrain(
  id: string,
  run: Run = runGh,
  local: TrainLocal = {},
): Promise<Landed> {
  const { cli, facts, git, lockRoot } = resolve(local)
  const store = await storeOf(local, cli)
  let landed: Landed
  let judged: Judged | null = null
  try {
    const lock = await takeLock(lockRoot, `train ${id}`, { store })
    if ("holder" in lock) return { holder: lock.holder, kind: "locked" }
    try {
      judged = await judgeTrain(id, run, local)
      landed = await landUnderLock(judged, run, git, facts)
    } finally {
      await lock.release()
    }
  } finally {
    store?.close()
  }
  if (!judged || judged.next.kind !== "land") return landed
  const { next, train, verdicts } = judged
  const culprit = next.culprit === undefined ? undefined : train.steps[next.culprit - 1]
  if (culprit && (landed.kind === "landed" || landed.kind === "refused")) {
    await tellCulprit(run, train, culprit, verdicts.get(next.culprit ?? 0))
  }
  if (landed.kind !== "landed") return landed
  const passed = verdicts.get(next.upTo)
  const cited = `The stamp on train ${train.id}, step ${next.upTo} of ${train.steps.length}: ${passed?.text ?? "none"}${passed?.url ? ` (${passed.url})` : ""}`
  const last = landed.merged.at(-1)
  const unchecked =
    landed.stopped && last
      ? `The train stopped after this (${landed.stopped}), so canary ${last.sha.slice(0, 7)} holds a tree no run stamped: canary's own run stamps it next.`
      : ""
  for (const [i, merged] of landed.merged.entries()) {
    const step = train.steps[i]
    const head = step?.head.slice(0, 7)
    const body = [
      `Merged by bun run pr:train at ${head}: train ${train.id}, step ${i + 1} of ${next.upTo}, as ${merged.sha.slice(0, 7)}.`,
      "",
      cited,
      ...(unchecked && merged === last ? ["", unchecked] : []),
    ].join("\n")
    await gh(run, ["pr", "comment", String(merged.n), "-R", train.repo, "--body", body])
  }
  const why = landed.stopped
    ? `the train stopped: ${landed.stopped}`
    : `#${culprit?.n} broke the step it joined`
  for (const step of train.steps.slice(landed.merged.length)) {
    if (step === culprit) continue
    const body = `Train ${train.id}: #${step.n} did not merge at ${step.head.slice(0, 7)}, since ${why}. It rides the next train.`
    await gh(run, ["pr", "comment", String(step.n), "-R", train.repo, "--body", body])
  }
  for (const merged of landed.merged)
    await endSessions(
      `https://github.com/${train.repo}/pull/${merged.n}`,
      merged.sha,
      local.ended ?? (cli ? liveEnded : undefined),
    )
  try {
    await endTrain(id, local)
  } catch (error) {
    return { ...landed, notEnded: error instanceof Error ? error.message : String(error) }
  }
  return landed
}

// Tells the PR a train bisected to that it left, once per head: it is known to break the train as soon as the bisect names it, so a land refused for another reason (canary moved, a head moved) tells it too, and it goes to the back of the next train.
async function tellCulprit(run: Run, train: Train, culprit: Step, red?: TrainVerdict) {
  const head7 = culprit.head.slice(0, 7)
  const owner = train.repo.split("/")[0]?.toLowerCase() ?? ""
  const said = await commentsOf(run, train.repo, culprit.n)
  const told = said.some((c) => {
    const left = LEFT.exec(c.body.trimStart().split("\n")[0] ?? "")
    return c.author.toLowerCase() === owner && left?.groups?.head === head7
  })
  if (told) return
  const body = [
    `Train ${train.id}: #${culprit.n} left the train at ${head7}: Checks failed once it joined.`,
    "",
    `${red?.text ?? ""}${red?.url ? ` (${red.url})` : ""}`,
    "",
    "Fix it and push; it rejoins at the back of the next train.",
  ].join("\n")
  await gh(run, ["pr", "comment", String(culprit.n), "-R", train.repo, "--body", body])
}

async function landUnderLock(
  { next, train }: Judged,
  run: Run,
  git: Run,
  facts: (run: Run, repo: string, n: number) => Promise<PrFacts>,
): Promise<Landed> {
  if (next.kind === "empty") return { kind: "refused", problems: ["the train carries no PR"] }
  if (next.kind === "check") return { kind: "check", step: next.step }
  const culprit = next.culprit === undefined ? undefined : train.steps[next.culprit - 1]?.n
  const prefix = train.steps.slice(0, next.upTo)
  if (prefix.length === 0) return { culprit, kind: "landed", merged: [] }
  const step = prefix.at(-1) as Step
  const canary = await fetchHeads(
    git,
    prefix.map((s) => s.n),
  )
  const problems: string[] = []
  if (canary !== train.canary) {
    problems.push(
      `canary is ${canary.slice(0, 7)}, not the train's ${train.canary.slice(0, 7)}: build a new train`,
    )
  }
  const options = await gateOptions(train.repo)
  const drafts = new Set<number>()
  for (const s of prefix) {
    const read = await facts(run, train.repo, s.n)
    if (read.head !== s.head) {
      problems.push(
        `#${s.n} moved to ${read.head.slice(0, 7)} from the train's ${s.head.slice(0, 7)}`,
      )
      continue
    }
    const passed = stepVerdicts(train, read.comments, read.owner).get(next.upTo)
    const judged = trainGates(gatesOf(read, options), passed?.suite ?? false)
    if (marksReady(read, judged)) drafts.add(s.n)
    for (const gate of withReadyDraft(read, judged, MARKED).filter((g) => !g.ok)) {
      problems.push(`#${s.n} ${gate.name}: ${gate.detail}`)
    }
    if (!passed?.pass) {
      problems.push(
        `#${s.n} has no green stamp from ${read.owner} for train ${train.id} at ${step.commit.slice(0, 7)}`,
      )
    }
  }
  if (problems.length > 0) return { kind: "refused", problems }
  const merged: { n: number; sha: string }[] = []
  try {
    return await squashInOrder(run, git, train, prefix, culprit, merged, drafts)
  } catch (error) {
    // GitHub may have merged the PR in hand before the error: canary holding its step's tree says it did.
    const step = prefix[merged.length]
    await git(["fetch", "--quiet", "origin", BASE])
    const tree = await git(["rev-parse", `origin/${BASE}^{tree}`]).catch(() => null)
    const head = await git(["rev-parse", `origin/${BASE}`]).catch(() => null)
    const moved = head && head.stdout.trim() !== (merged.at(-1)?.sha ?? train.canary)
    if (step && tree?.stdout.trim() === step.tree && moved) {
      merged.push({ n: step.n, sha: head.stdout.trim() })
    }
    if (merged.length === 0) throw error
    const why = error instanceof Error ? error.message : String(error)
    return {
      culprit,
      kind: "landed",
      merged,
      stopped: `an error after ${merged.length} merged: ${why}`,
    }
  }
}

// Squash-merges each step's PR in order onto canary, marking a draft ready just before its squash, filling merged as each lands so a throw part-way still says which merged.
async function squashInOrder(
  run: Run,
  git: Run,
  train: Train,
  prefix: Step[],
  culprit: number | undefined,
  merged: { n: number; sha: string }[],
  drafts: Set<number>,
): Promise<Landed> {
  for (const s of prefix) {
    const now = await git1(git, ["rev-parse", `origin/${BASE}`])
    const predicted = await mergeTree(git, now, s.head)
    if (!("tree" in predicted) || predicted.tree !== s.tree) {
      return {
        culprit,
        kind: "landed",
        merged,
        stopped: `#${s.n} would not merge onto canary ${now.slice(0, 7)} as its step's tree ${s.tree.slice(0, 7)}`,
      }
    }
    const unready = drafts.has(s.n) ? await markReady(run, train.repo, s.n) : null
    if (unready) return { culprit, kind: "landed", merged, stopped: `#${s.n}: ${unready}` }
    const squashed = await squashAt(run, train.repo, s.n, s.head)
    if ("reason" in squashed)
      return {
        culprit,
        kind: "landed",
        merged,
        stopped: `#${s.n}: ${squashed.reason}`,
      }
    merged.push({ n: s.n, sha: squashed.sha })
    await git1(git, ["fetch", "--quiet", "origin", BASE])
    const tree = await git1(git, ["rev-parse", `origin/${BASE}^{tree}`])
    if (tree !== s.tree) {
      return {
        culprit,
        kind: "landed",
        merged,
        stopped: `canary holds tree ${tree.slice(0, 7)} after #${s.n}, not its step's ${s.tree.slice(0, 7)}`,
      }
    }
  }
  return { culprit, kind: "landed", merged }
}
