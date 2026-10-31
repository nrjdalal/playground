import { afterAll, describe, expect, test } from "bun:test"
import {
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
  boxRoute,
  chaseStale,
  check,
  type Context,
  forecast,
  IDLE_DB_AFTER,
  IDLE_DB_GAP,
  idleDbs,
  lateReviewers,
  maybePrune,
  opsDown,
  pass,
  prlessBranches,
  type Run,
} from "../../../../../packages/scripts/src/ops-sweep/sweep"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const DEAD = Bun.spawnSync(["true"]).pid
const NOW = Date.parse("2026-10-20T12:00:00Z")

type Call = { argv: string[]; cwd?: string; env?: Record<string, string | undefined> }

const PS = {
  out: "bash /x/scripts/ops/dashboard/supervisor.sh\n",
}

// A scratch config folder and a fake run: each argv is answered by the first reply whose key it starts with (ps shows the dashboard's supervisor unless told otherwise), else exit 0 and nothing printed.
const setup = (given: Record<string, { code?: number; out?: string }> = {}) => {
  const replies: Record<string, { code?: number; out?: string }> = { "ps -ax": PS, ...given }
  const cfg = realpathSync(mkdtempSync(join(tmpdir(), "ops-sweep-")))
  dirs.push(cfg)
  const data = join(cfg, "playground")
  const ops = join(data, "ops")
  mkdirSync(join(ops, "sweep"), { recursive: true })
  mkdirSync(join(cfg, "sessions"), { recursive: true })
  const calls: Call[] = []
  const run: Run = async (argv, options = {}) => {
    calls.push({ argv, cwd: options.cwd, env: options.env })
    const line = argv.join(" ")
    const key = Object.keys(replies).find((k) => line.startsWith(k))
    const reply = key === undefined ? {} : replies[key]!
    return { code: reply.code ?? 0, err: "", out: reply.out ?? "" }
  }
  const ctx: Context = {
    cfg,
    data,
    dashboard: "/dashboard",
    load: () => 1,
    main: "/main",
    now: () => NOW,
    ops,
    repo: "/repo",
    run,
  }
  return { calls, ctx, ops, sweep: join(ops, "sweep") }
}

const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value))
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"))
const session = (ctx: Context, name: string, pid: number, status = "busy") =>
  write(join(ctx.cfg, "sessions", `${name}.json`), { name, pid, status })
const roster = (ctx: Context, agents: Record<string, unknown>[]) =>
  write(join(ctx.data, "roster.json"), { agents })

const DOCKER_PS = "docker ps --filter name=^playground-"
const DASHBOARD_DB = "bun /repo/api/hono/src/bin/dashboard-db.ts"
const psql = (name: string) => `docker exec ${name} psql`

// idle-db.json as a pass that saw the containers left it, age seconds before NOW.
const idleState = (sweep: string, value: Record<string, number>, age = 0) => {
  const path = join(sweep, "idle-db.json")
  write(path, value)
  utimesSync(path, NOW / 1000 - age, NOW / 1000 - age)
}

