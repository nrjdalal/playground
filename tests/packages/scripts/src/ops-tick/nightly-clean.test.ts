import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  bytesOf,
  branchLink,
  decisionOf,
  discardable,
  nightlyClean,
  type NightDeps,
  type Pr,
  type Prs,
  pruneTurbo,
  readPrs,
  staleBranches,
  staleContainers,
  staleVolumes,
  staleWorktrees,
  trashSince,
  worktreesIn,
} from "../../../../../packages/scripts/src/ops-tick/nightly-clean"
import { BEATS, type Context } from "../../../../../packages/scripts/src/ops-tick/tick"
import type { CleanupDeps } from "../../../../../scripts/ops/optimizer/auto_end"
import { type Answers, fakeRun, ghErrors } from "./fake-run"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})
const scratch = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nightly-clean-")))
  dirs.push(root)
  return root
}

const pr = (state: Pr["state"], headRefOid = "h1", n = 1): Pr => ({
  headRefOid,
  state,
  url: `https://github.com/acme/app/pull/${n}`,
})
const prsOf = (byBranch: Record<string, Pr>, byNumber: Record<number, Pr> = {}): Prs => ({
  byBranch: new Map(Object.entries(byBranch)),
  byNumber: new Map(Object.entries(byNumber).map(([n, p]) => [Number(n), p])),
})
const live = (c: string) => c === "playground-dashboard-db" || c === "playground-dashboard-db-sY08"

test("the beat runs nightly at 3:00 am machine time, and the weekly turbo prune is gone", () => {
  expect(BEATS.find((b) => b.name === "nightly-clean")?.cron).toBe("0 3 * * *")
  expect(BEATS.find((b) => b.name === "turbo-prune")).toBeUndefined()
})

test("docker's sizes read as bytes, the first figure alone", () => {
  expect(bytesOf("63B (virtual 300MB)")).toBe(63)
  expect(bytesOf("1.5GB")).toBe(1.5e9)
  expect(bytesOf("512kB")).toBe(512e3)
  expect(bytesOf("N/A")).toBe(0)
})

describe("worktrees", () => {
  const main = "/m"
  const at = (name: string) => `/m/.claude/worktrees/${name}`
  const porcelain = [
    "worktree /m\nHEAD a\nbranch refs/heads/main",
    `worktree ${at("pg-1")}\nHEAD b\nbranch refs/heads/PG-1-merged`,
    `worktree ${at("pg-2")}\nHEAD c\nbranch refs/heads/PG-2-open`,
    `worktree ${at("pg-3")}\nHEAD d\nbranch refs/heads/PG-3-nopr`,
    `worktree ${at("review-12")}\nHEAD e\ndetached`,
    `worktree ${at("review-13")}\nHEAD f\ndetached`,
    "worktree /elsewhere/x\nHEAD g\nbranch refs/heads/PG-1-merged",
  ].join("\n\n")

  test("only those directly in .claude/worktrees are read, each with its branch or none", () => {
    expect(worktreesIn(porcelain, main).map((w) => [w.path, w.branch])).toEqual([
      [at("pg-1"), "PG-1-merged"],
      [at("pg-2"), "PG-2-open"],
      [at("pg-3"), "PG-3-nopr"],
      [at("review-12"), null],
      [at("review-13"), null],
    ])
  })

  test("a worktree whose PR merged or closed is stale, by its branch or a review clone's number; an open PR's or one with none stays", () => {
    const prs = prsOf(
      { "PG-1-merged": pr("MERGED"), "PG-2-open": pr("OPEN") },
      { 12: pr("CLOSED"), 13: pr("OPEN") },
    )
    expect(staleWorktrees(worktreesIn(porcelain, main), prs).map((w) => w.path)).toEqual([
      at("pg-1"),
      at("review-12"),
    ])
  })

  test("a kept line goes to the decision list only for work the owner's Approve may drop", () => {
    expect(discardable("kept /w: uncommitted work")).toBe(true)
    expect(discardable("kept /w: unpushed commits")).toBe(true)
    expect(discardable("kept /w: could not count its unpushed commits")).toBe(false)
    expect(
      discardable(
        "kept /w: /w's HEAD holds work not landed on origin/canary (fetch origin canary if it merged since): playground rm --worktree /w --discard removes it anyway, which a session runs with --decision <id> once an Inbox delete decision naming it is approved",
      ),
    ).toBe(true)
    expect(
      discardable("kept /w: /w is held by abc123-worker, which the roster lists as working"),
    ).toBe(false)
    expect(discardable("kept /w: the live dashboard's checkout")).toBe(false)
  })
})

