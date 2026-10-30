import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import type { LockStore } from "../../../../../packages/redis/src/index"
import { heldPath } from "../../../../../packages/scripts/src/pr-merge/held"
import {
  gateOptions,
  isServerError,
  lockRootOf,
  queuePath,
  realLockRoot,
  prMerge,
  takeLock,
  type Run,
  type RunResult,
} from "../../../../../packages/scripts/src/pr-merge/merge"
import { stampText, type StampKeys } from "../../../../../packages/scripts/src/pr-merge/stamp"
import "./scratch-config"
import { storeWith } from "../../../../scripts/hooks/render-set"
import { suiteChecks } from "./suite"

const HEAD = "69a6a4c5e6caf46c4abda6a89de4ce6f3b309e88"
const OLD = "5740ceaa347f9c0f4e5a2f109f433e7838468b1f"
const CANARY = "6f3db1ea4cb7ea4072e0d5454da0026c89635cab"
const TREE = "1bd05088cad7c561f74d8912abe76184760003d9"

const scratch = mkdtempSync(join(tmpdir(), "pr-merge-lock-"))
// The suite's own lock folder: no test may take the factory's real lock.
process.env.PLAYGROUND_MERGE_LOCK_DIR = join(scratch, "default")
// The suite's own held list, missing unless a test writes it: no test reads the factory's real one.
const HELD = join(scratch, "held-prs.json")
process.env.PLAYGROUND_HELD_PRS = HELD
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// The tree git merges a clean canary merge's two parents to, which is that merge's own tree.
const MERGED_TREE = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
// git merge-tree --write-tree --name-only's answer for a head that conflicts with canary, as git 2.56 prints it: the tree line is still there, then each conflicted file, then its messages, and it exits 1.
const CONFLICTED: RunResult = {
  code: 1,
  stderr: "",
  stdout: [
    "cb1b7be5c6c3fdf505305b5b2611c9e30cada77f",
    "AGENTS.md",
    "web/next/x.ts",
    "",
    "Auto-merging AGENTS.md",
    "CONFLICT (content): Merge conflict in AGENTS.md",
    "",
  ].join("\n"),
}
// git in a scratch world: canary is CANARY, the head merges into it as TREE (null: a conflict), and the lock lives in a fresh folder. parents: each commit's parents on the walk back from the head; clean: the merges among them that git re-runs to their own tree.
const local = ({
  answer,
  canary = CANARY,
  clean = [] as string[],
  parents = { [HEAD]: ["p0"] } as Record<string, string[]>,
  tree = TREE as string | null,
}: {
  answer?: RunResult
  canary?: string
  clean?: string[]
  parents?: Record<string, string[]>
  tree?: string | null
} = {}) => {
  const lockRoot = mkdtempSync(join(scratch, "lock-"))
  const git: Run = async (args) => {
    if (args[0] === "fetch") return ok("")
    if (args[0] === "merge-base") return ok(`${canary}\n`)
    if (args[0] === "rev-list" && args.includes("--parents")) {
      const sha = args.at(-1) ?? ""
      return ok(`${[sha, ...(parents[sha] ?? [])].join(" ")}\n`)
    }
    if (args[0] === "rev-list") return ok("")
    if (args[0] === "rev-parse" && args.length === 4) {
      const sha = (args[1] ?? "").replace("^1", "")
      return ok(`p1\np2\n${clean.includes(sha) ? MERGED_TREE : "b".repeat(40)}\n`)
    }
    if (args[0] === "rev-parse") return ok(`${canary}\n`)
    if (args[0] === "merge-tree" && args.includes("origin/canary")) {
      return answer ?? (tree ? ok(`${tree}\n`) : CONFLICTED)
    }
    if (args[0] === "merge-tree") return ok(`${MERGED_TREE}\n`)
    return { code: 1, stderr: `unexpected git ${args.join(" ")}`, stdout: "" }
  }
  return { git, lockRoot }
}
// The factory's own repository, factory.repo in scratch-config's store, so its heads need GitGuardian's check.
const REPO = "acme/factory"

const ok = (stdout: string): RunResult => ({ code: 0, stderr: "", stdout })

const comment = (body: string, at: string, author = "acme") =>
  JSON.stringify({ author, body, createdAt: at })

// The owner's stamp at sha, as a comment the stub lists.
const stamped = (sha: string, at: string, patch: Partial<StampKeys> = {}, author = "acme") =>
  comment(
    stampText({
      checks: suiteChecks(),
      commit: sha,
      status: "green",
      ...patch,
    }),
    at,
    author,
  )

