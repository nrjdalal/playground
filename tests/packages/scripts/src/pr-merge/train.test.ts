import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Comment, PrFacts } from "../../../../../packages/scripts/src/pr-merge/gates"
import type { LostLine } from "../../../../../packages/scripts/src/pr-merge/lost"
import type { Run, RunResult } from "../../../../../packages/scripts/src/pr-merge/merge"
import { stampText, type StampKeys } from "../../../../../packages/scripts/src/pr-merge/stamp"
import {
  buildTrain,
  endTrain,
  forecast,
  judgeTrain,
  landTrain,
  lastChecks,
  nextStep,
  resolve,
  trainOrder,
  trainVerdictOf,
  type Candidate,
  type Train,
} from "../../../../../packages/scripts/src/pr-merge/train"
import "./scratch-config"
import { suiteChecks } from "./suite"

// Each test runs real git against a scratch origin, slower than bun's 5s default on a loaded machine.
setDefaultTimeout(30_000)

const scratch = mkdtempSync(join(tmpdir(), "pr-train-"))
// No test may take the factory's real lock or read its real queue.
process.env.PLAYGROUND_MERGE_LOCK_DIR = join(scratch, "default-lock")
process.env.PLAYGROUND_MERGE_QUEUE = join(scratch, "no-queue.json")
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const REPO = "o/r"
const OWNER = "o"
const ok = (stdout = ""): RunResult => ({ code: 0, stderr: "", stdout })

let clock = 0
const at = () => new Date(Date.UTC(2026, 9, 7, 17, 0, clock++)).toISOString()
const said = (body: string, author = OWNER): Comment => ({ author, body, createdAt: at() })

// The owner's stamp at sha, as Checks (or, with drive, a tester) posts it.
const stamped = (sha: string, status: StampKeys["status"], checks: StampKeys["checks"] = {}) =>
  said(stampText({ checks, commit: sha, status }))

const ENV = {
  ...process.env,
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_AUTHOR_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
}

// A scratch world: a bare origin with canary, a clone pr:train runs git in, and each PR's head pushed to origin as refs/pull/<n>/head. edits names, per PR, the files it writes over the base.
function world(edits: Record<number, Record<string, string>>) {
  const root = mkdtempSync(join(scratch, "world-"))
  const origin = join(root, "origin.git")
  const work = join(root, "work")
  const sh = (cwd: string, ...args: string[]) => {
    const proc = Bun.spawnSync(["git", "-C", cwd, ...args], { env: ENV })
    if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`)
    return proc.stdout.toString().trim()
  }
  Bun.spawnSync(["git", "init", "--quiet", "--bare", "--initial-branch=canary", origin])
  Bun.spawnSync(["git", "init", "--quiet", "--initial-branch=canary", work])
  sh(work, "remote", "add", "origin", origin)
  for (const file of ["a.txt", "b.txt", "c.txt", "d.txt"])
    writeFileSync(join(work, file), "one\ntwo\nthree\n")
  sh(work, "add", "-A")
  sh(work, "commit", "--quiet", "--no-verify", "-m", "base")
  sh(work, "push", "--quiet", "origin", "canary")
  const heads: Record<number, string> = {}
  for (const [n, files] of Object.entries(edits)) {
    sh(work, "checkout", "--quiet", "-B", `pr${n}`, "canary")
    for (const [file, text] of Object.entries(files)) writeFileSync(join(work, file), text)
    sh(work, "add", "-A")
    sh(work, "commit", "--quiet", "--no-verify", "-m", `pr ${n}`)
    heads[Number(n)] = sh(work, "rev-parse", "HEAD")
    sh(work, "push", "--quiet", "origin", `HEAD:refs/pull/${n}/head`)
  }
  sh(work, "checkout", "--quiet", "--detach", "canary")
  const git: Run = async (args) => {
    const proc = Bun.spawnSync(["git", "-C", work, ...args], { env: ENV })
    return { code: proc.exitCode, stderr: proc.stderr.toString(), stdout: proc.stdout.toString() }
  }
  return { git, heads, origin, root, sh, work }
}

type World = ReturnType<typeof world>

// A stubbed gh over a world: open PRs, comments kept per PR (pr comment adds one, unless mute names the PR), and pr merge squashing the head onto origin's canary as GitHub does, unless refuse names the PR (skew merges it as no change); blind makes reading a PR's merge state fail.
function hub(w: World, open: number[], drafts: number[] = []) {
  const blind = new Set<number>()
  const mute = new Set<number>()
  const refuse = new Set<number>()
  const skew = new Set<number>()
  const comments: Record<number, Comment[]> = {}
  const merged: Record<number, string> = {}
  const calls: string[][] = []
  const run: Run = async (args) => {
    calls.push(args)
    const joined = args.join(" ")
    if (joined.startsWith("pr list")) {
      return ok(
        open
          .filter((n) => !merged[n])
          .map((n) => JSON.stringify({ author: OWNER, draft: drafts.includes(n), n }))
          .join("\n"),
      )
    }
    if (joined.startsWith("pr ready")) return ok()
    if (joined.startsWith("pr comment")) {
      const n = Number(args[2])
      if (mute.has(n)) return { code: 1, stderr: "HTTP 403", stdout: "" }
      ;(comments[n] ??= []).push(said(args.at(-1) ?? ""))
      return ok()
    }
    const listed = /issues\/(\d+)\/comments/.exec(joined)
    if (listed) {
      return ok((comments[Number(listed[1])] ?? []).map((c) => JSON.stringify(c)).join("\n"))
    }
    if (joined.startsWith("pr view") && joined.includes("headRefOid")) {
      return ok(w.heads[Number(args[2])] ?? "")
    }
    if (joined.startsWith("pr view") && joined.includes("--json body")) return ok()
    if (joined.startsWith("pr merge")) {
      const n = Number(args[2])
      const head = args.at(-1) ?? ""
      if (head !== w.heads[n]) return { code: 1, stderr: "head moved", stdout: "" }
      if (refuse.has(n)) return { code: 1, stderr: "Pull request is not mergeable", stdout: "" }
      const before = w.sh(w.work, "rev-parse", "origin/canary")
      w.sh(w.work, "fetch", "--quiet", "origin", "canary")
      const tree = skew.has(n)
        ? w.sh(w.work, "rev-parse", "origin/canary^{tree}")
        : (w.sh(w.work, "merge-tree", "--write-tree", "origin/canary", head).split("\n")[0] ?? "")
      const sha = w.sh(w.work, "commit-tree", tree, "-p", "origin/canary", "-m", `#${n} (squash)`)
      w.sh(w.work, "push", "--quiet", "origin", `${sha}:refs/heads/canary`)
      // GitHub merges on its side, so this clone's origin/canary stays where it was until a fetch.
      w.sh(w.work, "update-ref", "refs/remotes/origin/canary", before)
      merged[n] = sha
      return ok()
    }
    if (joined.startsWith("pr view") && joined.includes("mergeCommit")) {
      if (blind.has(Number(args[2]))) return { code: 1, stderr: "HTTP 502", stdout: "" }
      const sha = merged[Number(args[2])]
      return ok(
        JSON.stringify({
          mergeCommit: sha ? { oid: sha } : null,
          state: sha ? "MERGED" : "OPEN",
        }),
      )
    }
    return { code: 1, stderr: `unexpected gh ${joined}`, stdout: "" }
  }
  return { blind, calls, comments, merged, mute, refuse, run, skew }
}