test("branches: merged ones and a done PR's still at its head go, the rest are asked or kept", () => {
  const plan = staleBranches({
    checkedOut: new Set(["PG-6-out"]),
    keep: new Set(["canary", "main", "live/dashboard"]),
    local: [
      { name: "canary", sha: "c" },
      { name: "live/dashboard", sha: "l" },
      { name: "PG-1-merged", sha: "a" },
      { name: "PG-2-squashed", sha: "h2" },
      { name: "PG-3-ahead", sha: "x" },
      { name: "PG-4-open", sha: "o" },
      { name: "scratch", sha: "s" },
      { name: "PG-6-out", sha: "z" },
    ],
    merged: new Set(["canary", "PG-1-merged"]),
    prs: new Map([
      ["PG-2-squashed", pr("MERGED", "h2")],
      ["PG-3-ahead", pr("CLOSED", "h3")],
      ["PG-4-open", pr("OPEN", "o")],
      ["PG-7-remote", pr("MERGED", "r7")],
      ["PG-8-moved", pr("MERGED", "r8")],
    ]),
    remote: [
      { name: "canary", sha: "c" },
      { name: "PG-7-remote", sha: "r7" },
      { name: "PG-8-moved", sha: "other" },
      { name: "no-pr", sha: "n" },
    ],
  })
  expect(plan).toEqual({
    decide: ["PG-3-ahead", "scratch"],
    local: ["PG-1-merged", "PG-2-squashed"],
    remote: ["PG-7-remote"],
  })
})

test("containers: an exited worktree container whose folder is gone goes; the live dashboard's, pglaunch's, a Vibeground copy, a running one and one whose folder stands stay", () => {
  const small = 100
  const plan = staleContainers(
    [
      { name: "playground-pg-9-db", size: small, state: "exited" },
      { name: "playground-pg-9-redis", size: small, state: "exited" },
      { name: "playground-pg-1-db", size: small, state: "exited" },
      { name: "playground-pg-5-db", size: small, state: "running" },
      { name: "playground-dashboard-db", size: small, state: "exited" },
      { name: "playground-dashboard-db-sY08", size: small, state: "exited" },
      { name: "playground-vibe-pg-9-ab12cd34-db", size: small, state: "exited" },
      { name: "playground-db", size: small, state: "exited" },
      { name: "someone-else", size: 2e9, state: "exited" },
      { name: "playground-dashboard-db-big", size: 2e9, state: "running" },
    ],
    ["PG-1", "pg-5"],
    live,
  )
  expect(plan).toEqual({
    decide: ["someone-else", "playground-dashboard-db-big"],
    remove: ["playground-pg-9-db", "playground-pg-9-redis"],
  })
})

test("volumes no container uses that hold over 1 GB are asked, and an unreadable df asks none", () => {
  const df = JSON.stringify({
    Volumes: [
      { Links: "0", Name: "big-unused", Size: "2.5GB" },
      { Links: "1", Name: "big-used", Size: "9GB" },
      { Links: "0", Name: "small", Size: "20MB" },
    ],
  })
  expect(staleVolumes(df)).toEqual(["big-unused"])
  expect(staleVolumes("not json")).toEqual([])
})