const REVIEWED = comment(
  "## ReviewBot · round 1: 5/5 at 69a6a4c · 0 blocking",
  "2026-10-06T19:00:00Z",
)
const PASSING = [REVIEWED, stamped(HEAD, "2026-10-06T19:02:00Z")].join("\n")

const GUARDIAN = { name: "GitGuardian Security Checks" }
const GUARDIAN_PASSED = { ...GUARDIAN, conclusion: "SUCCESS", status: "COMPLETED" }
const GUARDIAN_RUNNING = { ...GUARDIAN, conclusion: "", status: "IN_PROGRESS" }

// A stubbed gh: each call's arguments are recorded, and the merge's answers come from `merges` in order; onCanary lists the comments on canary's tip, where canary's own run stamps it.
function stub({
  aheadBy = "0",
  author = "acme",
  body = "Closes #112",
  checks = [GUARDIAN_PASSED] as object[],
  draft = false,
  ready = ok(""),
  comments = PASSING,
  files = ["AGENTS.md", "packages/scripts/src/pr-merge/cli.ts"],
  merges = [ok("")],
  onCanary = "",
  stateAfter = ["MERGED"],
}: {
  aheadBy?: string
  author?: string
  body?: string
  checks?: object[]
  comments?: string
  draft?: boolean
  ready?: RunResult
  files?: string[]
  merges?: RunResult[]
  onCanary?: string
  stateAfter?: string[]
} = {}) {
  const calls: string[][] = []
  let merge = 0
  let view = 0
  const run: Run = async (args) => {
    calls.push(args)
    const joined = args.join(" ")
    if (joined.startsWith("pr view") && joined.includes("baseRefName")) {
      return ok(
        JSON.stringify({
          author: { login: author },
          baseRefName: "canary",
          headRefOid: HEAD,
          isDraft: draft,
          state: "OPEN",
          statusCheckRollup: checks,
        }),
      )
    }
    if (joined.includes("/files")) return ok(files.map((file) => `${file}\n`).join(""))
    if (joined.includes(`/commits/${CANARY}/comments`)) return ok(onCanary)
    if (joined.includes("/comments")) return ok(comments)
    if (joined.includes("/compare/") && joined.includes("...canary")) return ok(aheadBy)
    if (joined.startsWith("pr comment")) return ok("")
    if (joined.startsWith("pr ready")) return ready
    if (joined.startsWith("pr view") && joined.includes("--json body")) return ok(body)
    if (joined.startsWith("pr merge")) return merges[merge++] ?? ok("")
    if (joined.startsWith("pr view") && joined.includes("mergeCommit")) {
      const state = stateAfter[Math.min(view++, stateAfter.length - 1)] ?? "OPEN"
      return ok(
        JSON.stringify({ mergeCommit: state === "MERGED" ? { oid: "abc1234def" } : null, state }),
      )
    }
    return { code: 1, stderr: `unexpected gh ${joined}`, stdout: "" }
  }
  return { calls, run }
}

const merges = (calls: string[][]) =>
  calls.filter((args) => args[0] === "pr" && args[1] === "merge")

const readies = (calls: string[][]) =>
  calls.filter((args) => args[0] === "pr" && args[1] === "ready")

