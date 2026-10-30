import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  type EndDeps,
  endMerged,
  sweep,
  type Target,
  unsavedLive,
} from "../../../../scripts/ops/optimizer/auto_end"
import type {
  CollectInput,
  PrState,
  RegistryEntry,
} from "../../../../scripts/ops/optimizer/idle_sessions"

const NOW = 1_760_700_000
const URL = "https://github.com/o/r/pull/2110"
const NEXT = "https://github.com/o/r/pull/2111"
const MERGED: PrState = {
  head: "abc1234",
  mergeSha: "daaac8e0000",
  ref: "pg-2099-x",
  state: "merged",
  verdicts: [],
}

const live = (name: string, over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  name,
  pid: 4242,
  sessionId: `sess-${name}`,
  status: "idle",
  statusUpdatedAt: (NOW - 45 * 60) * 1000,
  ...over,
})

// A faked herdr (close), roster (report) and worktree read (unsaved), each call kept.
const fakes = (over: Partial<EndDeps> = {}) => {
  const closed: string[] = []
  const reported: [string, string][] = []
  const checked: Target[] = []
  const deps: EndDeps = {
    close: async (name) => {
      closed.push(name)
      return { ok: true, out: `closed ${name} (pane w1:p2 on factory)` }
    },
    report: async (name, text) => void reported.push([name, text]),
    unsaved: async (target) => {
      checked.push(target)
      return null
    },
    ...over,
  }
  return { checked, closed, deps, reported }
}

const input = (over: Partial<CollectInput> = {}): CollectInput => ({
  hours: 1,
  now: NOW,
  prState: async (url) => (url === URL ? MERGED : null),
  roster: {},
  sessions: {},
  workerPrs: async () => [],
  ...over,
})

describe("sweep: ops-tick ends what the detector flags", () => {
  test("a checker whose PR is done, one whose worker is gone, and a worker whose PRs are merged", async () => {
    const { closed, deps, reported } = fakes()
    const lines = await sweep(
      input({
        roster: {
          "b7k2mq-tester": { kind: "tester", name: "b7k2mq-tester", worker: "gone-worker" },
          "m4tqzr-reviewer": { kind: "reviewer", name: "m4tqzr-reviewer", pr: URL },
          "q6dmtb-worker": { kind: "worker", name: "q6dmtb-worker", pr: URL },
        },
        sessions: {
          "b7k2mq-tester": live("b7k2mq-tester"),
          "m4tqzr-reviewer": live("m4tqzr-reviewer"),
          "m4tqzr-worker": live("m4tqzr-worker", { status: "busy" }),
          "q6dmtb-worker": live("q6dmtb-worker"),
        },
        workerPrs: async (name) =>
          name === "m4tqzr-reviewer" || name === "q6dmtb-worker" ? [URL] : [],
      }),
      deps,
    )
    expect(closed).toEqual(["b7k2mq-tester", "m4tqzr-reviewer", "q6dmtb-worker"])
    expect(reported).toEqual([
      ["b7k2mq-tester", "ended automatically: checker-worker-gone (gone-worker)"],
      ["m4tqzr-reviewer", "ended automatically: checker-pr-done (merged), merged as daaac8e"],
      ["q6dmtb-worker", "ended automatically: worker-prs-done (merged), merged as daaac8e"],
    ])
    expect(lines).toEqual([
      { text: "Ended b7k2mq-tester: checker-worker-gone (gone-worker)", to: "builder" },
      {
        text: "Ended m4tqzr-reviewer: checker-pr-done (merged), merged as daaac8e",
        to: "builder",
      },
      { text: "Ended q6dmtb-worker: worker-prs-done (merged), merged as daaac8e", to: "builder" },
    ])
  })

  test("a reviewer idle 30+ minutes on a scored head ends with its resume named; a tester does not", async () => {
    const scored: PrState = { head: "abc1234567", state: "open", verdicts: ["abc1234"] }
    const { closed, deps } = fakes()
    const lines = await sweep(
      input({
        prState: async () => scored,
        roster: {
          "k8wjf3-reviewer": { kind: "reviewer", name: "k8wjf3-reviewer", worker: "k8wjf3-worker" },
          "k8wjf3-tester": { kind: "tester", name: "k8wjf3-tester", worker: "k8wjf3-worker" },
        },
        sessions: {
          "k8wjf3-reviewer": live("k8wjf3-reviewer"),
          "k8wjf3-tester": live("k8wjf3-tester"),
          "k8wjf3-worker": live("k8wjf3-worker", { status: "busy" }),
        },
        workerPrs: async (name) => (name === "k8wjf3-worker" ? [] : [NEXT]),
      }),
      deps,
    )
    expect(closed).toEqual(["k8wjf3-reviewer"])
    const text =
      "Ended k8wjf3-reviewer: checker-nothing (head scored); resume it on the next push: scripts/spawn.sh resume k8wjf3-reviewer <dir>"
    expect(lines).toEqual([
      { text, to: "builder" },
      { text, to: "k8wjf3-worker" },
    ])
  })

  test("a line goes to the roster lead, its worker's, or ops for a ops checker; a roster-says flag ends nobody", async () => {
    const { closed, deps } = fakes()
    const lines = await sweep(
      input({
        roster: {
          "h3fnrc-tester": { kind: "tester", name: "h3fnrc-tester", pr: URL, worker: "ops" },
          "w33hrq-reviewer": {
            kind: "reviewer",
            name: "w33hrq-reviewer",
            pr: URL,
            worker: "w33hrq-worker",
          },
          "w33hrq-worker": { kind: "worker", lead: "ops", name: "w33hrq-worker", pr: URL },
          "p8nj8s-worker": { kind: "worker", name: "p8nj8s-worker", status: "paused" },
        },
        sessions: {
          "h3fnrc-tester": live("h3fnrc-tester"),
          ops: live("ops", { status: "busy" }),
          "p8nj8s-worker": live("p8nj8s-worker"),
          "w33hrq-reviewer": live("w33hrq-reviewer"),
          "w33hrq-worker": live("w33hrq-worker"),
        },
        workerPrs: async (name) => (name === "p8nj8s-worker" ? [] : [URL]),
      }),
      deps,
    )
    expect(closed).toEqual(["h3fnrc-tester", "w33hrq-reviewer", "w33hrq-worker"])
    expect(lines.map((l) => l.to)).toEqual(["ops", "ops", "ops"])
  })

  test("a checker of an <id>-ops worker with no roster lead tells ops, not the builder", async () => {
    const { closed, deps } = fakes()
    const lines = await sweep(
      input({
        roster: {
          "r2kq9m-reviewer": {
            kind: "reviewer",
            name: "r2kq9m-reviewer",
            pr: URL,
            worker: "x4m2kq-ops",
          },
        },
        sessions: { "r2kq9m-reviewer": live("r2kq9m-reviewer") },
      }),
      deps,
    )
    expect(closed).toEqual(["r2kq9m-reviewer"])
    expect(lines.map((l) => l.to)).toEqual(["ops"])
  })
})