test("gh's PR answer reads from its stdout alone, a number that is no PR skipped and its errors and stderr line no bar", async () => {
  const prs = prsOf({})
  const { out } = await fakeRun({
    graphql: ghErrors(
      {
        b0: {
          nodes: [{ headRefOid: "h1", state: "MERGED", url: "https://github.com/acme/app/pull/7" }],
        },
        b1: { nodes: [] },
        n0: null,
        n1: { headRefOid: "h2", state: "CLOSED", url: "https://github.com/acme/app/pull/12" },
      },
      ["Could not resolve to a PullRequest with the number of 939."],
    ),
  }).run(["gh", "api", "graphql", "-f", "query=..."])
  expect(readPrs(out, ["PG-1-a", "no-pr"], [939, 12], prs)).toBe(true)
  expect([...prs.byBranch]).toEqual([
    ["PG-1-a", { headRefOid: "h1", state: "MERGED", url: "https://github.com/acme/app/pull/7" }],
  ])
  expect([...prs.byNumber]).toEqual([
    [12, { headRefOid: "h2", state: "CLOSED", url: "https://github.com/acme/app/pull/12" }],
  ])
  expect(readPrs("gh: HTTP 502", [], [], prsOf({}))).toBe(false)
})

test("the trash count adds each purge line's batches after the last run", () => {
  const log = [
    "2026-11-03T10:17:00Z removed 4 (a, b, c, d)",
    "2026-11-04T10:17:00Z removed 2 (e, f)",
    "2026-11-04T11:17:00Z removed 0",
  ].join("\n")
  expect(trashSince(log, Date.parse("2026-11-04T00:00:00Z"))).toBe(2)
  expect(trashSince("", 0)).toBe(0)
})

describe("the turbo cache", () => {
  test("a 3-day-old entry goes, a 1-day-old entry and a folder stay", async () => {
    const cache = join(scratch(), "turbo")
    mkdirSync(join(cache, "sub"), { recursive: true })
    const now = new Date("2026-11-05T03:00:00Z")
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000)
    writeFileSync(join(cache, "old.tar.zst"), "x".repeat(3 * 1_048_576))
    utimesSync(join(cache, "old.tar.zst"), days(3), days(3))
    writeFileSync(join(cache, "new.tar.zst"), "y")
    utimesSync(join(cache, "new.tar.zst"), days(1), days(1))
    writeFileSync(join(cache, "sub", "inner"), "z")
    utimesSync(join(cache, "sub", "inner"), days(30), days(30))
    expect(await pruneTurbo(cache, now)).toBe("removed 1, kept 1, freed 3 MB")
    expect(existsSync(join(cache, "old.tar.zst"))).toBe(false)
    expect(existsSync(join(cache, "new.tar.zst"))).toBe(true)
    expect(existsSync(join(cache, "sub", "inner"))).toBe(true)
  })

  test("a missing folder and one it cannot read are named, and nothing throws", async () => {
    const root = scratch()
    expect(await pruneTurbo(join(root, "none"), new Date())).toBe(`no folder ${join(root, "none")}`)
    writeFileSync(join(root, "file"), "")
    expect(await pruneTurbo(join(root, "file"), new Date())).toBe(
      `unreadable ${join(root, "file")}: ENOTDIR`,
    )
  })
})

test("the decision's why links each target's PR or compare, and its state keeps no link", () => {
  const { item, targets } = decisionOf("ops", [
    {
      kind: "worktree",
      link: "https://github.com/acme/app/pull/12",
      name: "/m/.claude/worktrees/pg-2",
    },
    { kind: "branch", link: "https://github.com/acme/app/compare/scratch", name: "scratch" },
    { kind: "container", name: "big-db" },
  ])
  expect((item as { preview: { why: string } }).preview.why).toEndWith(
    "\n\n- worktree `pg-2`: [#12](https://github.com/acme/app/pull/12)\n- branch `scratch`: [compare](https://github.com/acme/app/compare/scratch)",
  )
  expect(targets).toEqual([
    { kind: "worktree", name: "/m/.claude/worktrees/pg-2" },
    { kind: "branch", name: "scratch" },
    { kind: "container", name: "big-db" },
  ])
  const linked = Array.from({ length: 60 }, (_, i) => ({
    kind: "branch" as const,
    link: `https://github.com/acme/app/compare/a-long-branch-name-${i}`,
    name: `a-long-branch-name-${i}`,
  }))
  expect(
    (decisionOf("ops", linked).item as { preview: { why: string } }).preview.why.length,
  ).toBeLessThanOrEqual(3900)
})