describe("prMerge", () => {
  test("merges a PR that passed every gate, at exactly its head, and returns the merge SHA", async () => {
    const { calls, run } = stub()
    const outcome = await prMerge(112, { repo: REPO }, run, local())
    expect(outcome).toMatchObject({ kind: "merged", sha: "abc1234def" })
    expect(merges(calls)).toEqual([
      [
        "pr",
        "merge",
        "112",
        "-R",
        REPO,
        "--squash",
        "--body",
        "Closes #112",
        "--match-head-commit",
        HEAD,
      ],
    ])
    expect(calls.find((args) => args.join(" ").includes("/compare/"))?.[1]).toBe(
      `repos/${REPO}/compare/${HEAD}...canary`,
    )
  })

  // GitHub's squash took the PR's commits' Co-authored-by trailers into canary, which AGENTS.md's Commits rule keeps out.
  test("squashes with the PR body less every Co-authored-by line, in any case", async () => {
    const body = [
      "Outcome: a change.",
      "",
      "The hook refuses a Co-authored-by trailer.",
      "Co-authored-by: A <a@b.c>",
      "Co-Authored-By: Claude <noreply@example.com>",
      "co-authored-by: C <c@d.e>",
      "",
      "Closes #112",
    ].join("\n")
    const { calls, run } = stub({ body })
    expect(await prMerge(112, { repo: REPO }, run, local())).toMatchObject({ kind: "merged" })
    const squash = merges(calls)[0] ?? []
    expect(squash.slice(-4)).toEqual([
      "--body",
      "Outcome: a change.\n\nThe hook refuses a Co-authored-by trailer.\n\nCloses #112",
      "--match-head-commit",
      HEAD,
    ])
  })

  test("refuses a PR by an outside author, and merges it only when --outside-author names that author", async () => {
    const refused = stub({ author: "teammate-acme" })
    const outcome = await prMerge(165, { repo: REPO }, refused.run, local())
    expect(outcome.kind).toBe("refused")
    expect(outcome.gates.find((gate) => gate.name === "author")?.ok).toBe(false)
    expect(merges(refused.calls)).toEqual([])
    const named = stub({ author: "teammate-acme" })
    const options = { outsideAuthor: "teammate-acme", repo: REPO }
    expect(await prMerge(165, options, named.run, local())).toMatchObject({ kind: "merged" })
    const note = named.calls.find((args) => args[0] === "pr" && args[1] === "comment")
    expect(note?.at(-1)).toContain("author: by teammate-acme, named by --outside-author")
  })

  // the merged PR's worker, reviewer and tester end right after the merge, and a refusal ends nobody.
  test("ends the merged PR's sessions by its URL, after the merge comment; a refusal ends none", async () => {
    const ended: string[] = []
    const end = async (url: string, sha: string) => void ended.push(`${url} ${sha}`)
    const merged = stub()
    expect(
      await prMerge(112, { repo: REPO }, merged.run, { ...local(), ended: end }),
    ).toMatchObject({
      kind: "merged",
    })
    expect(ended).toEqual([`https://github.com/${REPO}/pull/112 abc1234def`])
    const refused = stub({ aheadBy: "1" })
    const refusal = await prMerge(112, { repo: REPO }, refused.run, {
      ...local({ tree: null }),
      ended: end,
    })
    expect(refusal.kind).toBe("refused")
    expect(refusal.gates.find((gate) => gate.name === "up to date")?.ok).toBe(false)
    expect(ended).toHaveLength(1)
    const failing = stub()
    const outcome = await prMerge(112, { repo: REPO }, failing.run, {
      ...local(),
      ended: async () => {
        throw new Error("herdr is down")
      },
    })
    expect(outcome).toMatchObject({ kind: "merged" })
  })

  test("a compare answer that is not a count refuses, never reading as up to date", async () => {
    for (const aheadBy of ["", "null", " "]) {
      const { calls, run } = stub({ aheadBy })
      const outcome = await prMerge(112, { repo: REPO }, run, local())
      expect(outcome.kind).toBe("refused")
      expect(outcome.gates.find((gate) => gate.name === "up to date")?.ok).toBe(false)
      expect(merges(calls)).toEqual([])
    }
  })

  test("refuses a PR the held list names, saying why, and never calls gh pr merge", async () => {
    writeFileSync(HELD, JSON.stringify({ held: { [`${REPO}#112`]: "held for Merritt's notes" } }))
    try {
      const { calls, run } = stub()
      const outcome = await prMerge(112, { repo: REPO }, run, local())
      expect(outcome.kind).toBe("refused")
      expect(outcome.gates.find((gate) => gate.name === "held")).toMatchObject({
        detail: "held for Merritt's notes",
        ok: false,
      })
      expect(merges(calls)).toEqual([])
    } finally {
      rmSync(HELD, { force: true })
    }
  })

  test("refuses, and never calls gh pr merge, when canary is ahead and the head conflicts with it", async () => {
    const { calls, run } = stub({ aheadBy: "1" })
    const outcome = await prMerge(112, { repo: REPO }, run, local({ tree: null }))
    expect(outcome.kind).toBe("refused")
    expect(outcome.gates.find((gate) => gate.name === "up to date")?.ok).toBe(false)
    expect(merges(calls)).toEqual([])
  })

  test("a head behind canary that merges clean merges on its own stamp, with no new run", async () => {
    const { calls, run } = stub({ aheadBy: "3" })
    expect(await prMerge(112, { repo: REPO }, run, local())).toMatchObject({ kind: "merged" })
    expect(merges(calls)).toHaveLength(1)
  })

  test("refuses a stamp from anyone but the repo's owner", async () => {
    const comments = [REVIEWED, stamped(HEAD, "2026-10-06T19:02:00Z", {}, "mallory")].join("\n")
    const { calls, run } = stub({ comments })
    const outcome = await prMerge(112, { repo: REPO }, run, local())
    expect(outcome.kind).toBe("refused")
    expect(outcome.gates.filter((gate) => !gate.ok).map((gate) => gate.name)).toEqual([
      "stamp",
      "suite",
    ])
    expect(merges(calls)).toEqual([])
  })

  test("--explain judges every gate and merges nothing", async () => {
    const { calls, run } = stub()
    const outcome = await prMerge(112, { explain: true, repo: REPO }, run, local())
    expect(outcome.kind).toBe("explained")
    expect(outcome.gates.every((gate) => gate.ok)).toBe(true)
    expect(merges(calls)).toEqual([])
  })

  test("a clean merge of canary carries the stamp and the review from the commit under it", async () => {
    const comments = [
      comment("## ReviewBot · round 1: 5/5 at 5740cea · 0 blocking", "2026-10-06T18:00:00Z"),
      stamped(OLD, "2026-10-06T18:02:00Z"),
    ].join("\n")
    const { calls, run } = stub({ comments })
    const world = local({ clean: [HEAD], parents: { [HEAD]: [OLD, CANARY], [OLD]: ["p0"] } })
    const outcome = await prMerge(112, { repo: REPO }, run, world)
    expect(outcome).toMatchObject({ kind: "merged" })
    expect(outcome.gates.find((gate) => gate.name === "review")?.detail).toContain(
      "carried from 5740cea",
    )
    expect(merges(calls)).toHaveLength(1)
  })

  test("a canary merge that is not clean waits for the reviewer's look, and its green stamp merges", async () => {
    const before = [
      comment("## ReviewBot · round 1: 5/5 at 5740cea · 0 blocking", "2026-10-06T18:00:00Z"),
      stamped(OLD, "2026-10-06T18:02:00Z"),
    ]
    const world = () => local({ parents: { [HEAD]: [OLD, CANARY], [OLD]: ["p0"] } })
    const unlooked = stub({ comments: before.join("\n") })
    const refused = await prMerge(112, { repo: REPO }, unlooked.run, world())
    expect(refused.kind).toBe("refused")
    expect(refused.gates.find((gate) => gate.name === "stamp")?.detail).toContain(
      "69a6a4c has no stamp and is no clean canary merge",
    )
    const look = {
      checks: { "agent-review": { source: "agent", status: "pass" as const } },
    }
    const waits = stub({
      comments: [
        ...before,
        stamped(HEAD, "2026-10-06T19:00:00Z", { ...look, status: "wait" }),
      ].join("\n"),
    })
    expect((await prMerge(112, { repo: REPO }, waits.run, world())).kind).toBe("refused")
    const looked = stub({
      comments: [...before, stamped(HEAD, "2026-10-06T19:00:00Z", look)].join("\n"),
    })
    expect(await prMerge(112, { repo: REPO }, looked.run, world())).toMatchObject({
      kind: "merged",
    })
  })

  test("a dashboard PR needs a green stamp that passed verify, and GitHub's suite beside it", async () => {
    const files = ["api/hono/src/routers/dashboard.ts"]
    const plain = stub({ files })
    const refused = await prMerge(112, { repo: REPO }, plain.run, local())
    expect(refused.gates.filter((gate) => !gate.ok).map((gate) => gate.name)).toEqual(["stamp"])
    const verify = { verify: { source: "local", status: "pass" as const } }
    const checksOnly = stub({
      comments: [REVIEWED, stamped(HEAD, "2026-10-06T19:02:00Z", { checks: verify })].join("\n"),
      files,
    })
    const alone = await prMerge(112, { repo: REPO }, checksOnly.run, local())
    expect(alone.gates.filter((gate) => !gate.ok).map((gate) => gate.name)).toEqual(["suite"])
    const verified = stub({
      comments: [
        REVIEWED,
        stamped(HEAD, "2026-10-06T19:01:00Z", { checks: suiteChecks("1823") }),
        stamped(HEAD, "2026-10-06T19:02:00Z", { checks: verify }),
      ].join("\n"),
      files,
    })
    expect(await prMerge(112, { repo: REPO }, verified.run, local())).toMatchObject({
      kind: "merged",
    })
  })

  test("a red stamp on canary's tip stops every merge but the fix, a head holding the tip that ran the suite", async () => {
    const onCanary = stamped(CANARY, "2026-10-06T19:05:00Z", { status: "red" })
    const { calls, run } = stub({ aheadBy: "3", onCanary })
    const outcome = await prMerge(112, { repo: REPO }, run, local())
    expect(outcome.kind).toBe("refused")
    expect(outcome.gates.filter((gate) => !gate.ok).map((gate) => gate.name)).toEqual(["canary"])
    expect(merges(calls)).toEqual([])
    const fix = stub({ onCanary })
    expect(await prMerge(112, { repo: REPO }, fix.run, local())).toMatchObject({ kind: "merged" })
  })

  test("a GitHub 5xx is tried once more at the same head", async () => {
    const bad: RunResult = {
      code: 1,
      stderr: "non-200 OK status code: 502 Bad Gateway",
      stdout: "",
    }
    const { calls, run } = stub({ merges: [bad, ok("")], stateAfter: ["OPEN", "MERGED"] })
    const outcome = await prMerge(112, { repo: REPO }, run, local())
    expect(outcome).toMatchObject({ kind: "merged", sha: "abc1234def" })
    expect(merges(calls)).toHaveLength(2)
    expect(merges(calls).every((args) => args.includes(HEAD))).toBe(true)
    expect(merges(calls)[1]).toEqual(merges(calls)[0])
  })

  test("a 5xx after which the PR reads merged is a merge, with no second try", async () => {
    const bad: RunResult = { code: 1, stderr: "HTTP 502", stdout: "" }
    const { calls, run } = stub({ merges: [bad], stateAfter: ["MERGED"] })
    expect(await prMerge(112, { repo: REPO }, run, local())).toMatchObject({ kind: "merged" })
    expect(merges(calls)).toHaveLength(1)
  })

  test("a second 5xx, or any other failure, stops with gh's reason", async () => {
    const bad: RunResult = { code: 1, stderr: "502 Bad Gateway", stdout: "" }
    const twice = stub({ merges: [bad, bad], stateAfter: ["OPEN"] })
    expect(await prMerge(112, { repo: REPO }, twice.run, local())).toMatchObject({ kind: "failed" })
    expect(merges(twice.calls)).toHaveLength(2)
    const moved: RunResult = { code: 1, stderr: "Head branch was modified", stdout: "" }
    const once = stub({ merges: [moved], stateAfter: ["OPEN"] })
    const outcome = await prMerge(112, { repo: REPO }, once.run, local())
    expect(outcome).toMatchObject({ kind: "failed" })
    expect(outcome.kind === "failed" && outcome.reason).toContain("Head branch was modified")
    expect(merges(once.calls)).toHaveLength(1)
  })
})