type Hub = ReturnType<typeof hub>

// Each PR's facts: gated at its head (5/5 and a green stamp there) unless red names it, or with no stamp at all when unrun names it, with every comment the hub holds for it.
const factsFor =
  (
    w: World,
    h: Hub,
    red: number[] = [],
    held: Record<number, string> = {},
    lost: Record<number, LostLine[]> = {},
    drafts: number[] = [],
    unrun: number[] = [],
  ) =>
  async (_run: Run, _repo: string, n: number): Promise<PrFacts> => {
    const head = w.heads[n] ?? ""
    const sha7 = head.slice(0, 7)
    const gated = [
      said(`## ReviewBot · round 1: 5/5 at ${sha7} · 0 blocking`),
      ...(unrun.includes(n) ? [] : [stamped(head, red.includes(n) ? "red" : "green")]),
    ].map((c) => ({ ...c, createdAt: "2026-10-07T16:00:00.000Z" }))
    return {
      aheadBy: 1,
      author: OWNER,
      base: "canary",
      canary: "",
      checks: [],
      comments: [...gated, ...(h.comments[n] ?? [])],
      draft: drafts.includes(n),
      files: ["packages/scripts/src/x.ts"],
      head,
      held: held[n] ?? null,
      lost: lost[n] ?? [],
      mergeTree: null,
      n,
      owner: OWNER,
      stamp: { passed: [], reach: [head], stamps: [], why: "the train's own stamp stands in" },
      state: "OPEN",
    }
  }

const localOf = (
  w: World,
  h: Hub,
  extra: {
    drafts?: number[]
    held?: Record<number, string>
    lost?: Record<number, LostLine[]>
    queue?: number[]
    red?: number[]
    unrun?: number[]
  } = {},
) => {
  const lockRoot = mkdtempSync(join(w.root, "lock-"))
  const queue = join(w.root, "queue.json")
  writeFileSync(queue, JSON.stringify({ queue: (extra.queue ?? []).map((pr) => ({ pr })) }))
  return {
    facts: factsFor(w, h, extra.red, extra.held, extra.lost, extra.drafts, extra.unrun),
    git: w.git,
    lockRoot,
    now: () => new Date(Date.UTC(2026, 9, 7, 17, 30, clock++)),
    queue,
  }
}

// ops-checks' part: post a step's stamp, with its train check, on every PR up to that step.
function check(h: Hub, train: Train, step: number, pass: boolean) {
  const s = train.steps[step - 1]
  if (!s) throw new Error(`no step ${step}`)
  const train1 = {
    ...suiteChecks(),
    train: { source: "local", status: pass ? ("pass" as const) : ("fail" as const) },
  }
  for (const earlier of train.steps.slice(0, step))
    (h.comments[earlier.n] ??= []).push(stamped(s.commit, pass ? "green" : "red", train1))
}