describe("idleDbs", () => {
  test("flags a container with no client for 2 hours, keeping when it was first seen idle", async () => {
    const { ctx, sweep } = setup({
      [DOCKER_PS]: { out: "playground-a-db\nplayground-b-db\n" },
      [DASHBOARD_DB]: { out: "playground-dispatcher-db\n" },
      [psql("playground-a-db")]: { out: "0\n" },
      [psql("playground-b-db")]: { out: "0\n" },
    })
    const first = NOW / 1000 - IDLE_DB_AFTER
    idleState(sweep, { "playground-a-db": first, "playground-gone-db": first })
    expect(await idleDbs(ctx)).toEqual(["idle-db:playground-a-db"])
    expect(read(join(sweep, "idle-db.json"))).toEqual({
      "playground-a-db": first,
      "playground-b-db": NOW / 1000,
    })
  })

  test("starts every clock again after a gap with no pass that saw the containers", async () => {
    const { ctx, sweep } = setup({
      [DOCKER_PS]: { out: "playground-a-db\n" },
      [DASHBOARD_DB]: { out: "playground-dispatcher-db\n" },
      [psql("playground-a-db")]: { out: "0\n" },
    })
    idleState(sweep, { "playground-a-db": NOW / 1000 - 3 * 3600 }, IDLE_DB_GAP + 1)
    expect(await idleDbs(ctx)).toEqual([])
    expect(read(join(sweep, "idle-db.json"))).toEqual({ "playground-a-db": NOW / 1000 })
  })

  test("drops a container with a client from the state", async () => {
    const { ctx, sweep } = setup({
      [DOCKER_PS]: { out: "playground-a-db\n" },
      [DASHBOARD_DB]: { out: "playground-dispatcher-db\n" },
      [psql("playground-a-db")]: { out: "2\n" },
    })
    idleState(sweep, { "playground-a-db": 0 })
    expect(await idleDbs(ctx)).toEqual([])
    expect(read(join(sweep, "idle-db.json"))).toEqual({})
  })

  test("never flags the dashboard database, found by POSTGRES_URL's port under any name", async () => {
    const { calls, ctx, sweep } = setup({
      [DOCKER_PS]: { out: "playground-dispatcher-db\nplayground-desk-db\n" },
      [DASHBOARD_DB]: { out: "playground-dispatcher-db\n" },
      [psql("playground-dispatcher-db")]: { out: "0\n" },
      [psql("playground-desk-db")]: { out: "0\n" },
    })
    idleState(sweep, { "playground-desk-db": 0, "playground-dispatcher-db": 0 })
    expect(await idleDbs(ctx)).toEqual(["idle-db:playground-desk-db"])
    expect(calls.some((c) => c.argv.join(" ").startsWith(psql("playground-dispatcher-db")))).toBe(
      false,
    )
    const lookup = calls.find((c) => c.argv.join(" ").startsWith(DASHBOARD_DB))!
    expect(lookup.cwd).toBe("/dashboard")
    expect(lookup.env && "POSTGRES_URL" in lookup.env).toBe(false)
  })

  test("skips the check with dashboard-db-unknown when the dashboard database cannot be found", async () => {
    const { calls, ctx, sweep } = setup({
      [DOCKER_PS]: { out: "playground-dispatcher-db\n" },
      [DASHBOARD_DB]: { code: 1 },
      [psql("playground-dispatcher-db")]: { out: "0\n" },
    })
    idleState(sweep, { "playground-dispatcher-db": 0 })
    expect(await idleDbs(ctx)).toEqual(["dashboard-db-unknown"])
    expect(calls.some((c) => c.argv[0] === "docker" && c.argv[1] === "exec")).toBe(false)
    expect(read(join(sweep, "idle-db.json"))).toEqual({ "playground-dispatcher-db": 0 })
  })
})