// merge-on-ready skips drafts, so a green draft sat for 30 minutes while another PR merged ahead of it and made it conflict.
describe("a green draft", () => {
  test("pr:merge marks the owner's draft ready when every other gate passes, then merges it", async () => {
    const { calls, run } = stub({ draft: true })
    const outcome = await prMerge(112, { repo: REPO }, run, local())
    expect(outcome).toMatchObject({ kind: "merged", sha: "abc1234def" })
    expect(readies(calls)).toEqual([["pr", "ready", "112", "-R", REPO]])
    const order = calls.map((args) => `${args[0]} ${args[1]}`)
    expect(order.indexOf("pr ready")).toBeLessThan(order.indexOf("pr merge"))
    const note = calls.find((args) => args[0] === "pr" && args[1] === "comment")?.at(-1) ?? ""
    expect(note).toContain("ready: a draft whose every other gate passes; marked ready")
  })

  test("a draft missing any other gate stays a draft and is refused", async () => {
    const comments = [
      comment("## ReviewBot · round 1: 5/5 at 69a6a4c · 0 blocking", "2026-10-06T19:00:00Z"),
    ].join("\n")
    for (const missing of [stub({ comments, draft: true }), stub({ aheadBy: "", draft: true })]) {
      const outcome = await prMerge(112, { repo: REPO }, missing.run, local())
      expect(outcome.kind).toBe("refused")
      expect(outcome.gates.find((gate) => gate.name === "ready")?.ok).toBe(false)
      expect(readies(missing.calls)).toEqual([])
      expect(merges(missing.calls)).toEqual([])
    }
  })

  test("an outside author's draft is never marked ready, even with --outside-author", async () => {
    const { calls, run } = stub({ author: "teammate-acme", draft: true })
    const options = { outsideAuthor: "teammate-acme", repo: REPO }
    const outcome = await prMerge(165, options, run, local())
    expect(outcome.kind).toBe("refused")
    expect(outcome.gates.find((gate) => gate.name === "ready")?.ok).toBe(false)
    expect(readies(calls)).toEqual([])
    expect(merges(calls)).toEqual([])
  })

  test("--explain names the draft it would mark ready, and marks nothing", async () => {
    const { calls, run } = stub({ draft: true })
    const outcome = await prMerge(112, { explain: true, repo: REPO }, run, local())
    expect(outcome.kind).toBe("explained")
    expect(outcome.gates.find((gate) => gate.name === "ready")).toMatchObject({
      detail: "a draft whose every other gate passes; pr:merge marks it ready before it merges",
      ok: true,
    })
    expect(readies(calls)).toEqual([])
  })

  test("a draft GitHub will not mark ready is not merged", async () => {
    const { calls, run } = stub({ draft: true, ready: { code: 1, stderr: "HTTP 502", stdout: "" } })
    const outcome = await prMerge(112, { repo: REPO }, run, local())
    expect(outcome).toMatchObject({ kind: "failed", reason: "gh pr ready exited 1: HTTP 502" })
    expect(merges(calls)).toEqual([])
  })
})