const edit = (line: string) => `one\n${line}\nthree\n`

describe("pr:train", () => {
  test("a green train of three merges each PR in queue order, onto exactly the tree Checks passed", async () => {
    const w = world({
      11: { "a.txt": edit("A") },
      12: { "b.txt": edit("B") },
      13: { "c.txt": edit("C") },
    })
    const h = hub(w, [13, 11, 12])
    const local = localOf(w, h, { queue: [12, 11, 13] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    expect(train.steps.map((s) => s.n)).toEqual([12, 11, 13])
    expect(train.dropped).toEqual([])
    expect(w.sh(w.origin, "rev-parse", `refs/heads/${train.branch}`)).toBe(
      train.steps[2]?.commit ?? "",
    )
    expect((await judgeTrain(train.id, h.run, local)).next).toEqual({ kind: "check", step: 3 })
    check(h, train, 3, true)
    expect((await judgeTrain(train.id, h.run, local)).next).toEqual({ kind: "land", upTo: 3 })
    const ended: string[] = []
    const landed = await landTrain(train.id, h.run, {
      ...local,
      ended: async (url, sha) => void ended.push(`${url} ${sha.length}`),
    })
    expect(landed).toMatchObject({ kind: "landed" })
    if (landed.kind !== "landed") return
    expect(landed.merged.map((m) => m.n)).toEqual([12, 11, 13])
    // each merged PR's sessions end right after the land
    expect(ended).toEqual([12, 11, 13].map((n) => `https://github.com/${REPO}/pull/${n} 40`))
    expect(landed.stopped).toBeUndefined()
    expect(w.sh(w.origin, "rev-parse", "canary^{tree}")).toBe(train.steps[2]?.tree ?? "")
    for (const n of [11, 12, 13]) {
      expect(h.comments[n]?.at(-1)?.body).toContain(`Merged by bun run pr:train`)
      expect(h.comments[n]?.at(-1)?.body).toContain(`train ${train.id}`)
    }
    expect(w.sh(w.origin, "branch", "--list", "train/*")).toBe("")
    expect(existsSync(join(local.lockRoot, "trains", "done", `${train.id}.json`))).toBe(true)
    expect(existsSync(join(local.lockRoot, "merge.lock"))).toBe(false)
  })

  test("a PR that conflicts with one ahead of it is left out of the train and told which, and the rest still ride", async () => {
    const w = world({
      21: { "a.txt": edit("A") },
      22: { "b.txt": edit("B from 22") },
      23: { "b.txt": edit("B from 23") },
      24: { "d.txt": edit("D") },
    })
    const h = hub(w, [21, 22, 23, 24])
    const local = localOf(w, h, { queue: [21, 22, 23, 24] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    expect(train?.steps.map((s) => s.n)).toEqual([21, 22, 24])
    expect(train?.dropped).toMatchObject([{ files: ["b.txt"], n: 23, with: "#22" }])
    expect(h.comments[23]?.at(-1)?.body).toStartWith(`Train ${train?.id}: #23 left out at`)
    expect(h.comments[23]?.at(-1)?.body).toContain("conflicts with #22 in b.txt")
  })

  test("a red train bisects to the one PR that broke it, lands the green steps before it, and the culprit leaves", async () => {
    const w = world({
      31: { "a.txt": edit("A") },
      32: { "b.txt": edit("B") },
      33: { "c.txt": edit("C") },
    })
    const h = hub(w, [31, 32, 33])
    const local = localOf(w, h, { queue: [31, 32, 33] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 3, false)
    expect((await judgeTrain(train.id, h.run, local)).next).toEqual({ kind: "check", step: 1 })
    check(h, train, 1, true)
    expect((await judgeTrain(train.id, h.run, local)).next).toEqual({ kind: "check", step: 2 })
    check(h, train, 2, false)
    expect((await judgeTrain(train.id, h.run, local)).next).toEqual({
      culprit: 2,
      kind: "land",
      upTo: 1,
    })
    const landed = await landTrain(train.id, h.run, local)
    expect(landed).toMatchObject({
      culprit: 32,
      kind: "landed",
      merged: [{ n: 31 }],
    })
    expect(w.sh(w.origin, "rev-parse", "canary^{tree}")).toBe(train.steps[0]?.tree ?? "")
    expect(h.comments[32]?.at(-1)?.body).toContain("#32 left the train at")
    expect(h.merged[33]).toBeUndefined()
    // The culprit is held at the same head and the PR behind it rides on: no head-of-line blocking.
    expect(lastChecks(h.comments[33] ?? [], OWNER)).toBeNull()
    const again = await buildTrain({ repo: REPO }, h.run, localOf(w, h, { queue: [31, 32, 33] }))
    expect(again.train?.steps.map((s) => s.n)).toEqual([33])
    expect(again.held).toContainEqual({
      n: 32,
      why: expect.stringContaining("its stamp is red at its head"),
    })
  })

  test("a PR that failed local CI at its head holds nobody behind it", async () => {
    const w = world({ 41: { "a.txt": edit("A") }, 42: { "b.txt": edit("B") } })
    const h = hub(w, [41, 42])
    const { held, train } = await buildTrain(
      { repo: REPO },
      h.run,
      localOf(w, h, { queue: [41, 42], red: [41] }),
    )
    expect(train?.steps.map((s) => s.n)).toEqual([42])
    expect(held).toEqual([
      { n: 41, why: `its stamp is red at its head ${w.heads[41]?.slice(0, 7)}` },
    ])
  })

  // the train's own stamp stands in for each PR's own, so a PR rides with none, and land is the gate.
  test("a PR with no stamp at its head rides, and a green train stamp lands it", async () => {
    const w = world({ 81: { "a.txt": edit("A") }, 82: { "b.txt": edit("B") } })
    const h = hub(w, [81, 82])
    const local = localOf(w, h, { queue: [81, 82], unrun: [81] })
    const { held, train } = await buildTrain({ repo: REPO }, h.run, local)
    expect(held).toEqual([])
    expect(train?.steps.map((s) => s.n)).toEqual([81, 82])
    if (!train) throw new Error("no train")
    check(h, train, 2, true)
    const landed = await landTrain(train.id, h.run, local)
    expect(landed).toMatchObject({ kind: "landed", merged: [{ n: 81 }, { n: 82 }] })
  })

  test("a PR whose squash would delete lines a canary merge dropped never rides, and holds nobody behind it (#1052)", async () => {
    const w = world({ 71: { "a.txt": edit("A") }, 72: { "b.txt": edit("B") } })
    const h = hub(w, [71, 72])
    const lost = { 71: [{ commit: "c".repeat(40), line: 4, path: "a.txt" }] }
    const { held, train } = await buildTrain(
      { repo: REPO },
      h.run,
      localOf(w, h, { lost, queue: [71, 72] }),
    )
    expect(train?.steps.map((s) => s.n)).toEqual([72])
    expect(held).toEqual([{ n: 71, why: "not gated: keeps canary" }])
  })

  test("a held PR never rides, and one held after the build stops its land", async () => {
    const w = world({ 61: { "a.txt": edit("A") }, 62: { "b.txt": edit("B") } })
    const h = hub(w, [61, 62])
    const held: Record<number, string> = { 61: "held for Merritt's notes" }
    const local = localOf(w, h, { held, queue: [61, 62] })
    const built = await buildTrain({ repo: REPO }, h.run, local)
    expect(built.train?.steps.map((s) => s.n)).toEqual([62])
    expect(built.held).toEqual([{ n: 61, why: "not gated: held (held for Merritt's notes)" }])
    const train = built.train
    if (!train) throw new Error("no train")
    check(h, train, 1, true)
    held[62] = "held after the build"
    const landed = await landTrain(train.id, h.run, local)
    expect(landed).toMatchObject({ kind: "refused" })
    expect(JSON.stringify(landed)).toContain("#62 held: held after the build")
    expect(h.merged).toEqual({})
  })

  test("land refuses, merging nothing, when canary moved, a head moved, or a PR lacks the step's PASS", async () => {
    const w = world({ 51: { "a.txt": edit("A") }, 52: { "b.txt": edit("B") } })
    const h = hub(w, [51, 52])
    const local = localOf(w, h, { queue: [51, 52] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 2, true)
    h.comments[51] = h.comments[51]?.filter((c) => !trainVerdictOf(c, OWNER)) ?? []
    const missing = await landTrain(train.id, h.run, local)
    expect(missing).toMatchObject({ kind: "refused" })
    expect(JSON.stringify(missing)).toContain("#51 has no green stamp")
    check(h, train, 2, true)
    const head52 = w.heads[52] ?? ""
    w.heads[52] = w.heads[51] ?? ""
    expect(JSON.stringify(await landTrain(train.id, h.run, local))).toContain("#52 moved")
    w.heads[52] = head52
    w.sh(w.work, "commit", "--quiet", "--allow-empty", "--no-verify", "-m", "outside")
    w.sh(w.work, "push", "--quiet", "origin", "HEAD:canary")
    const moved = await landTrain(train.id, h.run, local)
    expect(JSON.stringify(moved)).toContain("not the train's")
    expect(h.merged).toEqual({})
    expect(existsSync(join(local.lockRoot, "merge.lock"))).toBe(false)
  })

  test("a land stops when a predicted tree or canary's tree after a merge is not its step's", async () => {
    const w = world({ 601: { "a.txt": edit("A") }, 602: { "b.txt": edit("B") } })
    const h = hub(w, [601, 602])
    const local = localOf(w, h, { queue: [601, 602] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 2, true)
    const odd: Run = async (args) =>
      args[0] === "merge-tree" ? ok(`${"f".repeat(40)}\n`) : w.git(args)
    const predicted = await landTrain(train.id, h.run, { ...local, git: odd })
    expect(predicted).toMatchObject({ kind: "landed", merged: [] })
    expect(JSON.stringify(predicted)).toContain("would not merge onto canary")
    expect(h.merged).toEqual({})
    const w2 = world({ 611: { "a.txt": edit("A") }, 612: { "b.txt": edit("B") } })
    const h2 = hub(w2, [611, 612])
    const local2 = localOf(w2, h2, { queue: [611, 612] })
    const built = await buildTrain({ repo: REPO }, h2.run, local2)
    if (!built.train) throw new Error("no train")
    check(h2, built.train, 2, true)
    h2.skew.add(611)
    const after = await landTrain(built.train.id, h2.run, local2)
    expect(after).toMatchObject({ kind: "landed", merged: [{ n: 611 }] })
    expect(JSON.stringify(after)).toContain("canary holds tree")
    expect(h2.merged[612]).toBeUndefined()
  })

  test("an error after a merge does not count the next PR as merged when its step changed nothing", async () => {
    const w = world({ 621: { "a.txt": edit("A") }, 622: { "a.txt": edit("A") } })
    const h = hub(w, [621, 622])
    const local = localOf(w, h, { queue: [621, 622] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    expect(train.steps[1]?.tree).toBe(train.steps[0]?.tree)
    check(h, train, 2, true)
    let trees = 0
    const git: Run = async (args) =>
      args[0] === "merge-tree" && ++trees === 2
        ? { code: 128, stderr: "disk full", stdout: "" }
        : w.git(args)
    const landed = await landTrain(train.id, h.run, { ...local, git })
    expect(landed).toMatchObject({ kind: "landed", merged: [{ n: 621 }] })
    expect(h.merged[622]).toBeUndefined()
    expect(h.comments[622]?.at(-1)?.body).toStartWith(`Train ${train.id}: #622 did not merge at`)
  })

  test("a land that stops midway says canary holds an unchecked tree, tells the PRs left, and counts steps by the passed one", async () => {
    const w = world({
      101: { "a.txt": edit("A") },
      102: { "b.txt": edit("B") },
      103: { "c.txt": edit("C") },
    })
    const h = hub(w, [101, 102, 103])
    const local = localOf(w, h, { queue: [101, 102, 103] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 3, true)
    h.refuse.add(102)
    const landed = await landTrain(train.id, h.run, local)
    expect(landed).toMatchObject({ kind: "landed", merged: [{ n: 101 }] })
    if (landed.kind !== "landed") return
    expect(landed.stopped).toContain("#102: gh pr merge exited 1")
    const first = h.comments[101]?.at(-1)?.body ?? ""
    expect(first).toContain("step 1 of 3")
    expect(first).toContain(`The stamp on train ${train.id}, step 3 of 3: green @ `)
    expect(first).toContain("holds a tree no run stamped")
    for (const n of [102, 103]) {
      expect(h.comments[n]?.at(-1)?.body).toStartWith(`Train ${train.id}: #${n} did not merge at`)
    }
  })

  test("a git error after a squash has merged stops the land with every note, and the train still ends", async () => {
    const w = world({ 201: { "a.txt": edit("A") }, 202: { "b.txt": edit("B") } })
    const h = hub(w, [201, 202])
    const local = localOf(w, h, { queue: [201, 202] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 2, true)
    const git: Run = async (args) =>
      args[0] === "fetch" && args.length === 4
        ? { code: 128, stderr: "network down", stdout: "" }
        : w.git(args)
    const landed = await landTrain(train.id, h.run, { ...local, git })
    expect(landed).toMatchObject({ kind: "landed", merged: [{ n: 201 }] })
    expect(JSON.stringify(landed)).toContain("network down")
    expect(h.comments[201]?.at(-1)?.body).toContain("holds a tree no run stamped")
    expect(h.comments[202]?.at(-1)?.body).toStartWith(`Train ${train.id}: #202 did not merge at`)
    expect(existsSync(join(local.lockRoot, "trains", "done", `${train.id}.json`))).toBe(true)
  })

  test("a git error before anything merged keeps the train, so land can run again on its PASS", async () => {
    const w = world({ 211: { "a.txt": edit("A") } })
    const h = hub(w, [211])
    const local = localOf(w, h, { queue: [211] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 1, true)
    const git: Run = async (args) =>
      args[0] === "merge-tree" ? { code: 128, stderr: "disk full", stdout: "" } : w.git(args)
    await expect(landTrain(train.id, h.run, { ...local, git })).rejects.toThrow("disk full")
    expect(h.merged).toEqual({})
    expect(existsSync(join(local.lockRoot, "trains", `${train.id}.json`))).toBe(true)
    expect(await landTrain(train.id, h.run, local)).toMatchObject({ merged: [{ n: 211 }] })
  })

  test("a culprit is told it left even when the land is refused, once, and waits at its head", async () => {
    const w = world({
      301: { "a.txt": edit("A") },
      302: { "b.txt": edit("B") },
      303: { "c.txt": edit("C") },
    })
    const h = hub(w, [301, 302, 303])
    const local = localOf(w, h, { queue: [301, 302, 303] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 3, false)
    check(h, train, 1, true)
    check(h, train, 2, false)
    w.sh(w.work, "commit", "--quiet", "--allow-empty", "--no-verify", "-m", "outside")
    w.sh(w.work, "push", "--quiet", "origin", "HEAD:canary")
    expect(await landTrain(train.id, h.run, local)).toMatchObject({ kind: "refused" })
    expect(await landTrain(train.id, h.run, local)).toMatchObject({ kind: "refused" })
    const left = h.comments[302]?.filter((c) => c.body.includes("left the train at"))
    expect(left).toHaveLength(1)
    await endTrain(train.id, local)
    const again = await buildTrain({ repo: REPO }, h.run, localOf(w, h, { queue: [301, 302, 303] }))
    expect(again.train?.steps.map((s) => s.n)).toEqual([301, 303])
    expect(again.held.map((x) => x.n)).toContain(302)
  })

  test("a merge GitHub made before reading its state failed is counted, and the land stops there", async () => {
    const w = world({ 401: { "a.txt": edit("A") }, 402: { "b.txt": edit("B") } })
    const h = hub(w, [401, 402])
    const local = localOf(w, h, { queue: [401, 402] })
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 2, true)
    h.blind.add(401)
    const landed = await landTrain(train.id, h.run, local)
    expect(landed).toMatchObject({ kind: "landed", merged: [{ n: 401 }] })
    expect(JSON.stringify(landed)).toContain("HTTP 502")
    expect(h.merged[402]).toBeUndefined()
    expect(h.comments[401]?.at(-1)?.body).toContain("holds a tree no run stamped")
  })

  test("a note that cannot be posted stops the land with that error and keeps the train", async () => {
    const w = world({ 411: { "a.txt": edit("A") } })
    const h = hub(w, [411])
    const local = localOf(w, h)
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 1, true)
    h.mute.add(411)
    await expect(landTrain(train.id, h.run, local)).rejects.toThrow("HTTP 403")
    expect(existsSync(join(local.lockRoot, "trains", `${train.id}.json`))).toBe(true)
    expect(existsSync(join(local.lockRoot, "merge.lock"))).toBe(false)
  })

  test("a PR that still conflicts at the same head is told once, not on every train", async () => {
    const w = world({ 111: { "a.txt": edit("A from 111") }, 112: { "a.txt": edit("A from 112") } })
    const h = hub(w, [111, 112])
    const first = await buildTrain({ repo: REPO }, h.run, localOf(w, h, { queue: [111, 112] }))
    const second = await buildTrain({ repo: REPO }, h.run, localOf(w, h, { queue: [111, 112] }))
    expect(first.train?.dropped.map((d) => d.n)).toEqual([112])
    expect(second.train?.dropped.map((d) => d.n)).toEqual([112])
    expect(h.comments[112]?.filter((c) => c.body.includes("left out at"))).toHaveLength(1)
  })

  test("a train whose branch cannot be deleted is not filed as ended, and land says so", async () => {
    const w = world({ 121: { "a.txt": edit("A") } })
    const h = hub(w, [121])
    const local = localOf(w, h)
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 1, true)
    const git: Run = async (args) =>
      args.includes("--delete") ? { code: 1, stderr: "unable to access", stdout: "" } : w.git(args)
    const landed = await landTrain(train.id, h.run, { ...local, git })
    expect(landed).toMatchObject({ kind: "landed", merged: [{ n: 121 }] })
    expect(JSON.stringify(landed)).toContain("notEnded")
    expect(existsSync(join(local.lockRoot, "trains", `${train.id}.json`))).toBe(true)
  })

  test("a train whose branch is already gone still ends", async () => {
    const w = world({ 122: { "a.txt": edit("A") } })
    const h = hub(w, [122])
    const local = localOf(w, h)
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    w.sh(w.origin, "update-ref", "-d", `refs/heads/${train.branch}`)
    check(h, train, 1, true)
    const landed = await landTrain(train.id, h.run, local)
    expect(landed).toMatchObject({ kind: "landed", merged: [{ n: 122 }] })
    expect(JSON.stringify(landed)).not.toContain("notEnded")
    expect(existsSync(join(local.lockRoot, "trains", "done", `${train.id}.json`))).toBe(true)
  })

  test("a second train is refused while one is still running", async () => {
    const w = world({ 91: { "a.txt": edit("A") } })
    const h = hub(w, [91])
    const local = localOf(w, h)
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    await expect(buildTrain({ repo: REPO }, h.run, local)).rejects.toThrow(
      `train ${train?.id} is still running`,
    )
  })

  test("a lock another merge holds refuses the land", async () => {
    const w = world({ 61: { "a.txt": edit("A") } })
    const h = hub(w, [61])
    const local = localOf(w, h)
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    check(h, train, 1, true)
    mkdirSync(join(local.lockRoot, "merge.lock"))
    writeFileSync(join(local.lockRoot, "merge.lock", "pr"), "248\n")
    expect(await landTrain(train.id, h.run, local)).toEqual({ holder: "248", kind: "locked" })
    expect(h.merged).toEqual({})
  })

  test("a green draft rides the train and is marked ready just before its squash; a draft missing a gate stays a draft (#1172)", async () => {
    const w = world({
      91: { "a.txt": edit("A") },
      92: { "b.txt": edit("B") },
      93: { "c.txt": edit("C") },
    })
    const h = hub(w, [91, 92, 93], [92, 93])
    const local = localOf(w, h, { drafts: [92, 93], queue: [91, 92, 93], red: [93] })
    const dry = await buildTrain({ dryRun: true, repo: REPO }, h.run, local)
    expect(dry.train?.steps.map((s) => s.n)).toEqual([91, 92])
    expect(dry.held).toEqual([
      { n: 93, why: `its stamp is red at its head ${w.heads[93]?.slice(0, 7)}` },
    ])
    const { train } = await buildTrain({ repo: REPO }, h.run, local)
    if (!train) throw new Error("no train")
    expect(h.calls.filter((args) => args[1] === "ready")).toEqual([])
    check(h, train, 2, true)
    const landed = await landTrain(train.id, h.run, local)
    expect(landed).toMatchObject({ kind: "landed" })
    if (landed.kind !== "landed") return
    expect(landed.merged.map((m) => m.n)).toEqual([91, 92])
    const order = h.calls.map((args) => args.slice(0, 3).join(" "))
    expect(h.calls.filter((args) => args[1] === "ready")).toEqual([
      ["pr", "ready", "92", "-R", REPO],
    ])
    expect(order.indexOf("pr ready 92")).toBeLessThan(order.indexOf("pr merge 92"))
    expect(order.indexOf("pr ready 92")).toBeGreaterThan(order.indexOf("pr merge 91"))
  })

  test("--dry-run builds the steps and pushes, keeps and tells nothing", async () => {
    const w = world({
      71: { "a.txt": edit("A") },
      72: { "a.txt": edit("A from 72") },
    })
    const h = hub(w, [71, 72])
    const local = localOf(w, h, { queue: [71, 72] })
    const { train } = await buildTrain({ dryRun: true, repo: REPO }, h.run, local)
    expect(train?.steps.map((s) => s.n)).toEqual([71])
    expect(train?.dropped.map((d) => d.n)).toEqual([72])
    expect(w.sh(w.origin, "branch", "--list", "train/*")).toBe("")
    expect(existsSync(join(local.lockRoot, "trains"))).toBe(false)
    expect(h.calls.filter((args) => args[1] === "comment")).toEqual([])
  })

  test("forecast predicts each queued PR's conflicts with canary and the PRs ahead, gated or not and drafts included, and writes nothing", async () => {
    const w = world({
      81: { "AGENTS.md": "ours\n" },
      82: { "b.txt": edit("B") },
      83: { "AGENTS.md": "theirs\n" },
    })
    const h = hub(w, [81, 82, 83], [83])
    const result = await forecast(
      { repo: REPO },
      h.run,
      localOf(w, h, { queue: [81, 82, 83], red: [81] }),
    )
    expect(result.order).toEqual([81, 82, 83])
    expect(result.conflicts).toMatchObject([{ files: ["AGENTS.md"], n: 83, with: "#81" }])
    expect(h.calls.filter((args) => args[1] === "comment")).toEqual([])
  })

  test("outside a scratch lock folder and a git stub, it refuses to run", async () => {
    const w = world({})
    const h = hub(w, [])
    await expect(buildTrain({ repo: REPO }, h.run, {})).rejects.toThrow("needs a git stub")
  })

  // ci:go runs pr:train's forecast for real, so its own script counts as a real run
  test("a run is real from pr:train's script and from ci:go's, and from nowhere else", () => {
    const dir = join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "..",
      "..",
      "packages",
      "scripts",
      "src",
      "pr-merge",
    )
    expect(resolve({}, join(dir, "train-cli.ts")).cli).toBe(true)
    expect(resolve({}, join(dir, "go-cli.ts")).cli).toBe(true)
    expect(() => resolve({}, join(dir, "cli.ts"))).toThrow("pr:train under test")
    expect(() => resolve({})).toThrow("pr:train under test")
  })
})

test("next answers none, exit 0, while no train runs, so the ops job builds on that answer", () => {
  const lock = mkdtempSync(join(scratch, "cli-"))
  const cli = join(import.meta.dir, "../../../../../packages/scripts/src/pr-merge/train-cli.ts")
  const proc = Bun.spawnSync(["bun", cli, "next", "--json"], {
    env: { ...process.env, PLAYGROUND_MERGE_LOCK_DIR: lock },
  })
  expect(proc.exitCode).toBe(0)
  expect(JSON.parse(proc.stdout.toString())).toEqual({ next: { kind: "none" } })
})

describe("nextStep", () => {
  const results = (entries: [number, boolean][]) => new Map(entries)
  test("checks the whole train first and lands it when green", () => {
    expect(nextStep(5, results([]))).toEqual({ kind: "check", step: 5 })
    expect(nextStep(5, results([[5, true]]))).toEqual({ kind: "land", upTo: 5 })
    expect(nextStep(0, results([]))).toEqual({ kind: "empty" })
  })
  test("halves between the longest green prefix and the shortest red one", () => {
    expect(nextStep(8, results([[8, false]]))).toEqual({ kind: "check", step: 4 })
    expect(
      nextStep(
        8,
        results([
          [8, false],
          [4, true],
        ]),
      ),
    ).toEqual({ kind: "check", step: 6 })
    expect(
      nextStep(
        8,
        results([
          [8, false],
          [4, true],
          [6, false],
        ]),
      ),
    ).toEqual({ kind: "check", step: 5 })
    expect(
      nextStep(
        8,
        results([
          [8, false],
          [4, true],
          [6, false],
          [5, true],
        ]),
      ),
    ).toEqual({ culprit: 6, kind: "land", upTo: 5 })
  })
  test("a train of one that fails names it and lands nothing", () => {
    expect(nextStep(1, results([[1, false]]))).toEqual({ culprit: 1, kind: "land", upTo: 0 })
  })
})

describe("trainOrder", () => {
  const candidate = (
    n: number,
    comments: Comment[] = [],
    head = `${n}`.padEnd(40, "a"),
  ): Candidate => ({
    facts: {
      aheadBy: 0,
      author: OWNER,
      base: "canary",
      canary: "",
      checks: [],
      comments,
      draft: false,
      files: [],
      head,
      held: null,
      lost: [],
      mergeTree: null,
      n,
      owner: OWNER,
      stamp: { passed: [], reach: [head], stamps: [], why: "" },
      state: "OPEN",
    },
    n,
  })
  const B = "b".repeat(40)
  const drive = { "agent-drive": { source: "agent", status: "pass" as const } }

  test("keeps the queue's order, then PRs it does not list by number", () => {
    const { order } = trainOrder([candidate(9), candidate(3), candidate(5), candidate(7)], [5, 3])
    expect(order.map((c) => c.n)).toEqual([5, 3, 7, 9])
  })

  test("a PR stamped red at an earlier head rejoins at the back; one red at its head is held; a later green restores it", () => {
    const redBefore = candidate(1, [stamped(B, "red")])
    const redHere = candidate(2, [stamped("2".padEnd(40, "a"), "red")])
    const { held, order } = trainOrder([redBefore, redHere, candidate(3)], [1, 2, 3])
    expect(order.map((c) => c.n)).toEqual([3, 1])
    expect(held).toEqual([{ n: 2, why: "its stamp is red at its head 2aaaaaa" }])
    const greenSince = candidate(1, [stamped(B, "red"), stamped("c".repeat(40), "green")])
    expect(trainOrder([greenSince, candidate(3)], [1, 3]).order.map((c) => c.n)).toEqual([1, 3])
  })

  test("a re-run green at the same head clears a red, and a wait clears nothing", () => {
    const rerun = candidate(1, [stamped(B, "red"), stamped(B, "red"), stamped(B, "green")])
    expect(trainOrder([rerun, candidate(2)], [1, 2]).order.map((c) => c.n)).toEqual([1, 2])
    expect(lastChecks([stamped(B, "wait")], OWNER)).toBeNull()
    const waited = candidate(1, [stamped(B, "red"), stamped(B, "wait")])
    expect(trainOrder([waited, candidate(2)], [1, 2]).order.map((c) => c.n)).toEqual([2, 1])
  })

  test("a train's green after a left-the-train note at an earlier head restores the PR's place", () => {
    const back = candidate(1, [
      said("Train 20261007T170000Z: #1 left the train at bbbbbbb: Checks failed once it joined."),
    ])
    expect(trainOrder([back, candidate(2)], [1, 2]).order.map((c) => c.n)).toEqual([2, 1])
    const train = { train: { source: "local", status: "pass" as const } }
    const restored = candidate(1, [...back.facts.comments, stamped("c".repeat(40), "green", train)])
    expect(trainOrder([restored, candidate(2)], [1, 2]).order.map((c) => c.n)).toEqual([1, 2])
  })

  test("a green stamp at the sha a PR left the train at does not clear the note", () => {
    const left = candidate(1, [
      said("Train 20261007T170000Z: #1 left the train at bbbbbbb: Checks failed once it joined."),
      stamped(B, "green"),
    ])
    expect(trainOrder([left, candidate(2)], [1, 2]).order.map((c) => c.n)).toEqual([2, 1])
  })

  test("only the owner's stamps count", () => {
    const theirs = said(stampText({ checks: {}, commit: B, status: "red" }), "x")
    expect(lastChecks([theirs], OWNER)).toBeNull()
  })

  test("a tester's green clears a red tester at its sha, but never a red from Checks there", () => {
    const tester = [stamped(B, "red", drive), stamped(B, "green", drive)]
    expect(lastChecks(tester, OWNER)).toEqual({ at: "bbbbbbb", pass: true })
    const checks = [stamped(B, "red"), stamped(B, "green", drive)]
    expect(lastChecks(checks, OWNER)).toEqual({ at: "bbbbbbb", pass: false })
  })
})