describe("check", () => {
  test("a parked runner never reads as down, an ended one neither, a working one does", async () => {
    const { ctx } = setup({ [DASHBOARD_DB]: { out: "playground-dispatcher-db\n" } })
    roster(ctx, [
      { name: "runner-parked", status: "parked" },
      { name: "runner-ended", status: "ended" },
      { name: "runner-gone", status: "working" },
      { name: "runner-waits", status: "working" },
      { name: "runner-busy", status: "working" },
    ])
    session(ctx, "runner-waits", process.pid, "waiting")
    session(ctx, "runner-busy", process.pid)
    session(ctx, "runner-gone", DEAD)
    expect((await check(ctx)).sort()).toEqual(["down:runner-gone", "waiting:runner-waits"])
  })

  test("probes: gone but not ended, over 15 minutes, unrecorded after 10", async () => {
    const { ctx, sweep } = setup({ [DASHBOARD_DB]: { out: "playground-dispatcher-db\n" } })
    roster(ctx, [
      { name: "probe-gone", status: "working" },
      { name: "probe-old", status: "working" },
    ])
    session(ctx, "probe-old", process.pid)
    session(ctx, "probe-stray", process.pid)
    const now = NOW / 1000
    write(join(sweep, "probe-first-seen.json"), {
      "probe-left": now - 3600,
      "probe-old": now - 16 * 60,
      "probe-stray": now - 11 * 60,
    })
    expect((await check(ctx)).sort()).toEqual([
      "probe-gone-unended:probe-gone",
      "probe-over-15m:probe-old",
      "probe-unrecorded:probe-stray",
    ])
    expect(read(join(sweep, "probe-first-seen.json"))).toEqual({
      "probe-old": now - 16 * 60,
      "probe-stray": now - 11 * 60,
    })
  })

  test("a runner and a probe by their kind: an <id>-<kind> name, or a roster kind over any name", async () => {
    const { ctx, sweep } = setup({ [DASHBOARD_DB]: { out: "playground-dispatcher-db\n" } })
    roster(ctx, [
      { name: "k3m9px-runner", status: "working" },
      { kind: "runner", name: "plain-job", status: "working" },
      { name: "b7k2mq-probe", status: "working" },
      { kind: "probe", name: "plain-test", status: "working" },
    ])
    session(ctx, "x7mh4d-probe", process.pid)
    write(join(sweep, "probe-first-seen.json"), { "x7mh4d-probe": NOW / 1000 - 16 * 60 })
    expect((await check(ctx)).sort()).toEqual([
      "down:k3m9px-runner",
      "down:plain-job",
      "probe-gone-unended:b7k2mq-probe",
      "probe-gone-unended:plain-test",
      "probe-over-15m:x7mh4d-probe",
      "probe-unrecorded:x7mh4d-probe",
    ])
  })

  test("an answered ask on ops's entry, read through bun run ask", async () => {
    const { calls, ctx } = setup({
      "bun run --silent --cwd /dashboard ask get #i7": { out: 'note\n{"status":"answered"}' },
      "bun run --silent --cwd /dashboard ask get #i8": { out: '{"status":"open"}' },
      "bun run --silent --cwd /dashboard ask get x9": { code: 1 },
      [DASHBOARD_DB]: { out: "playground-dispatcher-db\n" },
    })
    roster(ctx, [{ asks: "7 8 x9", name: "ops", status: "working" }])
    expect((await check(ctx)).sort()).toEqual(["ask-answered:7", "ask-unreadable:x9"])
    expect(calls.some((c) => c.argv.at(-1) === "x9")).toBe(true)
  })

  test("an answered ask on an <id>-ops entry, which holds ops' seat by its name (PG-1644)", async () => {
    const { ctx } = setup({
      "bun run --silent --cwd /dashboard ask get #i7": { out: '{"status":"answered"}' },
      [DASHBOARD_DB]: { out: "playground-dispatcher-db\n" },
    })
    roster(ctx, [
      { asks: "7", name: "k3v9q2-ops", status: "working" },
      { asks: "7", name: "x7mh4d-worker", status: "working" },
    ])
    expect(await check(ctx)).toEqual(["ask-answered:7"])
  })

  test("an unreadable roster is the one finding", async () => {
    const { ctx } = setup()
    expect(await check(ctx)).toEqual(["roster-unreadable:ENOENT"])
  })
})

describe("chaseStale", () => {
  const STALE = "bun run --silent --cwd /dashboard ask stale --minutes 15"
  const lines = [
    "#i3 abc from builder: go, answered 20m ago",
    "#i4 def from worker-gone: answer, answered 40m ago",
  ].join("\n")

  test("reminds a live poster once every 30 minutes and names a poster that is down", async () => {
    const { calls, ctx, sweep } = setup({ [STALE]: { out: lines } })
    const live = new Map([["builder", "busy"]])
    expect(await chaseStale(ctx, live)).toEqual(["stale-poster-down:#i4:worker-gone"])
    const sent = calls.filter((c) => c.argv[1] === "/repo/scripts/ops/notify.sh")
    expect(sent).toHaveLength(1)
    expect(sent[0]!.argv.slice(2, 3)).toEqual(["sweep"])
    expect(sent[0]!.argv[3]).toStartWith("Inbox #i3 (abc): the owner answered 20m ago")
    expect(sent[0]!.env?.NOTIFY_TO).toBe("builder")
    expect(read(join(sweep, "stale-told.json"))).toEqual({ "#i3": NOW / 1000, "#i4": 0 })
    await chaseStale(ctx, live)
    expect(calls.filter((c) => c.argv[1] === "/repo/scripts/ops/notify.sh")).toHaveLength(1)
  })

  test("reports an unclosed answer once, stays quiet on it for 4 hours, then reports it again (#129)", async () => {
    const { calls, ctx } = setup({ [STALE]: { out: lines } })
    const live = new Map([["builder", "busy"]])
    const told = () => calls.filter((c) => c.argv[1] === "/repo/scripts/ops/notify.sh").length
    const at = (minutes: number) => {
      ctx.now = () => NOW + minutes * 60_000
      return chaseStale(ctx, live)
    }
    await at(0)
    await at(5)
    await at(60)
    await at(239)
    expect(told()).toBe(1)
    await at(240)
    expect(told()).toBe(2)
  })

  test("a failed read is stale-unreadable", async () => {
    const { ctx } = setup({ [STALE]: { code: 1 } })
    expect(await chaseStale(ctx, new Map())).toEqual(["stale-unreadable"])
  })
})