// dispatcher: a lead judged a merge clean from merge-tree's tree line and missed its exit code, so --explain says it in words.
describe("--explain's merge with canary", () => {
  test("a head that merges clean names canary and the tree", async () => {
    const { run } = stub({ aheadBy: "1" })
    const outcome = await prMerge(112, { explain: true, repo: REPO }, run, local())
    expect(outcome).toMatchObject({
      kind: "explained",
      merge: "#112 at 69a6a4c merges clean with canary 6f3db1e as tree 1bd0508",
    })
  })

  test("a conflicting head names its files, though merge-tree still prints a tree", async () => {
    const { run } = stub({ aheadBy: "1" })
    const outcome = await prMerge(112, { explain: true, repo: REPO }, run, local({ tree: null }))
    expect(outcome).toMatchObject({
      kind: "explained",
      merge: "#112 at 69a6a4c conflicts with canary 6f3db1e in AGENTS.md, web/next/x.ts",
    })
  })

  test("an answer that does not read is never called clean", async () => {
    for (const answer of [
      { code: 128, stderr: "fatal", stdout: "" },
      { code: 1, stderr: "", stdout: "abc\nCONFLICT" },
      { code: 0, stderr: "", stdout: "not a tree\n" },
    ]) {
      const { run } = stub({ aheadBy: "1" })
      const outcome = await prMerge(112, { explain: true, repo: REPO }, run, local({ answer }))
      expect(outcome).toMatchObject({
        kind: "explained",
        merge: "#112 at 69a6a4c: its merge with canary 6f3db1e could not be read",
      })
    }
  })
})