test("a branch on the decision list links its PR, else its compare once pushed, else nothing", () => {
  const prs = {
    ...prsOf({ "PG-3-ahead": pr("CLOSED", "h3", 3) }),
    repo: "https://github.com/acme/app",
  }
  const pushed = new Set(["PG-3-ahead", "no-pr"])
  expect(branchLink("PG-3-ahead", prs, pushed)).toBe("https://github.com/acme/app/pull/3")
  expect(branchLink("no-pr", prs, pushed)).toBe("https://github.com/acme/app/compare/no-pr")
  expect(branchLink("scratch", prs, pushed)).toBeUndefined()
  expect(branchLink("no-pr", prsOf({}), pushed)).toBeUndefined()
})

test("the decision names each target whole, and holds no more than fits", () => {
  const { item, targets } = decisionOf("ops", [
    { kind: "worktree", name: "/m/.claude/worktrees/pg-2" },
    { kind: "branch", name: "scratch" },
  ])
  expect(targets.length).toBe(2)
  expect(JSON.stringify(item)).toContain("worktree `/m/.claude/worktrees/pg-2`")
  expect(item).toMatchObject({ kind: "decision", preview: { type: "delete" } })
  const many = Array.from({ length: 200 }, (_, i) => ({
    kind: "worktree" as const,
    name: `/m/.claude/worktrees/a-long-worktree-name-${i}`,
  }))
  const capped = decisionOf("ops", many)
  expect((capped.item as { preview: { why: string } }).preview.why).not.toContain("](")
  expect(capped.targets.length).toBeLessThan(200)
  expect((capped.item as { preview: { what: string } }).preview.what.length).toBeLessThan(4000)
})

