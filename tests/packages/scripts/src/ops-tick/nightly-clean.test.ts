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
  trashIdOf,
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
        "kept /w: /w's HEAD holds work not landed on origin/canary (fetch origin canary if it merged since): playground rm --worktree /w --discard removes it anyway, which a session runs as it is once the worktree's PR has merged or closed, else with --decision <id> once an Inbox delete decision naming it is approved",
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
    archive: ["PG-3-ahead", "scratch"],
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

test("the trash id reads from playground rm's own line alone, and it is the one --restore takes", () => {
  const out =
    "Moved to the trash as 20261108T030000Z-shell/1 (3 files); playground rm --restore 20261108T030000Z-shell/1 brings it back"
  expect(trashIdOf(out)).toBe("20261108T030000Z-shell/1")
  expect(trashIdOf("kept /w: held by a session")).toBeUndefined()
  expect(trashIdOf("11111111-2222-3333-4444-555555555555")).toBeUndefined()
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

test("the decision names each container or volume whole, and holds no more than fits", () => {
  const { item, targets } = decisionOf("ops", [
    { kind: "container", name: "someone-else" },
    { kind: "volume", name: "big-unused" },
  ])
  expect(targets).toEqual([
    { kind: "container", name: "someone-else" },
    { kind: "volume", name: "big-unused" },
  ])
  expect(JSON.stringify(item)).toContain("container `someone-else`")
  expect(item).toMatchObject({ kind: "decision", preview: { type: "delete" } })
  const many = Array.from({ length: 200 }, (_, i) => ({
    kind: "volume" as const,
    name: `a-long-volume-name-${i}`,
  }))
  const capped = decisionOf("ops", many)
  expect(capped.targets.length).toBeLessThan(200)
  expect((capped.item as { preview: { what: string } }).preview.what.length).toBeLessThan(4000)
})

describe("one night's run against a fixture data folder", () => {
  const ID = "11111111-2222-3333-4444-555555555555"
  const OLD = "99999999-2222-3333-4444-555555555555"
  // A data folder with ops and a roster, a main checkout with worktrees pg-1 (merged, held by a live session), pg-2 (merged, dirty) and pg-3 (open), each command's output by a word of its argv.
  const night = (
    outputs: Answers = {},
    state?: (wt: (name: string) => string) => object,
    grow = 0.6,
    finished: CleanupDeps["finished"] = async () => false,
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
      // playground rm's trash move, whose printed id playground rm --restore takes
      "--reason nightly-clean":
        "Moved to the trash as 20261108T030000Z-shell/1 (3 files); playground rm --restore 20261108T030000Z-shell/1 brings it back",
      ...outputs,
    }
    const { inputs, run, runs } = fakeRun(all)
    const sent: { text: string; to: string }[] = []
    const ctx: Context = {
      now: new Date("2026-11-05T03:00:00Z"),
      ops,
      repo: main,
      run,
      send: async (to, text) => {
        sent.push({ text, to })
        return true
      },
    }
    const cleanup: CleanupDeps = {
      containers: async () => [],
      devStop: async () => ({ ok: true, out: "" }),
      finished,
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
      now: () => Date.now(),
      prs: async () => ({
        ...prsOf({
          "PG-1-a": pr("MERGED"),
          "PG-2-b": pr("MERGED", "h1", 2),
          "PG-3-c": pr("OPEN"),
          "PG-8-gone": pr("MERGED", "r8"),
        }),
        repo: "https://github.com/acme/app",
      }),
      sleep: async () => {},
      turbo: join(root, "turbo"),
    }
    return { ctx, deps, inputs, ops, runs, sent, wt }
  }

  // docker ps with a container over 1 GB that no rule takes, so the delete decision has a target
  const bigContainer = (): Record<string, string> => ({
    "docker ps":
      "playground-gone-db\texited\t10B\nplayground-dashboard-db\trunning\t10B\nsomeone-else\texited\t2GB",
  })

  test("a live session's worktree stays, the gone worktree's container goes, and the log line is written", async () => {
    const { ctx, deps, inputs, ops, runs, wt } = night()
    await nightlyClean(deps)(ctx)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toStartWith("2026-11-05T03:00:00Z free 100.6 GB, now ")
    expect(log).toContain(`kept ${wt("pg-1")}: ${wt("pg-1")} is held by k3m9px-worker`)
    expect(log).not.toContain(wt("pg-3"))
    expect(runs.map((r) => r.join(" "))).toContain("docker rm -fv playground-gone-db")
    expect(runs.map((r) => r.join(" "))).toContain(`git -C ${ctx.repo} branch -D PG-9-done`)
    expect(runs.map((r) => r.join(" "))).toContain(
      `git -C ${ctx.repo} push -q origin --delete PG-8-gone`,
    )
    expect(log).toContain("branches: deleted 1 local, 1 remote; none to archive")
    expect(runs.map((r) => r.join(" "))).not.toContain("docker rm -fv playground-dashboard-db")
    expect(inputs.map((i) => JSON.parse(i).kind)).toEqual(["update"])
    expect(JSON.parse(readFileSync(join(ops, "tick", "nightly-clean.json"), "utf8"))).toEqual({
      at: "2026-11-05T03:00:00.000Z",
    })
  })

  // #1515
  test("a stale unmerged worktree goes through playground rm with no decision, and its trash id is logged", async () => {
    const { ctx, deps, inputs, ops, runs, sent, wt } = night()
    await nightlyClean(deps)(ctx)
    const ran = runs.map((r) => r.join(" "))
    expect(ran).toContain(
      `bun --no-env-file ${join(ctx.repo, "packages", "scripts", "src", "playground", "cli.ts")} rm --worktree ${wt("pg-2")} --discard --reason nightly-clean`,
    )
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toContain(
      `trashed ${wt("pg-2")} as 20261108T030000Z-shell/1, restorable with playground rm --restore 20261108T030000Z-shell/1`,
    )
    expect(log).not.toContain(`decision ${ID}`)
    expect(inputs.map((i) => JSON.parse(i).kind)).toEqual(["update"])
    const line = sent.find((s) => s.to === "ops")
    expect(line?.text).toContain(
      `worktree ${wt("pg-2")} as trash 20261108T030000Z-shell/1 (playground rm --restore 20261108T030000Z-shell/1)`,
    )
  })

  // issue 1554: rm refuses the 4th trash move in a minute ("quarantined 3 paths in the last minute, the most one session may"), and the beat counted that refusal as done, so 7 of 10 stale worktrees stayed behind with no line naming them for the next run; the beat paces under the cap, waiting out the minute on the injected sleep, under a total-wait bound, and names anything the bound leaves
  test("the beat finishes its stale worktrees under rm's 3-a-minute cap", async () => {
    const root = scratch()
    const data = join(root, "data")
    const ops = join(data, "ops")
    const main = join(root, "main")
    const names = Array.from({ length: 10 }, (_, i) => `pg-${i + 1}`)
    for (const name of names)
      mkdirSync(join(main, ".claude", "worktrees", name), { recursive: true })
    mkdirSync(join(ops, "log"), { recursive: true })
    writeFileSync(join(data, "roster.json"), JSON.stringify({ agents: [] }))
    const wt = (name: string) => join(main, ".claude", "worktrees", name)
    const porcelain = [
      `worktree ${main}\nHEAD a\nbranch refs/heads/main`,
      ...names.map(
        (name, i) =>
          `worktree ${wt(name)}\nHEAD ${"abcdefghij"[i]}\nbranch refs/heads/PG-${i + 1}-x`,
      ),
    ].join("\n\n")
    const answers: Answers = {
      "docker ps": "playground-dashboard-db\trunning\t10B",
      "docker system df": JSON.stringify({ Volumes: [] }),
      "for-each-ref refs/heads": [...names.map((_, i) => `PG-${i + 1}-x h${i + 1}`), "main m"].join(
        "\n",
      ),
      "for-each-ref refs/remotes/origin": "HEAD x",
      "branch --merged": names.map((_, i) => `PG-${i + 1}-x`).join("\n"),
      "worktree list": porcelain,
      "--reason nightly-clean":
        "Moved to the trash as 20261108T030000Z-shell/1 (3 files); playground rm --restore 20261108T030000Z-shell/1 brings it back",
    }
    const base = fakeRun(answers)
    const accepted: number[] = []
    let refusals = 0
    let t = 0
    const waits: number[] = []
    const run: Context["run"] = async (argv, timeoutMs, stdin) => {
      if (argv.join(" ").includes("rm --worktree")) {
        if (accepted.filter((at) => t - at < 60_000).length >= 3) {
          refusals++
          return {
            code: 1,
            out: "nightly-clean quarantined 3 paths in the last minute, the most one session may\n",
          }
        }
        accepted.push(t)
      }
      return base.run(argv, timeoutMs, stdin)
    }
    const sleep = async (ms: number) => {
      waits.push(ms)
      t += ms
    }
    const sent: { text: string; to: string }[] = []
    const ctx: Context = {
      now: new Date("2026-11-05T03:00:00Z"),
      ops,
      repo: main,
      run,
      send: async (to, text) => {
        sent.push({ text, to })
        return true
      },
    }
    const deps: NightDeps = {
      cleanup: async () => ({
        containers: async () => [],
        devStop: async () => ({ ok: true, out: "" }),
        finished: async () => false,
        git: async (dir, args) =>
          args[0] === "rev-parse"
            ? `${dir}/.git\n${main}/.git`
            : args[0] === "status"
              ? " M wip.ts"
              : "",
        held: async () => null,
        live,
        liveBranch: "live/dashboard",
        main,
        removeContainer: async () => true,
        rm: async () => ({ ok: true, out: "" }),
      }),
      free: () => 100 * 1024 ** 3,
      now: () => t,
      prs: async () => ({
        ...prsOf(
          Object.fromEntries(
            names.map((_, i) => [`PG-${i + 1}-x`, pr("MERGED", `h${i + 1}`, i + 1)]),
          ),
        ),
        repo: "https://github.com/acme/app",
      }),
      sleep,
      turbo: join(root, "turbo"),
    }
    await nightlyClean(deps)(ctx)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log.match(/trashed /g)).toHaveLength(10)
    expect(refusals).toBe(0)
    expect(waits).toEqual([60_000, 60_000, 60_000])
    expect(log).not.toContain("its trash move failed")
    expect(log).not.toMatch(/left .*? for the next run/)
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(600_000)
  })

  // the bound: with rm refusing forever, the beat still ends inside its 10-minute wait budget, and each worktree it leaves is named for the next run
  test("the beat ends within its wait bound when rm refuses every move, naming each one left", async () => {
    const root = scratch()
    const data = join(root, "data")
    const ops = join(data, "ops")
    const main = join(root, "main")
    const names = Array.from({ length: 10 }, (_, i) => `pg-${i + 1}`)
    for (const name of names)
      mkdirSync(join(main, ".claude", "worktrees", name), { recursive: true })
    mkdirSync(join(ops, "log"), { recursive: true })
    writeFileSync(join(data, "roster.json"), JSON.stringify({ agents: [] }))
    const wt = (name: string) => join(main, ".claude", "worktrees", name)
    const porcelain = [
      `worktree ${main}\nHEAD a\nbranch refs/heads/main`,
      ...names.map(
        (name, i) =>
          `worktree ${wt(name)}\nHEAD ${"abcdefghij"[i]}\nbranch refs/heads/PG-${i + 1}-x`,
      ),
    ].join("\n\n")
    const answers: Answers = {
      "docker ps": "playground-dashboard-db\trunning\t10B",
      "docker system df": JSON.stringify({ Volumes: [] }),
      "for-each-ref refs/heads": [...names.map((_, i) => `PG-${i + 1}-x h${i + 1}`), "main m"].join(
        "\n",
      ),
      "for-each-ref refs/remotes/origin": "HEAD x",
      "branch --merged": names.map((_, i) => `PG-${i + 1}-x`).join("\n"),
      "worktree list": porcelain,
      "--reason nightly-clean": {
        code: 1,
        err: "nightly-clean quarantined 3 paths in the last minute, the most one session may\n",
      },
    }
    const { run } = fakeRun(answers)
    const waits: number[] = []
    const sleep = async (ms: number) => {
      waits.push(ms)
    }
    const ctx: Context = {
      now: new Date("2026-11-05T03:00:00Z"),
      ops,
      repo: main,
      run,
      send: async () => true,
    }
    const deps: NightDeps = {
      cleanup: async () => ({
        containers: async () => [],
        devStop: async () => ({ ok: true, out: "" }),
        finished: async () => false,
        git: async (dir, args) =>
          args[0] === "rev-parse"
            ? `${dir}/.git\n${main}/.git`
            : args[0] === "status"
              ? " M wip.ts"
              : "",
        held: async () => null,
        live,
        liveBranch: "live/dashboard",
        main,
        removeContainer: async () => true,
        rm: async () => ({ ok: true, out: "" }),
      }),
      free: () => 100 * 1024 ** 3,
      now: () => 0,
      prs: async () => ({
        ...prsOf(
          Object.fromEntries(
            names.map((_, i) => [`PG-${i + 1}-x`, pr("MERGED", `h${i + 1}`, i + 1)]),
          ),
        ),
        repo: "https://github.com/acme/app",
      }),
      sleep,
      turbo: join(root, "turbo"),
    }
    await nightlyClean(deps)(ctx)
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(600_000)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log.match(/left .*? for the next run/g)).toHaveLength(10)
    expect(log).not.toContain("trashed ")
  })

  // #1515
  test("an unmerged branch on origin is archived as a tag before any delete, then deleted on origin and locally, and no ask new names a decision", async () => {
    const { ctx, deps, inputs, ops, runs, sent } = night({
      "for-each-ref refs/heads": "main m\nPG-9-done h9\nscratch s",
      "for-each-ref refs/remotes/origin": "HEAD x\nPG-8-gone r8\nscratch s",
    })
    await nightlyClean(deps)(ctx)
    const ran = runs.map((r) => r.join(" "))
    const tag = ran.findIndex((r) => r.includes("git/refs") && r.includes("archive/scratch"))
    const push = ran.findIndex((r) => r.includes("--delete scratch"))
    const local = ran.findIndex((r) => r.endsWith("branch -D scratch"))
    expect(tag).toBeGreaterThanOrEqual(0)
    expect(push).toBeGreaterThan(tag)
    expect(local).toBeGreaterThan(tag)
    expect(ran[tag]).toContain("repos/acme/app/git/refs")
    expect(ran[tag]).toContain("ref=refs/tags/archive/scratch")
    expect(ran[tag]).toContain("-f sha=s")
    expect(inputs.map((i) => JSON.parse(i).kind)).not.toContain("decision")
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toContain("archived scratch as archive/scratch at s, deleted on origin and locally")
    const line = sent.find((s) => s.to === "ops")
    expect(line?.text).toContain("branch scratch as tag archive/scratch at s")
  })

  // #1515
  test("a tag that fails keeps the branch, on origin and locally, and names it in the log", async () => {
    const { ctx, deps, ops, runs, sent } = night({
      "for-each-ref refs/heads": "main m\nPG-9-done h9\nscratch s",
      "for-each-ref refs/remotes/origin": "HEAD x\nPG-8-gone r8\nscratch s",
      "git/refs": { code: 1, err: "gh: Reference already exists" },
    })
    await nightlyClean(deps)(ctx)
    const ran = runs.map((r) => r.join(" "))
    expect(ran.some((r) => r.includes("archive/scratch"))).toBe(true)
    expect(ran.some((r) => r.includes("--delete scratch"))).toBe(false)
    expect(ran.some((r) => r.endsWith("branch -D scratch"))).toBe(false)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toContain(
      "kept scratch: its archive/scratch tag failed: gh: Reference already exists",
    )
    const line = sent.find((s) => s.to === "ops")
    expect(line?.text).toContain("branch scratch kept: its archive/scratch tag failed")
  })

  // #1515
  test("a branch whose origin head is not the local head the tag would hold stays whole, named with both shas", async () => {
    const { ctx, deps, ops, runs, sent } = night({
      "for-each-ref refs/heads": "main m\nPG-9-done h9\nscratch s",
      "for-each-ref refs/remotes/origin": "HEAD x\nPG-8-gone r8\nscratch s-newer",
    })
    await nightlyClean(deps)(ctx)
    const ran = runs.map((r) => r.join(" "))
    expect(ran.some((r) => r.includes("archive/scratch"))).toBe(false)
    expect(ran.some((r) => r.includes("--delete scratch"))).toBe(false)
    expect(ran.some((r) => r.endsWith("branch -D scratch"))).toBe(false)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toContain("kept scratch: origin's head is s-newer, not the local head s")
    const line = sent.find((s) => s.to === "ops")
    expect(line?.text).toContain("branch scratch kept: origin's head is s-newer")
  })

  // #1515
  test("a tag already at the tagged head holds it, so the deletes go on", async () => {
    const { ctx, deps, inputs, ops, runs } = night({
      "for-each-ref refs/heads": "main m\nPG-9-done h9\nscratch s",
      "for-each-ref refs/remotes/origin": "HEAD x\nPG-8-gone r8\nscratch s",
      "git/refs": { code: 1, err: "gh: Reference already exists" },
      "ls-remote": "s\trefs/tags/archive/scratch",
    })
    await nightlyClean(deps)(ctx)
    const ran = runs.map((r) => r.join(" "))
    expect(ran.some((r) => r.includes("--delete scratch"))).toBe(true)
    expect(ran.some((r) => r.endsWith("branch -D scratch"))).toBe(true)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toContain("archived scratch as archive/scratch at s, deleted on origin and locally")
    expect(inputs.map((i) => JSON.parse(i).kind)).not.toContain("decision")
  })

  // #1515
  test("a failed origin delete keeps the branch for the next night's retry, its tag holding the head", async () => {
    const { ctx, deps, ops, runs, sent } = night({
      "for-each-ref refs/heads": "main m\nPG-9-done h9\nscratch s",
      "for-each-ref refs/remotes/origin": "HEAD x\nPG-8-gone r8\nscratch s",
      "--delete scratch": { code: 1, err: "remote rejected" },
    })
    await nightlyClean(deps)(ctx)
    const ran = runs.map((r) => r.join(" "))
    expect(ran.some((r) => r.includes("archive/scratch"))).toBe(true)
    expect(ran.some((r) => r.endsWith("branch -D scratch"))).toBe(false)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toContain(
      "kept scratch: its origin delete failed, its archive/scratch tag holds the head",
    )
    const line = sent.find((s) => s.to === "ops")
    expect(line?.text).toContain("branch scratch kept: its origin delete failed")
  })

  // #1515
  test("an unmerged branch with no origin copy is tagged and deleted locally alone", async () => {
    const { ctx, deps, inputs, ops, runs, sent } = night({
      "for-each-ref refs/heads": "main m\nPG-9-done h9\nscratch s",
    })
    await nightlyClean(deps)(ctx)
    const ran = runs.map((r) => r.join(" "))
    expect(ran.some((r) => r.includes("--delete scratch"))).toBe(false)
    expect(ran.some((r) => r.endsWith("branch -D scratch"))).toBe(true)
    expect(
      ran.some((r) => r.includes("ref=refs/tags/archive/scratch") && r.includes("-f sha=s")),
    ).toBe(true)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toContain("archived scratch as archive/scratch at s, deleted locally")
    const line = sent.find((s) => s.to === "ops")
    expect(line?.text).toContain("branch scratch as tag archive/scratch at s")
    expect(inputs.map((i) => JSON.parse(i).kind)).not.toContain("decision")
  })

  // #1515
  test("a failed trash move keeps the worktree, named in the log and the outbox line", async () => {
    const { ctx, deps, inputs, ops, runs, sent, wt } = night({
      "--reason nightly-clean": { code: 1, err: "playground: the roster cannot be read" },
    })
    await nightlyClean(deps)(ctx)
    const ran = runs.map((r) => r.join(" "))
    expect(ran.some((r) => r.includes(`rm --worktree ${wt("pg-2")}`))).toBe(true)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toContain(
      `kept ${wt("pg-2")}: its trash move failed: playground: the roster cannot be read`,
    )
    expect(log).not.toContain(`trashed ${wt("pg-2")}`)
    expect(inputs.map((i) => JSON.parse(i).kind)).toEqual(["update"])
    const line = sent.find((s) => s.to === "ops")
    expect(line?.text).toContain(`worktree ${wt("pg-2")} kept: its trash move failed`)
    expect(line?.text).toContain("removed 0, kept 1")
  })

  // PG-1165
  test("a dirty worktree whose PR merged goes through --discard, so no decision names it", async () => {
    const asked: (string | undefined)[] = []
    const { ctx, deps, inputs, ops, wt } = night({}, undefined, 0.6, async (path, pr) => {
      asked.push(`${path} ${pr}`)
      return true
    })
    await nightlyClean(deps)(ctx)
    const log = readFileSync(join(ops, "log", "nightly-clean.log"), "utf8")
    expect(log).toContain(`removed ${wt("pg-2")}`)
    expect(asked).toEqual([`${wt("pg-2")} https://github.com/acme/app/pull/2`])
    expect(inputs.map((i) => JSON.parse(i).kind)).toEqual(["update"])
  })

  test("a night that frees under 1 GB posts no update", async () => {
    const { ctx, deps, inputs } = night(bigContainer(), undefined, 0.01)
    await nightlyClean(deps)(ctx)
    expect(inputs.map((i) => JSON.parse(i).kind)).toEqual(["decision"])
  })

  test("last night's open decision is settled into the new one", async () => {
    const { ctx, deps, runs } = night(
      { "ask get": JSON.stringify({ status: "open" }), ...bigContainer() },
      () => ({ decision: { id: OLD, targets: [] } }),
    )
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
    const denied = night(
      { "ask get": JSON.stringify({ status: "denied" }), ...bigContainer() },
      () => ({ decision: { id: OLD, targets: [{ kind: "container", name: "someone-else" }] } }),
    )
    await nightlyClean(denied.deps)(denied.ctx)
    const asked = denied.runs.map((r) => r.join(" "))
    expect(asked).toContain(`bun run --silent --cwd ${denied.ctx.repo} ask get ${OLD} --ack`)
    expect(denied.inputs.some((i) => JSON.parse(i).kind === "decision")).toBe(false)
    const kept = JSON.parse(readFileSync(join(denied.ops, "tick", "nightly-clean.json"), "utf8"))
    expect(kept.denied).toEqual(["container someone-else"])
    expect(kept.decision).toBeUndefined()
  })

  test("a dismissed decision is closed, and its targets still standing are asked again", async () => {
    const { ctx, deps, inputs, ops, runs } = night(
      { "ask get": JSON.stringify({ status: "cleared" }), ...bigContainer() },
      () => ({ decision: { id: OLD, targets: [{ kind: "container", name: "someone-else" }] } }),
    )
    await nightlyClean(deps)(ctx)
    expect(runs.map((r) => r.join(" "))).toContain(
      `bun run --silent --cwd ${ctx.repo} ask get ${OLD} --ack`,
    )
    const decision = inputs.map((i) => JSON.parse(i)).find((i) => i.kind === "decision")
    expect(decision.preview.what).toBe("- container `someone-else`")
    const kept = JSON.parse(readFileSync(join(ops, "tick", "nightly-clean.json"), "utf8"))
    expect(kept.denied).toBeUndefined()
  })
})