describe("guards", () => {
  test("never a manager, the dispatcher, a runner, the optimizer or a probe, whatever its roster pr", async () => {
    const names = ["builder", "dispatcher", "optimizer", "runner-plain-relay", "z9xq7t-probe"]
    const kinds = ["builder", "dispatcher", "optimizer", "runner", "probe"]
    const { closed, deps, reported } = fakes()
    const lines = await endMerged(
      URL,
      "daaac8e0000",
      input({
        roster: Object.fromEntries(
          names.map((name, i) => [name, { kind: kinds[i], name, pr: URL }]),
        ),
        sessions: Object.fromEntries(names.map((name) => [name, live(name)])),
      }),
      deps,
    )
    expect([lines, closed, reported]).toEqual([[], [], []])
  })

  test("a busy session, or one quiet under 10 minutes, is left for the sweep", async () => {
    const { closed, deps } = fakes()
    const lines = await endMerged(
      URL,
      "daaac8e0000",
      input({
        roster: {
          "2ngpk2-reviewer": { kind: "reviewer", name: "2ngpk2-reviewer", pr: URL },
          "2ngpk2-tester": { kind: "tester", name: "2ngpk2-tester", pr: URL },
        },
        sessions: {
          "2ngpk2-reviewer": live("2ngpk2-reviewer", { status: "busy" }),
          "2ngpk2-tester": live("2ngpk2-tester", { statusUpdatedAt: (NOW - 9 * 60) * 1000 }),
        },
      }),
      deps,
    )
    expect([lines, closed]).toEqual([[], []])
  })

  test("uncommitted or unpushed work keeps a session open and tells its lead", async () => {
    const { checked, closed, deps, reported } = fakes({
      unsaved: async (target) => {
        checked.push(target)
        return "uncommitted work in /wt/pg-2099-x"
      },
    })
    const lines = await endMerged(
      URL,
      "daaac8e0000",
      input({
        roster: { "q6dmtb-worker": { kind: "worker", name: "q6dmtb-worker", pr: URL } },
        sessions: { "q6dmtb-worker": live("q6dmtb-worker") },
      }),
      deps,
    )
    expect(checked.map((t) => [t.name, t.refs])).toEqual([["q6dmtb-worker", ["pg-2099-x"]]])
    expect([closed, reported]).toEqual([[], []])
    expect(lines).toEqual([
      {
        text: "Not ended q6dmtb-worker (#2110 merged as daaac8e): uncommitted work in /wt/pg-2099-x; push it, then close it",
        to: "builder",
      },
    ])
  })

  test("a close spawn.sh refuses ends nothing and tells the lead why", async () => {
    const { deps, reported } = fakes({
      close: async () => ({ ok: false, out: "spawn.sh: no resume record for wwzdhx-reviewer" }),
    })
    const lines = await endMerged(
      URL,
      "daaac8e0000",
      input({
        roster: { "wwzdhx-reviewer": { kind: "reviewer", name: "wwzdhx-reviewer", pr: URL } },
        sessions: { "wwzdhx-reviewer": live("wwzdhx-reviewer") },
      }),
      deps,
    )
    expect(reported).toEqual([])
    expect(lines.map((l) => l.text)).toEqual([
      "Not ended wwzdhx-reviewer (#2110 merged as daaac8e): spawn.sh close refused: spawn.sh: no resume record for wwzdhx-reviewer",
    ])
  })
})