describe("boxRoute", () => {
  const route = async (reply: { code?: number; out?: string }) => {
    const { ctx, ops } = setup()
    const argvs: string[][] = []
    ctx.run = async (argv) => {
      argvs.push(argv)
      return { code: reply.code ?? 0, err: "", out: reply.out ?? "" }
    }
    const found = await boxRoute(ctx)
    expect(argvs).toEqual([[join(ops, "run-slot.sh"), "box-off"]])
    return found
  }

  test("names each failing precondition run-slot.sh box-off prints in one finding, and none when the route can fire (#129)", async () => {
    expect(await route({ out: "no-ci-sh\nno-ssh-key\n" })).toEqual([
      "box-route-off:no-ci-sh,no-ssh-key",
    ])
    expect(await route({ out: "slot-off\n" })).toEqual(["box-route-off:slot-off"])
    expect(await route({ out: "" })).toEqual([])
    expect(await route({ code: 2 })).toEqual(["box-route-unreadable"])
  })
})

describe("lateReviewers", () => {
  const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()
  // one PR as GitHub's GraphQL answers it: open, its head's checks in the rollup state given, the last finishing `ready` minutes ago, and the comments given
  const answer = (ready: number, comments: string[] = [], state = "SUCCESS") =>
    JSON.stringify({
      data: {
        repository: {
          p145: {
            comments: { nodes: comments.map((body) => ({ body })) },
            commits: {
              nodes: [
                {
                  commit: {
                    statusCheckRollup: {
                      contexts: {
                        nodes: [
                          { completedAt: minutesAgo(ready + 5) },
                          { completedAt: minutesAgo(ready) },
                        ],
                      },
                      state,
                    },
                  },
                },
              ],
            },
            headRefOid: "b9861d6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            state: "OPEN",
          },
        },
      },
    })
  const late = async (
    reply: string,
    live: [string, string][] = [],
    reviewer = true,
    status = "working",
  ) => {
    const { ctx } = setup()
    const told: Call[] = []
    ctx.factory = async () => "acme/app"
    ctx.run = async (argv, options = {}) => {
      if (argv[1] === "/repo/scripts/ops/notify.sh") told.push({ argv, env: options.env })
      return { code: 0, err: "", out: argv[0] === "gh" ? reply : "" }
    }
    const agents = [
      { kind: "builder", name: "builder" },
      {
        kind: "worker",
        name: "abcdef-worker",
        pr: "https://github.com/acme/app/pull/145",
        status,
      },
      ...(reviewer ? [{ kind: "reviewer", name: "ghjkmn-reviewer", pr: "145", status }] : []),
    ]
    roster(ctx, agents)
    const found = await lateReviewers(ctx, agents, new Map(live))
    const again = told.length
    await lateReviewers(ctx, agents, new Map(live))
    return { again, found, told }
  }

  test("tells the worker's lead once per head when a head ready 20 minutes has no round and no live reviewer (#129)", async () => {
    const { again, found, told } = await late(answer(21))
    expect(found).toEqual([])
    expect(again).toBe(1)
    expect(told).toHaveLength(1)
    expect(told[0]!.env?.NOTIFY_TO).toBe("builder")
    expect(told[0]!.argv[3]).toBe(
      "PR #145 (abcdef-worker): its head b9861d6 has been ready 21m with no review round and no live session for ghjkmn-reviewer. Start its reviewer, or ask abcdef-worker to.",
    )
    const none = await late(answer(21), [], false)
    expect(none.told[0]!.argv[3]).toContain("no reviewer on the roster")
  })

  test("stays quiet before 20 minutes, after a review round, with a live reviewer, or while the checks are not green (#129)", async () => {
    expect((await late(answer(19))).told).toEqual([])
    expect((await late(answer(30, ["## ReviewBot · round 1: 3/5 at 1234567"]))).told).toEqual([])
    expect((await late(answer(30), [["ghjkmn-reviewer", "busy"]])).told).toEqual([])
    expect((await late(answer(30, [], "PENDING"))).told).toEqual([])
  })

  test("a parked worker's ready head sends nothing, while a working one's still alerts (#175)", async () => {
    expect((await late(answer(30), [], true, "parked")).told).toEqual([])
    expect((await late(answer(30), [], true, "working")).told).toHaveLength(1)
  })

  test("a GraphQL answer it cannot read is reviewer-check-unreadable", async () => {
    expect((await late("not json")).found).toEqual(["reviewer-check-unreadable"])
  })
})