describe("one night's run against a fixture data folder", () => {
  const ID = "11111111-2222-3333-4444-555555555555"
  const OLD = "99999999-2222-3333-4444-555555555555"
  // A data folder with ops and a roster, a main checkout with worktrees pg-1 (merged, held by a live session), pg-2 (merged, dirty) and pg-3 (open), each command's output by a word of its argv.
  const night = (
    outputs: Record<string, string> = {},
    state?: (wt: (name: string) => string) => object,
    grow = 0.6,
  ) => {
    const root = scratch()
    const data = join(root, "data")
    const ops = join(data, "ops")
    const main = join(root, "main")
    for (const name of ["pg-1", "pg-2", "pg-3"])
      mkdirSync(join(main, ".claude", "worktrees", name), { recursive: true })
    mkdirSync(join(ops, "log"), { recursive: true })
    writeFileSync(join(data, "roster.json"), JSON.stringify({ agents: [] }))
    const wt = (name: string) => join(main, ".claude", "worktrees", name)
    if (state) {
      mkdirSync(join(ops, "tick"), { recursive: true })
      writeFileSync(join(ops, "tick", "nightly-clean.json"), JSON.stringify(state(wt)))
    }
    const porcelain = [
      `worktree ${main}\nHEAD a\nbranch refs/heads/main`,
      `worktree ${wt("pg-1")}\nHEAD b\nbranch refs/heads/PG-1-a`,
      `worktree ${wt("pg-2")}\nHEAD c\nbranch refs/heads/PG-2-b`,
      `worktree ${wt("pg-3")}\nHEAD d\nbranch refs/heads/PG-3-c`,
    ].join("\n\n")
    const all: Answers = {
      "docker ps": "playground-gone-db\texited\t10B\nplayground-dashboard-db\trunning\t10B",
      "docker system df": JSON.stringify({ Volumes: [] }),
      "ask new": ID,
      "branch --merged": "PG-9-done",
      "for-each-ref refs/heads": "main m\nPG-9-done h9",
      "for-each-ref refs/remotes/origin": "HEAD x\nPG-8-gone r8",
      "worktree list": porcelain,
      ...outputs,
    }
    const { inputs, run, runs } = fakeRun(all)
    const ctx: Context = {
      now: new Date("2026-11-05T03:00:00Z"),
      ops,
      repo: main,
      run,
      send: async () => true,
    }
    const cleanup: CleanupDeps = {
      containers: async () => [],
      devStop: async () => ({ ok: true, out: "" }),
      git: async (dir, args) => {
        if (args[0] === "rev-parse") return `${dir}/.git\n${main}/.git`
        if (args[0] === "symbolic-ref") return `PG-${dir.slice(-1)}`
        if (args[0] === "status") return dir.endsWith("pg-2") ? " M wip.ts" : ""
        if (args[0] === "rev-list") return args.includes("h1") ? "0" : "3"
        return ""
      },
      held: async (path) =>
        path.endsWith("pg-1")
          ? `${path} is held by k3m9px-worker, which the roster lists as working`
          : null,
      live,
      liveBranch: "live/dashboard",
      main,
      removeContainer: async () => true,
      rm: async () => ({ ok: true, out: "" }),
    }
    let free = 100 * 1024 ** 3
    const deps: NightDeps = {
      cleanup: async () => cleanup,
      free: () => (free += grow * 1024 ** 3),
      prs: async () =>
        prsOf({
          "PG-1-a": pr("MERGED"),
          "PG-2-b": pr("MERGED", "h1", 2),
          "PG-3-c": pr("OPEN"),
          "PG-8-gone": pr("MERGED", "r8"),
        }),
      turbo: join(root, "turbo"),
    }
    return { ctx, deps, inputs, ops, runs, wt }
  }

  test("a live session's worktree stays, a dirty one goes to the decision list, the gone worktree's container goes, and the log line is written", async () => {
    const { ctx, deps, inputs, ops, runs, wt } = night()
    await nightlyClean(deps)(ctx)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toStartWith("2026-11-05T03:00:00Z free 100.6 GB, now ")
    expect(log).toContain(`kept ${wt("pg-1")}: ${wt("pg-1")} is held by k3m9px-worker`)
    expect(log).toContain(`kept ${wt("pg-2")}: uncommitted work`)
    expect(log).not.toContain(wt("pg-3"))
    expect(log).toContain(`decision ${ID}: 1 targets`)
    expect(runs.map((r) => r.join(" "))).toContain("docker rm -fv playground-gone-db")
    expect(runs.map((r) => r.join(" "))).toContain(`git -C ${ctx.repo} branch -D PG-9-done`)
    expect(runs.map((r) => r.join(" "))).toContain(
      `git -C ${ctx.repo} push -q origin --delete PG-8-gone`,
    )
    expect(log).toContain("branches: deleted 1 local, 1 remote; 0 to decide")
    expect(runs.map((r) => r.join(" "))).not.toContain("docker rm -fv playground-dashboard-db")
    const [decision, update] = inputs.map((i) => JSON.parse(i))
    expect(decision.preview.what).toBe(`- worktree \`${wt("pg-2")}\``)
    expect(decision.preview.why).toEndWith(
      "\n\n- worktree `pg-2`: [#2](https://github.com/acme/app/pull/2)",
    )
    expect(update).toMatchObject({
      kind: "update",
      preview: { outcome: "finding", text: expect.stringContaining("](/dashboard/system)") },
    })
    expect(JSON.parse(readFileSync(join(ops, "tick", "nightly-clean.json"), "utf8"))).toEqual({
      at: "2026-11-05T03:00:00.000Z",
      decision: { id: ID, targets: [{ kind: "worktree", name: wt("pg-2") }] },
    })
  })

  test("a night that frees under 1 GB posts no update", async () => {
    const { ctx, deps, inputs } = night({}, undefined, 0.01)
    await nightlyClean(deps)(ctx)
    expect(inputs.map((i) => JSON.parse(i).kind)).toEqual(["decision"])
  })

  test("last night's open decision is settled into the new one", async () => {
    const { ctx, deps, runs } = night({ "ask get": JSON.stringify({ status: "open" }) }, () => ({
      decision: { id: OLD, targets: [] },
    }))
    await nightlyClean(deps)(ctx)
    expect(runs.map((r) => r.slice(5).join(" "))).toContain(
      `ask settle ${OLD} --note Carried into the next night's decision, ${ID}`,
    )
  })

  test("last night's approved decision is carried out and acked; a denied one's targets are not asked again", async () => {
    const approved = night({ "ask get": JSON.stringify({ status: "approved" }) }, (wt) => ({
      decision: {
        id: OLD,
        targets: [
          { kind: "branch", name: "PG-7-old" },
          { kind: "container", name: "playground-x-db" },
          { kind: "volume", name: "big-unused" },
          { kind: "worktree", name: wt("pg-2") },
        ],
      },
    }))
    await nightlyClean(approved.deps)(approved.ctx)
    const ran = approved.runs.map((r) => r.join(" "))
    const repo = approved.ctx.repo
    expect(ran).toContain(`git -C ${repo} branch -D PG-7-old`)
    expect(ran).toContain("docker rm -fv playground-x-db")
    expect(ran).toContain("docker volume rm big-unused")
    expect(ran).toContain(
      `bun --no-env-file ${join(repo, "packages", "scripts", "src", "playground", "cli.ts")} rm --worktree ${approved.wt("pg-2")} --discard --decision ${OLD} --reason nightly-clean, approved`,
    )
    expect(ran.some((r) => r.includes(`ask ack ${OLD} --no-link`))).toBe(true)
    const denied = night({ "ask get": JSON.stringify({ status: "denied" }) }, (wt) => ({
      decision: { id: OLD, targets: [{ kind: "worktree", name: wt("pg-2") }] },
    }))
    await nightlyClean(denied.deps)(denied.ctx)
    const asked = denied.runs.map((r) => r.join(" "))
    expect(asked).toContain(`bun run --silent --cwd ${denied.ctx.repo} ask get ${OLD} --ack`)
    expect(denied.inputs.some((i) => JSON.parse(i).kind === "decision")).toBe(false)
    const kept = JSON.parse(readFileSync(join(denied.ops, "tick", "nightly-clean.json"), "utf8"))
    expect(kept.denied).toEqual([`worktree ${denied.wt("pg-2")}`])
    expect(kept.decision).toBeUndefined()
  })

  test("a dismissed decision is closed, and its targets still standing are asked again", async () => {
    const { ctx, deps, inputs, ops, runs, wt } = night(
      { "ask get": JSON.stringify({ status: "cleared" }) },
      (wt) => ({ decision: { id: OLD, targets: [{ kind: "worktree", name: wt("pg-2") }] } }),
    )
    await nightlyClean(deps)(ctx)
    expect(runs.map((r) => r.join(" "))).toContain(
      `bun run --silent --cwd ${ctx.repo} ask get ${OLD} --ack`,
    )
    const decision = inputs.map((i) => JSON.parse(i)).find((i) => i.kind === "decision")
    expect(decision.preview.what).toBe(`- worktree \`${wt("pg-2")}\``)
    const kept = JSON.parse(readFileSync(join(ops, "tick", "nightly-clean.json"), "utf8"))
    expect(kept.denied).toBeUndefined()
  })
})