describe("the merge lock", () => {
  test("the suite's lock folder is never the factory's real one", () => {
    expect(lockRootOf()).toBe(join(scratch, "default"))
    expect(lockRootOf()).not.toBe(realLockRoot())
    expect(lockRootOf().startsWith(join(homedir(), ".claude"))).toBe(false)
  })

  test("a lock another merge holds refuses, naming that PR, and is left alone", async () => {
    const at = local()
    mkdirSync(join(at.lockRoot, "merge.lock"))
    writeFileSync(join(at.lockRoot, "merge.lock", "pr"), "140\n")
    const { calls, run } = stub()
    const outcome = await prMerge(112, { repo: REPO }, run, at)
    expect(outcome).toMatchObject({ holder: "140", kind: "locked" })
    expect(merges(calls)).toEqual([])
    expect(existsSync(join(at.lockRoot, "merge.lock", "pr"))).toBe(true)
  })

  test("a refusal still lets the lock go, into merge-locks/", async () => {
    const at = local()
    const { run } = stub({ aheadBy: "" })
    expect((await prMerge(112, { repo: REPO }, run, at)).kind).toBe("refused")
    expect(existsSync(join(at.lockRoot, "merge.lock"))).toBe(false)
    expect(readdirSync(join(at.lockRoot, "merge-locks"))).toEqual([
      expect.stringMatching(/^112-\d+-[0-9a-f]{8}$/),
    ])
  })

  test("outside the CLI, a run without a git stub throws before it fetches or locks, whatever NODE_ENV says", async () => {
    const { calls, run } = stub()
    await expect(prMerge(112, { repo: REPO }, run, { lockRoot: local().lockRoot })).rejects.toThrow(
      "needs a git stub",
    )
    expect(calls).toEqual([])
  })

  test("two releases in the same second each land, so the lock is never left held", async () => {
    const at = local()
    for (let i = 0; i < 2; i++) {
      const { run } = stub({ aheadBy: "" })
      expect((await prMerge(112, { repo: REPO }, run, at)).kind).toBe("refused")
      expect(existsSync(join(at.lockRoot, "merge.lock"))).toBe(false)
    }
    expect(readdirSync(join(at.lockRoot, "merge-locks"))).toHaveLength(2)
  })

  test("a merge holds the lock while it merges and posts its comment after letting it go", async () => {
    const at = local()
    const seen: { args: string; locked: boolean }[] = []
    const { run } = stub()
    const watched: Run = async (args) => {
      seen.push({
        args: args.slice(0, 2).join(" "),
        locked: existsSync(join(at.lockRoot, "merge.lock")),
      })
      return run(args)
    }
    expect(await prMerge(112, { repo: REPO }, watched, at)).toMatchObject({ kind: "merged" })
    expect(seen.find((s) => s.args === "pr merge")?.locked).toBe(true)
    expect(seen.find((s) => s.args === "pr comment")?.locked).toBe(false)
  })

  test("a lock that no longer names this PR is not moved", async () => {
    const at = local()
    const { run } = stub()
    const swapping: Run = async (args) => {
      if (args[0] === "pr" && args[1] === "merge")
        writeFileSync(join(at.lockRoot, "merge.lock", "pr"), "150\n")
      return run(args)
    }
    await prMerge(112, { repo: REPO }, swapping, at)
    expect(existsSync(join(at.lockRoot, "merge.lock", "pr"))).toBe(true)
  })

  test("--explain takes no lock", async () => {
    const at = local()
    mkdirSync(join(at.lockRoot, "merge.lock"))
    writeFileSync(join(at.lockRoot, "merge.lock", "pr"), "140\n")
    const { run } = stub()
    expect((await prMerge(112, { explain: true, repo: REPO }, run, at)).kind).toBe("explained")
  })
})