describe("endMerged: right after a merge", () => {
  test("ends the PR's worker, reviewer and tester, each row with the merged sha", async () => {
    const { closed, deps, reported } = fakes()
    const lines = await endMerged(
      URL,
      "daaac8e0000",
      input({
        roster: {
          "yrpygg-reviewer": {
            kind: "reviewer",
            name: "yrpygg-reviewer",
            pr: URL,
            worker: "yrpygg-worker",
          },
          "yrpygg-tester": {
            kind: "tester",
            name: "yrpygg-tester",
            pr: URL,
            worker: "yrpygg-worker",
          },
          "yrpygg-worker": { kind: "worker", name: "yrpygg-worker", pr: URL },
        },
        sessions: {
          "yrpygg-reviewer": live("yrpygg-reviewer"),
          "yrpygg-tester": live("yrpygg-tester", { status: "shell" }),
          "yrpygg-worker": live("yrpygg-worker"),
        },
      }),
      deps,
    )
    expect(closed).toEqual(["yrpygg-reviewer", "yrpygg-tester", "yrpygg-worker"])
    expect(reported.map(([, text]) => text)).toEqual([
      "ended automatically: #2110 merged as daaac8e",
      "ended automatically: #2110 merged as daaac8e",
      "ended automatically: #2110 merged as daaac8e",
    ])
    expect(lines).toHaveLength(3)
  })

  test("a worker with a next task, and the checkers of a worker on its next PR, stay", async () => {
    const { closed, deps } = fakes()
    await endMerged(
      URL,
      "daaac8e0000",
      input({
        roster: {
          "fnhq3x-reviewer": {
            kind: "reviewer",
            name: "fnhq3x-reviewer",
            pr: URL,
            worker: "fnhq3x-worker",
          },
          "fnhq3x-worker": { kind: "worker", name: "fnhq3x-worker", pr: NEXT },
          "p2vxnf-worker": { kind: "worker", name: "p2vxnf-worker" },
        },
        sessions: {
          "fnhq3x-reviewer": live("fnhq3x-reviewer"),
          "fnhq3x-worker": live("fnhq3x-worker"),
          "p2vxnf-worker": live("p2vxnf-worker"),
        },
      }),
      deps,
    )
    expect(closed).toEqual([])
  })

  test("a worker and its checker whose other PR is still open stay: the worker's transcript links it", async () => {
    const { closed, deps } = fakes()
    const lines = await endMerged(
      URL,
      "daaac8e0000",
      input({
        linkedPrs: async (sessionId) => (sessionId === "sess-fnhq3x-worker" ? [URL, NEXT] : []),
        prState: async (url) =>
          url === URL
            ? MERGED
            : url === NEXT
              ? { ...MERGED, mergeSha: undefined, state: "open" }
              : null,
        roster: {
          "fnhq3x-reviewer": {
            kind: "reviewer",
            name: "fnhq3x-reviewer",
            pr: URL,
            worker: "fnhq3x-worker",
          },
          "fnhq3x-worker": { kind: "worker", name: "fnhq3x-worker", pr: URL },
        },
        sessions: {
          "fnhq3x-reviewer": live("fnhq3x-reviewer"),
          "fnhq3x-worker": live("fnhq3x-worker"),
        },
      }),
      deps,
    )
    expect(closed).toEqual([])
    expect(lines).toEqual([])
  })

  test("a session whose other PR could not be read stays, as on a rate limit", async () => {
    const { closed, deps } = fakes()
    await endMerged(
      URL,
      "daaac8e0000",
      input({
        linkedPrs: async (sessionId) => (sessionId === "sess-k3m9px-worker" ? [URL, NEXT] : []),
        roster: { "k3m9px-worker": { kind: "worker", name: "k3m9px-worker", pr: URL } },
        sessions: { "k3m9px-worker": live("k3m9px-worker") },
      }),
      deps,
    )
    expect(closed).toEqual([])
  })

  test("a row whose session is gone is ended in the roster alone, and an ended row is left", async () => {
    const { closed, deps, reported } = fakes()
    const lines = await endMerged(
      URL,
      "daaac8e0000",
      input({
        roster: {
          "5j9yqr-reviewer": { kind: "reviewer", name: "5j9yqr-reviewer", pr: URL },
          "5j9yqr-tester": { kind: "tester", name: "5j9yqr-tester", pr: URL, status: "ended" },
        },
      }),
      deps,
    )
    expect(closed).toEqual([])
    expect(reported).toEqual([
      ["5j9yqr-reviewer", "ended automatically: #2110 merged as daaac8e, with no live session"],
    ])
    expect(lines.map((l) => l.text)).toEqual([
      "Ended 5j9yqr-reviewer's row: #2110 merged as daaac8e, with no live session",
    ])
  })
})