describe("prlessBranches", () => {
  const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()
  // each branch as GitHub's GraphQL answers it, by its alias: its head committed `age` minutes ago with `prs` PRs in any state, or null when the branch is not on GitHub
  const answer = (branches: (null | { age: number; prs: number })[]) =>
    JSON.stringify({
      data: {
        repository: Object.fromEntries(
          branches.map((b, i) => [
            `b${i}`,
            b && {
              associatedPullRequests: { totalCount: b.prs },
              target: {
                committedDate: minutesAgo(b.age),
                oid: `c0ffee${i}aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
              },
            },
          ]),
        ),
      },
    })
  const sweep = async (
    reply: string,
    rows: Record<string, unknown>[] = [
      { branch: "PG-234-branch-no-pr", kind: "worker", name: "abcdef-worker", status: "working" },
    ],
  ) => {
    const { ctx } = setup()
    const told: Call[] = []
    const queries: string[] = []
    ctx.factory = async () => "acme/app"
    ctx.run = async (argv, options = {}) => {
      if (argv[1] === "/repo/scripts/ops/notify.sh") told.push({ argv, env: options.env })
      if (argv[0] === "gh") queries.push(argv.join(" "))
      return { code: 0, err: "", out: argv[0] === "gh" ? reply : "" }
    }
    const agents = [{ kind: "builder", name: "builder" }, ...rows]
    roster(ctx, agents)
    const found = await prlessBranches(ctx, agents)
    const again = told.length
    await prlessBranches(ctx, agents)
    return { again, found, queries, told }
  }

  test("tells the worker's lead once per head when its PG branch's head is 15 minutes old with no PR (#234)", async () => {
    const { again, found, told } = await sweep(answer([{ age: 16, prs: 0 }]))
    expect(found).toEqual([])
    expect(again).toBe(1)
    expect(told).toHaveLength(1)
    expect(told[0]!.env?.NOTIFY_TO).toBe("builder")
    expect(told[0]!.argv[3]).toBe(
      "Branch PG-234-branch-no-pr (abcdef-worker): its head c0ffee0 is 16m old and has no PR, so no CI runs on it. Open its draft PR so CI runs.",
    )
  })

  test("tells the lead again when the branch's head moves and still has no PR (#234)", async () => {
    const { ctx } = setup()
    const told: string[] = []
    let reply = answer([{ age: 20, prs: 0 }])
    ctx.factory = async () => "acme/app"
    ctx.run = async (argv) => {
      if (argv[1] === "/repo/scripts/ops/notify.sh") told.push(argv[3]!)
      return { code: 0, err: "", out: argv[0] === "gh" ? reply : "" }
    }
    const agents = [
      { kind: "builder", name: "builder" },
      { branch: "PG-234-branch-no-pr", kind: "worker", name: "abcdef-worker", status: "working" },
    ]
    roster(ctx, agents)
    await prlessBranches(ctx, agents)
    reply = reply.replace("c0ffee0", "beef000")
    await prlessBranches(ctx, agents)
    await prlessBranches(ctx, agents)
    expect(told.map((line) => line.split(" ")[5])).toEqual(["c0ffee0", "beef000"])
  })

  test("stays quiet with a PR in any state, a head under 15 minutes, or a branch not on GitHub (#234)", async () => {
    expect((await sweep(answer([{ age: 30, prs: 1 }]))).told).toEqual([])
    expect((await sweep(answer([{ age: 14, prs: 0 }]))).told).toEqual([])
    expect((await sweep(answer([null]))).told).toEqual([])
  })

  test("reads no row holding a pr, as a merged one does, and none whose status is not live (#234)", async () => {
    const merged = await sweep(answer([{ age: 30, prs: 0 }]), [
      {
        branch: "PG-227-conventions-tighten",
        kind: "worker",
        name: "abcdef-worker",
        pr: "https://github.com/acme/app/pull/230",
        status: "working",
      },
    ])
    expect(merged.queries).toEqual([])
    expect(merged.told).toEqual([])
    expect(
      (
        await sweep(answer([{ age: 30, prs: 0 }]), [
          {
            branch: "PG-234-branch-no-pr",
            kind: "worker",
            name: "abcdef-worker",
            status: "waiting",
          },
        ])
      ).told,
    ).toHaveLength(1)
    for (const status of ["done", "ended", "merged", "parked"]) {
      const { queries, told } = await sweep(answer([{ age: 30, prs: 0 }]), [
        { branch: "PG-234-branch-no-pr", kind: "worker", name: "abcdef-worker", status },
      ])
      expect(told).toEqual([])
      expect(queries).toEqual([])
    }
  })

  test("reads every worker's PG branch in one GraphQL call, and no other branch (#234)", async () => {
    const { queries, told } = await sweep(
      answer([
        { age: 20, prs: 0 },
        { age: 40, prs: 0 },
      ]),
      [
        { branch: "PG-234-branch-no-pr", kind: "worker", name: "abcdef-worker", status: "working" },
        { branch: "pg-235-other", kind: "worker", name: "ghjkmn-worker", status: "working" },
        { branch: "fix-not-tracked", kind: "worker", name: "pqrstv-worker", status: "working" },
      ],
    )
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain('b0: ref(qualifiedName: "refs/heads/PG-234-branch-no-pr")')
    expect(queries[0]).toContain('b1: ref(qualifiedName: "refs/heads/pg-235-other")')
    expect(queries[0]).not.toContain("fix-not-tracked")
    expect(told.map((c) => c.argv[3]!.split(":")[0])).toEqual([
      "Branch PG-234-branch-no-pr (abcdef-worker)",
      "Branch pg-235-other (ghjkmn-worker)",
    ])
  })

  test("a GraphQL answer it cannot read is branch-check-unreadable (#234)", async () => {
    expect((await sweep("not json")).found).toEqual(["branch-check-unreadable"])
  })
})

describe("opsDown", () => {
  test("names a job whose script is not running, a failing beat, a stale one and an unreadable one, never a waiting one", async () => {
    const { ctx, ops } = setup({
      "ps -ax": { out: "" },
    })
    write(join(ops, "jobs.json"), { jobs: [{ disabled: true, name: "ops-off" }] })
    const at = (s: number) => new Date(NOW - s * 1000).toISOString()
    write(join(ops, "ops-fine.json"), {
      cycleSeconds: 60,
      job: "ops-fine",
      lastBeatAt: at(30),
      lastResult: "ok",
    })
    write(join(ops, "ops-bad.json"), {
      cycleSeconds: 60,
      job: "ops-bad",
      lastBeatAt: at(30),
      lastResult: "error",
    })
    write(join(ops, "ops-old.json"), {
      cycleSeconds: 60,
      job: "ops-old",
      lastBeatAt: at(181),
      lastResult: "ok",
    })
    write(join(ops, "ops-off.json"), {
      cycleSeconds: 60,
      job: "ops-off",
      lastBeatAt: at(9999),
      lastResult: "x",
    })
    write(join(ops, "ops-wait.json"), {
      cycleSeconds: 60,
      job: "ops-wait",
      lastBeatAt: at(30),
      lastResult: "waiting: nothing to read yet",
    })
    writeFileSync(join(ops, "ops-torn.json"), "{")
    expect((await opsDown(ctx)).sort()).toEqual([
      "ops-beat-unreadable:ops-torn.json",
      "ops-down:dashboard",
      "ops-failing:ops-bad",
      "ops-stale:ops-old",
    ])
  })
})

describe("forecast", () => {
  test("projects each window to its reset from the recent rate", async () => {
    const { ctx, sweep } = setup()
    const t = NOW / 1000
    const r5 = t + 7200
    const r7 = t + 86400
    write(join(ctx.data, "usage.json"), {
      rate_limits: {
        five_hour: { resets_at: r5, used_percentage: 50 },
        seven_day: { resets_at: r7, used_percentage: 40 },
      },
    })
    writeFileSync(
      join(sweep, "usage-samples.jsonl"),
      `${JSON.stringify({ f5: 40, r5, r7, s7: 39, t: t - 3600 })}\n`,
    )
    expect(await forecast(ctx)).toEqual({ "5h": 70, "7d": 64 })
  })

  test("a window with no reset is left out", async () => {
    const { ctx } = setup()
    write(join(ctx.data, "usage.json"), {
      rate_limits: {
        five_hour: { resets_at: null, used_percentage: 0 },
        seven_day: { resets_at: NOW / 1000 + 86400, used_percentage: 40 },
      },
    })
    expect(await forecast(ctx)).toEqual({})
  })

  test("an account with no 5-hour window still has its week projected", async () => {
    const { ctx, sweep } = setup()
    const t = NOW / 1000
    const r7 = t + 86400
    write(join(ctx.data, "usage.json"), {
      rate_limits: { seven_day: { resets_at: r7, used_percentage: 40 } },
    })
    writeFileSync(
      join(sweep, "usage-samples.jsonl"),
      `${JSON.stringify({ r7, s7: 39, t: t - 3600 })}\n`,
    )
    expect(await forecast(ctx)).toEqual({ "7d": 64 })
  })
})

describe("pass", () => {
  test("tells ops only a new finding, again once it clears and comes back, never a known one", async () => {
    const replies: Record<string, { code?: number; out?: string }> = {
      [DASHBOARD_DB]: { out: "playground-dispatcher-db\n" },
    }
    const { calls, ctx, sweep } = setup(replies)
    roster(ctx, [{ name: "runner-gone", status: "working" }])
    const told = () =>
      calls.filter((c) => c.argv[1] === "/repo/scripts/ops/notify.sh").map((c) => c.argv[3])
    const known = new Set(["no-headroom"])
    let { active, result } = await pass(ctx, new Set(known), known)
    expect(result).toBe("ok")
    expect(told()).toEqual(["down:runner-gone"])
    ;({ active } = await pass(ctx, active, known))
    expect(told()).toHaveLength(1)
    roster(ctx, [])
    ;({ active } = await pass(ctx, active, known))
    roster(ctx, [{ name: "runner-gone", status: "working" }])
    await pass(ctx, active, known)
    expect(told()).toEqual(["down:runner-gone", "down:runner-gone"])
    expect(readFileSync(join(sweep, "sweep.log"), "utf8")).toContain("Z down:runner-gone\n")
    const up = calls.find((c) => c.argv[2] === "/main/scripts/ops/up.py")!
    expect(up.env?.OPS_UP_SKIP).toBe("ops-sweep")
  })
})

describe("maybePrune", () => {
  test("prunes once in 6 hours when quiet, and logs what it freed or that it could not run", async () => {
    const { calls, ctx, ops, sweep } = setup({
      "docker builder prune": { code: 127 },
      "docker volume prune": { out: "Total reclaimed space: 1.5GB\n" },
    })
    await maybePrune(ctx)
    expect(calls.map((c) => c.argv.slice(0, 3).join(" "))).toContain("docker volume prune")
    expect(read(join(sweep, "prune-state.json"))).toEqual({ at: NOW / 1000 })
    expect(readFileSync(join(ops, "ops-log.md"), "utf8")).toContain(
      "`volume prune -f` freed 1.5GB; `builder prune -f --filter until=24h` failed (exit 127)",
    )
    calls.length = 0
    await maybePrune(ctx)
    expect(calls).toHaveLength(0)
  })

  test("waits while a container sits in Created, or the dashboard rolled in the last 5 minutes", async () => {
    const busy = setup({ "docker ps -a": { out: "abc\n" } })
    await maybePrune(busy.ctx)
    expect(busy.calls.some((c) => c.argv[1] === "volume")).toBe(false)
    const rolled = setup()
    mkdirSync(join(rolled.ops, "dashboard"))
    writeFileSync(
      join(rolled.ops, "dashboard", "supervisor.log"),
      `${new Date(NOW - 60_000).toISOString().slice(0, 19)}Z canary moved\n`,
    )
    await maybePrune(rolled.ctx)
    expect(rolled.calls).toHaveLength(0)
    const onMain = setup()
    mkdirSync(join(onMain.ops, "dashboard"))
    writeFileSync(
      join(onMain.ops, "dashboard", "supervisor.log"),
      `${new Date(NOW - 60_000).toISOString().slice(0, 19)}Z main moved: abc1234 -> def5678\n`,
    )
    await maybePrune(onMain.ctx)
    expect(onMain.calls).toHaveLength(0)
  })
})