// #i516: the lock's holder kept in Redis with a time to live, the lock folder its fallback. A Redis holder makes the folder too, marked with its key's value and its pid, so a taker that cannot reach Redis always finds it.
describe("the merge lock in Redis", () => {
  // Redis as the lock needs it, in memory: a key lapses at its time, and `down` makes every call fail as an unreachable server does.
  const fakeRedis = () => {
    const keys = new Map<string, { until: number; value: string }>()
    let down = false
    const live = (key: string) => {
      const entry = keys.get(key)
      if (entry && entry.until <= Date.now()) keys.delete(key)
      return keys.get(key)
    }
    const reach = () => {
      if (down) throw Object.assign(new Error("connection refused"), { name: "RedisUnreachable" })
    }
    const store: LockStore = {
      close: () => {},
      free: async (key, value) => {
        reach()
        if (live(key)?.value !== value) return false
        return keys.delete(key)
      },
      renew: async (key, value, ttlMs) => {
        reach()
        const entry = live(key)
        if (entry?.value !== value) return false
        entry.until = Date.now() + ttlMs
        return true
      },
      take: async (key, holder, ttlMs) => {
        reach()
        const entry = live(key)
        if (entry) return { holder: entry.value.slice(entry.value.indexOf(" ") + 1) }
        const value = `${crypto.randomUUID()} ${holder}`
        keys.set(key, { until: Date.now() + ttlMs, value })
        return { value }
      },
    }
    return { keys, setDown: (to: boolean) => (down = to), store }
  }
  const root = () => mkdtempSync(join(scratch, "redis-lock-"))
  const held = (lock: Awaited<ReturnType<typeof takeLock>>) => "release" in lock
  const deadPid = () => Bun.spawnSync(["true"]).pid

  test("a holder that crashed lets its key lapse, and the next taker gets the lock", async () => {
    const at = root()
    const redis = fakeRedis()
    mkdirSync(join(at, "merge.lock"))
    writeFileSync(join(at, "merge.lock", "pr"), "140\n")
    writeFileSync(join(at, "merge.lock", "redis"), `lapsed-token 140\n${deadPid()}\n`)
    const lock = await takeLock(at, 112, { store: redis.store })
    expect(held(lock)).toBe(true)
    expect(readFileSync(join(at, "merge.lock", "pr"), "utf8")).toBe("112\n")
    if ("release" in lock) await lock.release()
  })

  test("two takers through Redis never both hold it", async () => {
    const at = root()
    const redis = fakeRedis()
    const first = await takeLock(at, 112, { store: redis.store })
    const second = await takeLock(at, 150, { store: redis.store })
    expect(held(first)).toBe(true)
    expect(second).toEqual({ holder: "112" })
    if ("release" in first) await first.release()
  })

  test("two takers that judge one crashed holder's folder stale at once: one holds it", async () => {
    const at = root()
    mkdirSync(join(at, "merge.lock"))
    writeFileSync(join(at, "merge.lock", "pr"), "140\n")
    writeFileSync(join(at, "merge.lock", "redis"), `lapsed-token 140\n${deadPid()}\n`)
    let n = 0
    const store: LockStore = {
      close: () => {},
      free: async () => true,
      renew: async () => true,
      take: async (_key, holder) => ({ value: `token${n++} ${holder}` }),
    }
    const both = await Promise.all([takeLock(at, 112, { store }), takeLock(at, 150, { store })])
    expect(both.filter(held)).toHaveLength(1)
  })

  test("a taker that cannot reach Redis while another holds the key is refused, never holding the folder beside it", async () => {
    const at = root()
    const redis = fakeRedis()
    const first = await takeLock(at, 112, { store: redis.store })
    redis.setDown(true)
    expect(await takeLock(at, 150, { store: redis.store })).toEqual({ holder: "112" })
    redis.setDown(false)
    if ("release" in first) await first.release()
  })

  test("a folder holder (Redis was down) refuses a taker that reaches Redis, which leaves no key behind", async () => {
    const at = root()
    const redis = fakeRedis()
    redis.setDown(true)
    const first = await takeLock(at, 112, { store: redis.store })
    redis.setDown(false)
    expect(await takeLock(at, 150, { store: redis.store })).toEqual({ holder: "112" })
    expect(redis.keys.size).toBe(0)
    if ("release" in first) await first.release()
  })

  test("Redis down falls back to the lock folder, released into merge-locks/ as before", async () => {
    const at = root()
    const redis = fakeRedis()
    redis.setDown(true)
    const lock = await takeLock(at, 112, { store: redis.store })
    expect(existsSync(join(at, "merge.lock", "redis"))).toBe(false)
    if ("release" in lock) await lock.release()
    expect(existsSync(join(at, "merge.lock"))).toBe(false)
    expect(readdirSync(join(at, "merge-locks"))).toHaveLength(1)
  })

  test("a holder still alive whose key lapsed (it could not renew) still refuses the next taker", async () => {
    const at = root()
    const redis = fakeRedis()
    const first = await takeLock(at, 112, { store: redis.store })
    redis.keys.clear()
    expect(await takeLock(at, 150, { store: redis.store })).toEqual({ holder: "112" })
    if ("release" in first) await first.release()
  })

  test("a holder renews its key while it holds the lock, and its release frees the key and moves the folder aside", async () => {
    const at = root()
    const redis = fakeRedis()
    const lock = await takeLock(at, 112, { store: redis.store, ttlMs: 600 })
    await Bun.sleep(1500)
    expect(redis.keys.size).toBe(1)
    if ("release" in lock) await lock.release()
    expect(redis.keys.size).toBe(0)
    expect(existsSync(join(at, "merge.lock"))).toBe(false)
  })
})