describe("unsavedLive: the worktrees a session used, read for unsaved work", () => {
  const sh = (cwd: string, ...argv: string[]) => {
    const r = Bun.spawnSync(argv, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    })
    if (r.exitCode !== 0) throw new Error(`${argv.join(" ")}: ${r.stderr}`)
  }
  // A clone of a scratch remote, pushed clean, a linked worktree of it on a pushed branch, and a transcript whose cwds are the clone and the worktree.
  const scratch = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "auto-end-")))
    const remote = join(root, "remote.git")
    const main = join(root, "main")
    const dir = join(root, "work")
    sh(root, "git", "init", "-q", "--bare", remote)
    sh(root, "git", "clone", "-q", remote, main)
    writeFileSync(join(main, "a.txt"), "a\n")
    sh(main, "git", "add", "a.txt")
    sh(main, "git", "commit", "-qm", "a")
    sh(main, "git", "push", "-q", "origin", "HEAD")
    sh(main, "git", "worktree", "add", "-q", "-b", "work", dir)
    sh(dir, "git", "push", "-q", "origin", "work")
    const projects = join(root, "projects")
    mkdirSync(join(projects, "-scratch"), { recursive: true })
    writeFileSync(
      join(projects, "-scratch", "sess-1.jsonl"),
      `${JSON.stringify({ cwd: main, type: "user" })}\n${JSON.stringify({ cwd: dir, type: "user" })}\n`,
    )
    const target: Target = {
      kind: "reviewer",
      name: "k3m9px-reviewer",
      refs: [],
      sessionId: "sess-1",
    }
    return { dir, main, projects, target }
  }

  test("a clean, pushed worktree reads null; an uncommitted file and an unpushed commit each name the worktree", async () => {
    const { dir, projects, target } = scratch()
    expect(await unsavedLive(target, projects)).toBeNull()
    writeFileSync(join(dir, "b.txt"), "b\n")
    expect(await unsavedLive(target, projects)).toBe(`uncommitted work in ${dir}`)
    sh(dir, "git", "add", "b.txt")
    sh(dir, "git", "commit", "-qm", "b")
    expect(await unsavedLive(target, projects)).toBe(`unpushed commits in ${dir}`)
  })

  test("the main checkout every session starts in is never read: its untracked files hold no end", async () => {
    const { main, projects, target } = scratch()
    writeFileSync(join(main, "par.out"), "x\n")
    expect(await unsavedLive(target, projects)).toBeNull()
  })

  test("a read that fails holds the end: a worktree with no commit to read, and a transcript folder that cannot be read", async () => {
    const { main, projects, target } = scratch()
    const bare = join(projects, "..", "empty")
    sh(main, "git", "worktree", "add", "-q", "--orphan", "-b", "empty", bare)
    writeFileSync(join(projects, "-scratch", "sess-1.jsonl"), `${JSON.stringify({ cwd: bare })}\n`)
    expect(await unsavedLive(target, projects)).toBe(`could not check ${bare}`)
    const file = join(projects, "..", "not-a-folder")
    writeFileSync(file, "")
    expect(await unsavedLive(target, file)).toBe(`could not check its transcript in ${file}`)
  })
})