test("isServerError knows GitHub's 5xx answers and nothing else", () => {
  expect(isServerError("non-200 OK status code: 502 Bad Gateway")).toBe(true)
  expect(isServerError("HTTP 503: Service Unavailable")).toBe(true)
  expect(isServerError("GraphQL: Pull Request is not mergeable")).toBe(false)
  expect(isServerError("acme/factory#512 is not mergeable")).toBe(false)
})

describe("a head with no finished GitGuardian check", () => {
  test("GitGuardian's check is needed on factory.repo alone, the checkout's origin while unset, and with neither the gate refuses", async () => {
    const none = { PLAYGROUND_DATA_DIR: join(scratch, "no-store") }
    // checkouts of this test's own, so the box's CI worktree, which has no GitHub origin, reads the same as a Mac's
    const checkout = (origin?: string) => {
      const dir = mkdtempSync(join(scratch, "checkout-"))
      Bun.spawnSync(["git", "init", "-q", dir])
      if (origin) Bun.spawnSync(["git", "-C", dir, "remote", "add", "origin", origin])
      return dir
    }
    const origin = checkout("git@github.com:Acme/Factory-Origin.git")
    expect((await gateOptions("acme/factory-origin", {}, none, origin)).gitGuardian).toBe(true)
    expect((await gateOptions("acme/other", {}, none, origin)).gitGuardian).toBe(false)
    await expect(gateOptions("acme/other", {}, none, checkout())).rejects.toThrow(
      "factory.repo is unset",
    )
    const set = {
      PLAYGROUND_DATA_DIR: storeWith(
        join(scratch, "factory-repo"),
        {},
        { "factory.repo": "Acme/Other" },
      ),
    }
    expect((await gateOptions("acme/other", {}, set)).gitGuardian).toBe(true)
    expect((await gateOptions(REPO, {}, set)).gitGuardian).toBe(false)
  })

  test("refuses on dispatcher with GitGuardian absent or still running", async () => {
    for (const checks of [[], [GUARDIAN_RUNNING]]) {
      const { calls, run } = stub({ checks })
      const outcome = await prMerge(112, { repo: REPO }, run, local())
      expect(outcome.kind).toBe("refused")
      expect(outcome.gates.filter((g) => !g.ok).map((g) => g.name)).toEqual(["ci"])
      expect(merges(calls)).toEqual([])
    }
    const { run } = stub({ checks: [] })
    const refused = await prMerge(112, { repo: REPO }, run, local())
    expect(refused.gates.find((g) => g.name === "ci")?.detail).toContain("no GitGuardian check")
  })

  test("a repo GitGuardian does not scan needs no check", async () => {
    const { run } = stub({ checks: [] })
    const outcome = await prMerge(112, { repo: "acme/other" }, run, local())
    expect(outcome).toMatchObject({ kind: "merged" })
  })
})
