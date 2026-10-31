import { afterAll, beforeAll, describe, expect, test } from "bun:test"
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
import { dirname, join } from "node:path"

import { setSessionNames } from "../../../../../packages/config/src/kinds"
import {
  autoEnd,
  BEATS,
  type Context,
  cronMatches,
  cycle,
  leadOf,
  nextDue,
  resultOf,
  runner,
  sweepRepos,
  switchAccount,
  turboPrune,
} from "../../../../../packages/scripts/src/ops-tick/tick"
import { OLD } from "../../../../old-names"
import { storeWith } from "../../../../scripts/hooks/render-set"
import { OLD_AS_NAMES, SEEDED_NAMES } from "../../../../session-names"

// A machine whose sessions.names keep the old names, which this file's fallbacks name.
beforeAll(() => setSessionNames(OLD_AS_NAMES))
afterAll(() => setSessionNames(SEEDED_NAMES))

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// A scratch acme folder: ops under it, the roster beside it.
const scratch = (): string => {
  const acme = join(realpathSync(mkdtempSync(join(tmpdir(), "ops-tick-"))), OLD.dispatcher)
  dirs.push(acme)
  mkdirSync(join(acme, "ops"), { recursive: true })
  return join(acme, "ops")
}

// Machine wall time, as the old crons read it.
const at = (hour: number, minute: number) => new Date(2026, 9, 19, hour, minute, 10)

// A fake context: each script's output by a word of its argv, every run and every line sent recorded; a line holding a word of fails throws, as notify.sh failing does.
const fake = (
  ops: string,
  now: Date,
  outputs: Record<string, string> = {},
  fails: string[] = [],
) => {
  const runs: string[][] = []
  const sent: { text: string; to: string }[] = []
  const ctx: Context = {
    now,
    ops,
    repo: "/repo",
    run: async (argv) => {
      runs.push(argv)
      const key = Object.keys(outputs).find((k) => argv.join(" ").includes(k))
      return { code: 0, out: key ? outputs[key]! : "" }
    },
    send: async (to, text) => {
      if (fails.some((word) => text.includes(word))) throw new Error("notify.sh exited 1")
      sent.push({ text, to })
      return true
    },
  }
  return { ctx, runs, sent }
}

const beat = (name: string) => BEATS.find((b) => b.name === name)!

const QUIET_LOAD = { "vm.loadavg": "{ 2.10 3.40 4.00 }" }

describe("up", () => {
  test("runs ops-up every 5 minutes and tells ops each line it prints once, until the line changes (#1275)", async () => {
    const ops = scratch()
    const up = beat("up")
    expect(up.cron).toBe("*/5 * * * *")
    const said = "started ops-dashboard in herdr (heartbeat 7m old)"
    const first = fake(ops, at(13, 5), { "up.py": said })
    await up.run(first.ctx)
    expect(first.runs).toEqual([["python3", "-I", "/repo/scripts/ops/up.py"]])
    expect(first.sent).toEqual([{ text: said, to: "ops" }])
    const failed = "could not start ops-dashboard in cmux (process gone); see up.log"
    const again = fake(ops, at(13, 10), { "up.py": `${said}\n${failed}` })
    await up.run(again.ctx)
    expect(again.sent).toEqual([{ text: failed, to: "ops" }])
    const quiet = fake(ops, at(13, 15), { "up.py": failed })
    await up.run(quiet.ctx)
    expect(quiet.sent).toEqual([])
  })
})

// the sweep's ends, each line to its lead, and a session it could not end told once until its line changes.
describe("auto-end", () => {
  test("runs every 5 minutes, sends each end to its lead, and a refusal once", async () => {
    const ops = scratch()
    expect(beat("auto-end").cron).toBe("*/5 * * * *")
    const refused = {
      text: "Not ended q6dmtb-worker (worker-prs-done (merged)): uncommitted work in /wt; push it, then close it",
      to: "builder",
    }
    const ended = { text: "Ended m4tqzr-reviewer: checker-pr-done (merged)", to: "builder" }
    const first = fake(ops, at(13, 5))
    await autoEnd(async () => [ended, refused])(first.ctx)
    expect(first.sent).toEqual([ended, refused])
    const again = fake(ops, at(13, 10))
    await autoEnd(async () => [refused])(again.ctx)
    expect(again.sent).toEqual([])
  })
})

describe("cron", () => {
  test("reads minute lists, steps and hours in machine wall time", () => {
    expect(cronMatches("3,18,33,48 * * * *", at(13, 33))).toBe(true)
    expect(cronMatches("3,18,33,48 * * * *", at(13, 34))).toBe(false)
    expect(cronMatches("*/5 * * * *", at(9, 55))).toBe(true)
    expect(cronMatches("7 */2 * * *", at(14, 7))).toBe(true)
    expect(cronMatches("7 */2 * * *", at(13, 7))).toBe(false)
    expect(cronMatches("13 21 * * *", at(21, 13))).toBe(true)
  })

  test("names the next due minute", () => {
    expect(nextDue("13 21 * * *", at(13, 0))).toEqual(new Date(2026, 9, 19, 21, 13))
    expect(nextDue("*/5 * * * *", at(13, 3))).toEqual(new Date(2026, 9, 19, 13, 5))
  })

  test("refuses a cron it cannot read", () => {
    expect(() => cronMatches("every 5", at(1, 1))).toThrow()
    expect(() => cronMatches("61 * * * *", at(1, 1))).toThrow()
  })
})

describe("roll gate", () => {
  test("names a paused file over 30 minutes old to ops, once a file, and leaves roll-now unwritten (#1253)", async () => {
    const ops = scratch()
    mkdirSync(join(ops, "dashboard"))
    writeFileSync(join(ops, "dashboard", "paused"), "")
    const now = at(13, 0)
    utimesSync(
      join(ops, "dashboard", "paused"),
      (now.getTime() - 45 * 60_000) / 1000,
      (now.getTime() - 45 * 60_000) / 1000,
    )
    const first = fake(ops, now)
    await beat("roll-gate").run(first.ctx)
    expect(await Bun.file(join(ops, "dashboard", "roll-now")).exists()).toBe(false)
    expect(first.sent).toEqual([{ text: "ops/dashboard/paused is 45 min old", to: "ops" }])
    const again = fake(ops, at(13, 5))
    await beat("roll-gate").run(again.ctx)
    expect(again.sent).toEqual([])
  })

  test("a paused chase whose minutes change each run goes out once, as it reads then, after the relay was down for 5 runs", async () => {
    const ops = scratch()
    mkdirSync(join(ops, "dashboard"))
    const paused = join(ops, "dashboard", "paused")
    writeFileSync(paused, "")
    utimesSync(paused, at(13, 0), at(13, 0))
    const jobs = runner()
    const lines: string[] = []
    for (const minute of [35, 40, 45, 50, 55]) {
      const { ctx } = fake(ops, at(13, minute), {}, ["paused is"])
      await Promise.all(cycle(ctx, jobs, [beat("roll-gate")]))
      expect(resultOf(jobs)).toBe("roll-gate: send to ops failed: notify.sh exited 1")
    }
    for (const hour of [14, 15]) {
      const { ctx, sent } = fake(ops, new Date(2026, 9, 19, hour, 0, 10))
      await Promise.all(cycle(ctx, jobs, [beat("roll-gate")]))
      lines.push(...sent.map((line) => `${line.to}: ${line.text}`))
    }
    expect(lines).toEqual(["ops: ops/dashboard/paused is 60 min old"])
    expect(resultOf(jobs)).toBe("ok")
  })

  test("a quiet run, with no paused file, writes nothing, so the dashboard's roll holds stand", async () => {
    const ops = scratch()
    const { ctx, sent } = fake(ops, at(13, 0))
    await beat("roll-gate").run(ctx)
    expect(await Bun.file(join(ops, "dashboard", "roll-now")).exists()).toBe(false)
    expect(sent).toEqual([])
  })
})

describe("tick", () => {
  const MARKS = [
    "acme@example.com: week 91% (resets Tue 14:00Z), rate 1.2%/h; today 10% spent",
    "ALERT 90 acme@example.com: week at 91%, past 90%",
    "ALERT 98 pride@example.com: week at 98%, past 98%",
  ].join("\n")

  test(`routes each alert as the old tick did: usage marks to the builder, a switch due and near-limit lines to ${OLD.dispatcher}`, async () => {
    const { ctx, runs, sent } = fake(scratch(), at(13, 3), {
      "load-report.py": "load5 16.5\n  worker-a: 300% CPU\n  cmux app: 90% CPU\n  other: 10% CPU",
      "login-flip.py": "switch due: move to pride@",
      "near-limit.py": "ALERT 5h acme@: 5-hour window at 86%\nweek passed 80% on pride@",
      "vm.loadavg": "{ 12.00 16.50 9.00 }",
      "week-marks.py": MARKS,
    })
    await beat("tick").run(ctx)
    expect(sent).toEqual([
      { text: "ALERT 90 acme@example.com: week at 91%, past 90%", to: "builder" },
      { text: "ALERT 98 pride@example.com: week at 98%, past 98%", to: "builder" },
      { text: `usage: ${MARKS.split("\n")[0]}`, to: "builder" },
      { text: "switch due: move to pride@", to: "dispatcher" },
      {
        text: "load5 16.5: load5 16.5 worker-a: 300% CPU cmux app: 90% CPU other: 10% CPU",
        to: "builder",
      },
      { text: "ALERT 5h acme@: 5-hour window at 86%", to: "builder" },
      { text: "week passed 80% on pride@", to: "dispatcher" },
    ])
    const alerts = runs.filter((argv) => argv.some((a) => a.endsWith("inbox-alert.py")))
    expect(alerts.map((argv) => argv.at(-1))).toEqual([
      "ALERT 98 pride@example.com: week at 98%, past 98%",
    ])
  })

  test("a failed send mid-beat posts the Inbox alert, keeps the beat's other sends, is named on the heartbeat and goes again at the next run", async () => {
    const ops = scratch()
    const state = runner()
    const first = fake(
      ops,
      at(13, 3),
      { ...QUIET_LOAD, "near-limit.py": "week passed 80% on pride@", "week-marks.py": MARKS },
      ["ALERT 98"],
    )
    await Promise.all(cycle(first.ctx, state, [beat("tick")]))
    expect(first.sent.map((line) => line.text)).toEqual([
      "ALERT 90 acme@example.com: week at 91%, past 90%",
      `usage: ${MARKS.split("\n")[0]}`,
      "week passed 80% on pride@",
    ])
    expect(first.runs.some((argv) => argv.some((a) => a.endsWith("inbox-alert.py")))).toBe(true)
    expect(resultOf(state)).toBe("tick: send to builder failed: notify.sh exited 1")
    const next = fake(ops, at(13, 18), QUIET_LOAD)
    await Promise.all(cycle(next.ctx, state, [beat("tick")]))
    expect(next.sent).toEqual([
      { text: "ALERT 98 pride@example.com: week at 98%, past 98%", to: "builder" },
    ])
    expect(resultOf(state)).toBe("ok")
  })

  test("a load line whose reading changes each tick goes out once, as it reads then, after the relay was down for 5 ticks", async () => {
    const ops = scratch()
    const jobs = runner()
    const busy = (load5: number) => ({
      "load-report.py": "worker-a: 300% CPU",
      "vm.loadavg": `{ 12.00 ${load5}.00 9.00 }`,
    })
    for (const [i, hour] of [13, 14, 15, 16, 17].entries()) {
      const { ctx } = fake(ops, at(hour, 18), busy(16 + i), ["load5"])
      await Promise.all(cycle(ctx, jobs, [beat("tick")]))
      expect(resultOf(jobs)).toBe("tick: send to builder failed: notify.sh exited 1")
    }
    const { ctx, sent } = fake(ops, at(18, 18), busy(25))
    await Promise.all(cycle(ctx, jobs, [beat("tick")]))
    expect(sent).toEqual([{ text: "load5 25: worker-a: 300% CPU", to: "builder" }])
    expect(resultOf(jobs)).toBe("ok")
  })

  test("a quiet run sends nothing and posts no Inbox alert", async () => {
    const { ctx, runs, sent } = fake(scratch(), at(13, 18), {
      ...QUIET_LOAD,
      "week-marks.py": "acme@example.com: week 40%",
    })
    await beat("tick").run(ctx)
    expect(sent).toEqual([])
    expect(runs.some((argv) => argv.some((a) => a.endsWith("inbox-alert.py")))).toBe(false)
  })
})

describe("usage-limit watch", () => {
  const state = (ops: string, writtenAt: Date) => {
    mkdirSync(join(ops, "unstick"), { recursive: true })
    mkdirSync(join(ops, "usage"), { recursive: true })
    writeFileSync(
      join(ops, "unstick", "state.json"),
      JSON.stringify({
        blocked: {
          a: { account: "own@example.org", kind: "usage-limit", name: "worker-b" },
          b: { account: "own@example.org", kind: "usage-limit-stuck", name: "worker-a" },
          c: { kind: "permission", name: "worker-c" },
          d: { account: "own@example.org", kind: "usage-limit", name: "worker-told" },
          e: { account: "pride@example.com", kind: "usage-limit", name: "worker-other" },
        },
        writtenAt: writtenAt.toISOString(),
      }),
    )
    writeFileSync(join(ops, "usage", "limit-told.txt"), "worker-told\n")
    usage(ops, "usage.json", "own@example.org", 97, writtenAt)
    usage(ops, "usage-pride.json", "pride@example.com", 100, writtenAt)
    usage(ops, "usage-spare.json", "spare@example.com", 40, writtenAt)
    usage(ops, "usage-burst.json", "burst@example.com", 5, writtenAt, 90)
    usage(
      ops,
      "usage-spare-old.json",
      "spare@example.com",
      10,
      new Date(writtenAt.getTime() - 30 * 60_000),
    )
    usage(
      ops,
      "usage-stale.json",
      "stale@example.com",
      10,
      new Date(writtenAt.getTime() - 2 * 3_600_000),
    )
  }
  const usage = (
    ops: string,
    file: string,
    account: string,
    week: number,
    writtenAt: Date,
    fiveHour = 0,
  ) =>
    writeFileSync(
      join(ops, "..", file),
      JSON.stringify({
        account,
        rate_limits: {
          five_hour: { used_percentage: fiveHour },
          seven_day: { used_percentage: week },
        },
        writtenAt: writtenAt.toISOString(),
      }),
    )
  const LINE =
    "worker-a (own@example.org) worker-b (own@example.org) worker-other (pride@example.com) show the usage-limit screen. Move each to spare@example.com, the account with the most room (week 40%), from its handoff."

  test("names each new session on the usage-limit screen to the builder once", async () => {
    const ops = scratch()
    const now = at(13, 5)
    state(ops, now)
    const first = fake(ops, now)
    await beat("usage-limit-watch").run(first.ctx)
    expect(first.sent).toEqual([{ text: LINE, to: "builder" }])
    const again = fake(ops, now)
    await beat("usage-limit-watch").run(again.ctx)
    expect(again.sent).toEqual([])
  })

  test("a line the relay fails twice is tried once a run, never kept to resend since the watch finds it again, and marked told only once it goes", async () => {
    const ops = scratch()
    state(ops, at(13, 5))
    const jobs = runner()
    const tries: number[] = []
    const lines: string[][] = []
    for (const [minute, failing] of [
      [5, true],
      [15, true],
      [25, false],
      [35, false],
    ] as const) {
      const path = join(ops, "unstick", "state.json")
      const written = JSON.parse(readFileSync(path, "utf8"))
      writeFileSync(path, JSON.stringify({ ...written, writtenAt: at(13, minute).toISOString() }))
      const { ctx, sent } = fake(ops, at(13, minute), {}, failing ? ["usage-limit"] : [])
      const send = ctx.send
      let n = 0
      ctx.send = async (to, text) => {
        n++
        return send(to, text)
      }
      await Promise.all(cycle(ctx, jobs, [beat("usage-limit-watch")]))
      tries.push(n)
      lines.push(sent.map((line) => line.text))
      expect(jobs.unsent.get("usage-limit-watch")).toEqual([])
      expect(resultOf(jobs)).toBe(
        failing ? "usage-limit-watch: send to builder failed: notify.sh exited 1" : "ok",
      )
      expect(readFileSync(join(ops, "usage", "limit-told.txt"), "utf8")).toBe(
        failing ? "worker-told\n" : "worker-told\nworker-a\nworker-b\nworker-other\n",
      )
    }
    expect(tries).toEqual([1, 1, 1, 0])
    expect(lines).toEqual([[], [], [LINE], []])
  })

  test("names no account to move to when every fresh reading is spent or a stuck session's own", async () => {
    const ops = scratch()
    const now = at(13, 5)
    state(ops, now)
    usage(ops, "usage.json", "own@example.org", 30, now)
    usage(ops, "usage-spare.json", "spare@example.com", 100, now)
    const { ctx, sent } = fake(ops, now)
    await beat("usage-limit-watch").run(ctx)
    expect(sent.map((line) => line.text)).toEqual([
      "worker-a (own@example.org) worker-b (own@example.org) worker-other (pride@example.com) show the usage-limit screen. No account has room: each waits for its reset.",
    ])
  })

  test("a state file over 3 minutes old sends nothing", async () => {
    const ops = scratch()
    state(ops, new Date(at(13, 5).getTime() - 4 * 60_000))
    const { ctx, sent } = fake(ops, at(13, 5))
    await beat("usage-limit-watch").run(ctx)
    expect(sent).toEqual([])
  })
})

describe("sweep", () => {
  const UP = [
    "/m/scripts/spawn.sh resume worker-x /m 1111 --backend claude",
    '  then SendMessage worker-x: "cmux restarted; re-read your roster task."',
    `/m/scripts/spawn.sh resume ${OLD.planner} /m 2222`,
    "/m/scripts/spawn.sh resume reviewer-q /m 3333",
    "/m/scripts/spawn.sh resume runner-y /m 4444",
    "/m/scripts/spawn.sh resume worker-parked /m 5555",
    "/m/scripts/spawn.sh resume probe-z /m 6666",
    "runner-y (pid 42, /m) runs without the factory's hooks: respawn it from its handoff",
  ].join("\n")

  const withRoster = (ops: string) => {
    writeFileSync(
      join(ops, "..", "roster.json"),
      JSON.stringify({
        agents: [
          { name: "worker-x", status: "working" },
          { name: OLD.planner },
          { name: "reviewer-q", worker: OLD.ops },
          { name: "runner-y" },
          { name: "worker-parked", status: "parked" },
        ],
      }),
    )
  }

  test("sends each felled session to its lead once, and names a load past 30 once", async () => {
    const ops = scratch()
    const now = at(13, 7)
    withRoster(ops)
    const { ctx, sent } = fake(ops, now, {
      "--sessions": UP,
      "vm.loadavg": "{ 30.00 31.00 20.00 }",
    })
    await beat("sweep").run(ctx)
    expect(sent).toEqual([
      {
        text: 'Felled: /m/scripts/spawn.sh resume worker-x /m 1111 --backend claude then SendMessage worker-x: "cmux restarted; re-read your roster task."',
        to: "builder",
      },
      { text: `Felled: /m/scripts/spawn.sh resume ${OLD.planner} /m 2222`, to: "dispatcher" },
      { text: "Felled: /m/scripts/spawn.sh resume reviewer-q /m 3333", to: "ops" },
      { text: "Felled: /m/scripts/spawn.sh resume runner-y /m 4444", to: "ops" },
      { text: "load5 31 (passed 30); lanes drop to 12", to: "dispatcher" },
      { text: "load5 31: lanes drop to 12", to: "ops" },
    ])
    const again = fake(ops, at(13, 37), { "--sessions": UP, "vm.loadavg": "{ 25.00 25.00 20.00 }" })
    withRoster(ops)
    await beat("sweep").run(again.ctx)
    expect(again.sent).toEqual([])
    const cleared = fake(ops, at(14, 7), { "vm.loadavg": "{ 10.00 20.00 20.00 }" })
    await beat("sweep").run(cleared.ctx)
    expect(existsSync(join(ops, "tick", "load-told"))).toBe(false)
  })

  test("a quiet run sends nothing and runs no ops-up", async () => {
    const ops = scratch()
    const now = at(13, 37)
    withRoster(ops)
    const { ctx, runs, sent } = fake(ops, now, { "vm.loadavg": "{ 29.00 29.00 10.00 }" })
    await beat("sweep").run(ctx)
    expect(sent).toEqual([])
    expect(runs.some((argv) => argv.join(" ") === "python3 -I /repo/scripts/ops/up.py")).toBe(false)
  })

  test("a step that fails is named to ops and the others still run", async () => {
    const ops = scratch()
    const now = at(13, 7)
    withRoster(ops)
    const { ctx, sent } = fake(ops, now, QUIET_LOAD)
    const run = ctx.run
    ctx.run = async (argv, timeoutMs) => {
      if (argv.join(" ").includes("--sessions")) throw new Error("up.py timed out")
      return run(argv, timeoutMs)
    }
    await beat("sweep").run(ctx)
    expect(sent).toEqual([{ text: "ops-tick sweep: felled failed: up.py timed out", to: "ops" }])
  })

  test("a felled line whose send fails is not marked told and goes once at the next sweep", async () => {
    const ops = scratch()
    withRoster(ops)
    const state = runner()
    const first = fake(ops, at(13, 7), { ...QUIET_LOAD, "--sessions": UP }, [
      `resume ${OLD.planner}`,
    ])
    await Promise.all(cycle(first.ctx, state, [beat("sweep")]))
    expect(first.sent.map((line) => line.to)).toEqual(["builder", "ops", "ops"])
    expect(resultOf(state)).toBe("sweep: send to dispatcher failed: notify.sh exited 1")
    withRoster(ops)
    const next = fake(ops, at(13, 37), { ...QUIET_LOAD, "--sessions": UP })
    await Promise.all(cycle(next.ctx, state, [beat("sweep")]))
    expect(next.sent).toEqual([
      { text: `Felled: /m/scripts/spawn.sh resume ${OLD.planner} /m 2222`, to: "dispatcher" },
    ])
    withRoster(ops)
    const after = fake(ops, at(14, 7), { ...QUIET_LOAD, "--sessions": UP })
    await Promise.all(cycle(after.ctx, state, [beat("sweep")]))
    expect(after.sent).toEqual([])
    expect(resultOf(state)).toBe("ok")
  })

  test(`routes a felled session by its name, as ${OLD.ops}'s sweep does`, () => {
    expect([
      leadOf("worker-a", undefined),
      leadOf("reviewer-a", "worker-a"),
      leadOf("tester-a", OLD.ops),
      leadOf("runner-a", undefined),
      leadOf(OLD.builder, undefined),
    ]).toEqual(["builder", "builder", "ops", "ops", "dispatcher"])
  })

  test("routes an <id>-<kind> name by its kind, and a roster kind over the name", () => {
    expect([
      leadOf("h4t9vz-worker", undefined),
      leadOf("b7k2mq-reviewer", "h4t9vz-worker"),
      leadOf("x7mh4d-tester", OLD.ops),
      leadOf("k3m9px-runner", undefined),
      leadOf("plain", undefined, "runner"),
      leadOf("x7mh4d-builder", undefined),
    ]).toEqual(["builder", "builder", "ops", "ops", "ops", "dispatcher"])
  })

  test(`routes a checker of an <id>-ops to ops, as it does ${OLD.ops}'s (PG-1644)`, () => {
    expect(leadOf("x7mh4d-tester", "k3v9q2-ops")).toBe("ops")
    expect(leadOf("ops-dashboard", undefined)).toBe("dispatcher")
  })

  test("skips a felled probe by its kind, whatever its name", async () => {
    const ops = scratch()
    writeFileSync(
      join(ops, "..", "roster.json"),
      JSON.stringify({ agents: [{ kind: "probe", name: "plain" }, { name: "k3m9px-runner" }] }),
    )
    const { ctx, sent } = fake(ops, at(13, 7), {
      "--sessions": [
        "/m/scripts/spawn.sh resume k3m9px-probe /m 1111",
        "/m/scripts/spawn.sh resume plain /m 2222",
        "/m/scripts/spawn.sh resume k3m9px-runner /m 3333",
      ].join("\n"),
      ...QUIET_LOAD,
    })
    await beat("sweep").run(ctx)
    expect(sent).toEqual([
      { text: "Felled: /m/scripts/spawn.sh resume k3m9px-runner /m 3333", to: "ops" },
    ])
  })
})

describe("switch watch, in the tick", () => {
  // usage.json reading that account, in a data folder whose policy sets usage.switchAccount to switch@.
  const usage = (ops: string, account: string, used: number) => {
    storeWith(join(ops, ".."), {}, { "usage.switchAccount": "switch@example.test" })
    writeFileSync(
      join(ops, "..", "usage.json"),
      JSON.stringify({
        account,
        rate_limits: {
          seven_day: { resets_at: at(13, 0).getTime() / 1000 + 86_400, used_percentage: used },
        },
      }),
    )
  }

  test("tells ops at 98% and, at 100%, writes the move file and sends its text to both dispatchers and both leads, each once a week", async () => {
    const ops = scratch()
    usage(ops, "switch@example.test", 100)
    const { ctx, sent } = fake(ops, at(13, 18), QUIET_LOAD)
    await beat("tick").run(ctx)
    const move = await Bun.file(join(ops, "unstick", "move.json")).json()
    expect(move.to).toBe(`${OLD.dispatcher}-2`)
    expect(Date.parse(move.until) - at(13, 18).getTime()).toBe(4 * 3_600_000)
    expect(sent[0]!.to).toBe("ops")
    expect(sent[0]!.text).toStartWith("switch@ week at 100% (")
    expect(sent.slice(1).map((m) => m.to)).toEqual([
      `${OLD.dispatcher}-2`,
      OLD.dispatcher,
      "builder",
      "ops",
    ])
    expect(sent[1]!.text).toContain(`"to":"${OLD.dispatcher}-2"`)
    const again = fake(ops, at(13, 33), QUIET_LOAD)
    await beat("tick").run(again.ctx)
    expect(again.sent).toEqual([])
  })

  test("at 100%, the move and its text go to the dispatchers the roster seats by slot (PG-1644)", async () => {
    const ops = scratch()
    usage(ops, "switch@example.test", 100)
    writeFileSync(
      join(ops, "..", "roster.json"),
      JSON.stringify({
        agents: [
          { kind: "dispatcher", name: "m4n7vw-dispatcher", status: "working" },
          { kind: "dispatcher", name: "q8r2tx-dispatcher", slot: "2", status: "working" },
        ],
      }),
    )
    const { ctx, sent } = fake(ops, at(13, 18), QUIET_LOAD)
    await beat("tick").run(ctx)
    expect((await Bun.file(join(ops, "unstick", "move.json")).json()).to).toBe("q8r2tx-dispatcher")
    expect(sent.slice(1).map((m) => m.to)).toEqual([
      "q8r2tx-dispatcher",
      "m4n7vw-dispatcher",
      "builder",
      "ops",
    ])
  })

  test("a failed send at 100% goes again on the next tick alone, after a restart too, with the same move file, and the others are told once", async () => {
    const ops = scratch()
    usage(ops, "switch@example.test", 100)
    const jobs = runner()
    const first = fake(ops, at(13, 18), QUIET_LOAD)
    const send = first.ctx.send
    first.ctx.send = async (to, text) => {
      if (to === "builder") throw new Error("notify.sh exited 1")
      return send(to, text)
    }
    await Promise.all(cycle(first.ctx, jobs, [beat("tick")]))
    expect(first.sent.map((m) => m.to)).toEqual([
      "ops",
      `${OLD.dispatcher}-2`,
      OLD.dispatcher,
      "ops",
    ])
    expect(resultOf(jobs)).toBe("tick: send to builder failed: notify.sh exited 1")
    const move = readFileSync(join(ops, "unstick", "move.json"), "utf8")
    const restarted = runner()
    const next = fake(ops, at(13, 33), QUIET_LOAD)
    await Promise.all(cycle(next.ctx, restarted, [beat("tick")]))
    expect(next.sent.map((m) => m.to)).toEqual(["builder"])
    expect(next.sent[0]!.text).toContain(move.trim())
    expect(readFileSync(join(ops, "unstick", "move.json"), "utf8")).toBe(move)
    expect(resultOf(restarted)).toBe("ok")
    const after = fake(ops, at(13, 48), QUIET_LOAD)
    await Promise.all(cycle(after.ctx, restarted, [beat("tick")]))
    expect(after.sent).toEqual([])
  })

  test("another account, or a week under 98%, sends nothing and writes no move file", async () => {
    for (const [account, used] of [
      ["other@example.test", 100],
      ["switch@example.test", 97],
    ] as const) {
      const ops = scratch()
      usage(ops, account, used)
      const { ctx, sent } = fake(ops, at(13, 18), QUIET_LOAD)
      await beat("tick").run(ctx)
      expect(sent).toEqual([])
      expect(existsSync(join(ops, "unstick", "move.json"))).toBe(false)
    }
  })
})

describe("the beats that send no line", () => {
  test("the planner sweep runs its script and keeps the output", async () => {
    const ops = scratch()
    const { ctx, runs, sent } = fake(ops, at(13, 17), { "sweep.py": "PILEUP 3" })
    await beat("planner-sweep").run(ctx)
    expect(runs.map((argv) => argv.join(" "))).toEqual([
      `python3 -I ${join(ops, "..", "planner", "sweep.py")}`,
    ])
    expect(sent).toEqual([])
  })

  test("GLM credits writes one log line from ops-zai-usage's file while its beat is fresh", async () => {
    const ops = scratch()
    const now = at(13, 43)
    writeFileSync(
      join(ops, "ops-zai-usage.json"),
      JSON.stringify({ lastBeatAt: now.toISOString(), lastResult: "ok" }),
    )
    writeFileSync(
      join(ops, "..", "zai-usage.json"),
      JSON.stringify({ windows: { week: { used: 5 } } }),
    )
    const { ctx, runs, sent } = fake(ops, now)
    await beat("glm-credits").run(ctx)
    expect(sent).toEqual([])
    expect(runs).toEqual([])
    expect(await Bun.file(join(ops, "log", "glm-credits.log")).text()).toContain(
      'cache {"week":{"used":5}}',
    )
  })

  test("GLM credits reads the endpoint once when the beat is stale", async () => {
    const ops = scratch()
    const { ctx, runs } = fake(ops, at(13, 43), { "glm-credits.py": "5h 10/100" })
    await beat("glm-credits").run(ctx)
    expect(runs.length).toBe(1)
    expect(await Bun.file(join(ops, "log", "glm-credits.log")).text()).toContain("fresh 5h 10/100")
  })

  test("the turbo prune runs weekly, removes entries over 7 days old, keeps newer ones and folders", async () => {
    expect(beat("turbo-prune").cron).toBe("29 3 * * 0")
    const ops = scratch()
    const cache = join(ops, "..", "turbo")
    mkdirSync(join(cache, "sub"), { recursive: true })
    const now = at(3, 29)
    const days = (n: number) => new Date(now.getTime() - n * 86_400_000)
    writeFileSync(join(cache, "old.tar.zst"), "x".repeat(3 * 1_048_576))
    utimesSync(join(cache, "old.tar.zst"), days(8), days(8))
    writeFileSync(join(cache, "new.tar.zst"), "y")
    utimesSync(join(cache, "new.tar.zst"), days(1), days(1))
    writeFileSync(join(cache, "sub", "inner"), "z")
    utimesSync(join(cache, "sub", "inner"), days(30), days(30))
    utimesSync(join(cache, "sub"), days(30), days(30))
    const { ctx, runs, sent } = fake(ops, now)
    await turboPrune(cache)(ctx)
    expect(existsSync(join(cache, "old.tar.zst"))).toBe(false)
    expect(existsSync(join(cache, "new.tar.zst"))).toBe(true)
    expect(existsSync(join(cache, "sub", "inner"))).toBe(true)
    expect(runs).toEqual([])
    expect(sent).toEqual([])
    expect(await Bun.file(join(ops, "log", "turbo-prune.log")).text()).toContain(
      "removed 1, kept 1, freed 3 MB",
    )
  })

  test("the turbo prune logs a missing folder and throws nothing", async () => {
    const ops = scratch()
    const { ctx } = fake(ops, at(3, 29))
    await turboPrune(join(ops, "no-cache"))(ctx)
    expect(await Bun.file(join(ops, "log", "turbo-prune.log")).text()).toContain("no folder")
  })

  test("the turbo prune names a cache path it cannot read, rather than calling it missing", async () => {
    const ops = scratch()
    const file = join(ops, "not-a-folder")
    writeFileSync(file, "")
    const { ctx } = fake(ops, at(3, 29))
    await turboPrune(file)(ctx)
    expect(await Bun.file(join(ops, "log", "turbo-prune.log")).text()).toContain(
      `unreadable ${file}: ENOTDIR`,
    )
  })
})

describe("the optimizer's beats", () => {
  test.each([
    ["optimizer-flow", "optimizer flow"],
    ["optimizer-burn", "optimizer burn check"],
    ["optimizer-tick", "optimizer tick"],
    ["optimizer-daily", "optimizer daily"],
  ])("%s sends its words to the optimizer", async (name, words) => {
    const { ctx, sent } = fake(scratch(), at(14, 7))
    await beat(name).run(ctx)
    expect(sent).toEqual([{ text: words, to: "optimizer" }])
  })

  test("the worktree sweep sends the optimizer the stale list, never --remove, and nothing when none is stale", async () => {
    const stale = fake(scratch(), at(14, 17), { "optimizer/sweep.py": "stale: pg-1 (merged)" })
    await beat("worktree-sweep").run(stale.ctx)
    expect(stale.sent).toEqual([
      { text: "Worktree sweep (dry): stale: pg-1 (merged)", to: "optimizer" },
    ])
    expect(stale.runs[0]!.includes("--remove")).toBe(false)
    expect(stale.runs[0]).toContain("/repo")
    const quiet = fake(scratch(), at(16, 17))
    await beat("worktree-sweep").run(quiet.ctx)
    expect(quiet.sent).toEqual([])
  })

  test("the worktree sweep sends every line of a long stale list, each send within notify.sh's 400 characters (#1450)", async () => {
    const stale = Array.from(
      { length: 50 },
      (_, i) =>
        `  stale /Users/acme-dev/acme-dev/${OLD.dispatcher}/.claude/worktrees/lm-${1000 + i}-some-chore lm-${1000 + i}`,
    )
    const out = [
      `/Users/acme-dev/acme-dev/${OLD.dispatcher}: 90 worktrees, 50 stale; kept: {'roster': 30}`,
      ...stale,
    ].join("\n")
    const { ctx, sent } = fake(scratch(), at(14, 17), { "optimizer/sweep.py": out })
    await beat("worktree-sweep").run(ctx)
    const got = sent.flatMap((s) => s.text.replace(/^Worktree sweep \(dry\): /, "").split("\n"))
    expect(got).toEqual(out.split("\n").map((line) => line.trimEnd()))
    expect(sent.every((s) => s.to === "optimizer" && s.text.length <= 400)).toBe(true)
  })
})

describe("cycle", () => {
  test("starts only the beats due this minute, once a minute, and names a beat that failed", async () => {
    const ran: string[] = []
    const beats = [
      { cron: "*/5 * * * *", name: "five", run: async () => void ran.push("five"), to: "x" },
      { cron: "3 * * * *", name: "three", run: async () => void ran.push("three"), to: "x" },
      {
        cron: "*/5 * * * *",
        name: "broken",
        run: async () => {
          throw new Error("no file")
        },
        to: "x",
      },
    ]
    const state = runner()
    const { ctx } = fake(scratch(), at(13, 5))
    await Promise.all(cycle(ctx, state, beats))
    await Promise.all(cycle({ ...ctx, now: new Date(at(13, 5).getTime() + 20_000) }, state, beats))
    expect(ran).toEqual(["five"])
    expect(resultOf(state)).toBe("broken: no file")
  })
})

describe("canary pull", () => {
  // A real git: an origin, a clone on main with two canary-side worktrees (one clean, one with an open change) and one on another branch, then a commit on origin's canary.
  const git = (cwd: string, ...args: string[]) => {
    const proc = Bun.spawnSync(["git", "-C", cwd, ...args], { stderr: "pipe", stdout: "pipe" })
    if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`)
    return proc.stdout.toString().trim()
  }
  const realRun: Context["run"] = async (argv) => {
    const proc = Bun.spawnSync(argv, { stderr: "pipe", stdout: "pipe" })
    return { code: proc.exitCode ?? 1, out: proc.stdout.toString() + proc.stderr.toString() }
  }
  const world = () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "canary-pull-")))
    dirs.push(root)
    const seed = join(root, "seed")
    mkdirSync(seed)
    git(seed, "init", "-q", "-b", "main")
    git(
      seed,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "one",
    )
    git(seed, "branch", "canary")
    const origin = join(root, "origin.git")
    git(root, "clone", "-q", "--bare", seed, origin)
    const repo = join(root, "repo")
    git(root, "clone", "-q", origin, repo)
    const leads = join(repo, ".claude", "worktrees", "leads")
    git(repo, "worktree", "add", "-q", "-b", "canary", leads, "origin/canary")
    git(leads, "branch", "-q", "--set-upstream-to", "origin/canary")
    const other = join(repo, ".claude", "worktrees", "other")
    git(repo, "worktree", "add", "-q", "-b", "pg-1-x", other, "origin/canary")
    git(seed, "checkout", "-q", "canary")
    git(
      seed,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "two",
    )
    git(seed, "push", "-q", origin, "canary")
    return { leads, origin, other, repo, root, seed }
  }

  test("fast-forwards a clean canary worktree to origin's head and leaves every other branch as it is", async () => {
    const w = world()
    const before = git(w.other, "rev-parse", "HEAD")
    const { ctx, sent } = fake(scratch(), at(14, 5))
    await beat("canary-pull").run({ ...ctx, repo: w.repo, run: realRun })
    expect(git(w.leads, "rev-parse", "HEAD")).toBe(git(w.origin, "rev-parse", "canary"))
    expect(git(w.other, "rev-parse", "HEAD")).toBe(before)
    expect(sent).toEqual([])
  })

  test("fast-forwards a clean leads worktree to the origin branch it tracks, main on a public install", async () => {
    const w = world()
    const leads = join(w.repo, ".claude", "worktrees", "public-leads")
    git(w.repo, "worktree", "add", "-q", "--track", "-B", "leads", leads, "origin/main")
    git(w.seed, "checkout", "-q", "main")
    git(
      w.seed,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "three",
    )
    git(w.seed, "push", "-q", w.origin, "main")
    const { ctx, sent } = fake(scratch(), at(14, 5))
    await beat("canary-pull").run({ ...ctx, repo: w.repo, run: realRun })
    expect(git(leads, "rev-parse", "HEAD")).toBe(git(w.origin, "rev-parse", "main"))
    expect(sent).toEqual([])
  })

  test("leaves a canary worktree holding an open change as it is, and says nothing", async () => {
    const w = world()
    const before = git(w.leads, "rev-parse", "HEAD")
    writeFileSync(join(w.leads, "draft.txt"), "open")
    const { ctx, sent } = fake(scratch(), at(14, 10))
    await beat("canary-pull").run({ ...ctx, repo: w.repo, run: realRun })
    expect(git(w.leads, "rev-parse", "HEAD")).toBe(before)
    expect(sent).toEqual([])
  })

  test("names a pull that cannot fast-forward to ops", async () => {
    const w = world()
    git(
      w.leads,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "local",
    )
    const { ctx, sent } = fake(scratch(), at(14, 15))
    await beat("canary-pull").run({ ...ctx, repo: w.repo, run: realRun })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe("ops")
    expect(sent[0]!.text).toStartWith(`canary-pull: ${w.leads} did not fast-forward:`)
  })

  test("names the same failed pull once, and again after the worktree has pulled and failed anew", async () => {
    const w = world()
    git(
      w.leads,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "local",
    )
    const ops = scratch()
    const first = fake(ops, at(14, 15))
    await beat("canary-pull").run({ ...first.ctx, repo: w.repo, run: realRun })
    const second = fake(ops, at(14, 20))
    await beat("canary-pull").run({ ...second.ctx, repo: w.repo, run: realRun })
    expect(first.sent).toHaveLength(1)
    expect(second.sent).toEqual([])
    git(w.leads, "reset", "-q", "--hard", "origin/canary")
    const pulled = fake(ops, at(14, 25))
    await beat("canary-pull").run({ ...pulled.ctx, repo: w.repo, run: realRun })
    expect(pulled.sent).toEqual([])
    expect(existsSync(join(ops, "tick", "canary-pull-told.json"))).toBe(true)
    expect(JSON.parse(readFileSync(join(ops, "tick", "canary-pull-told.json"), "utf8"))).toEqual({})
    git(
      w.leads,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "again",
    )
    git(
      w.seed,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "three",
    )
    git(w.seed, "push", "-q", w.origin, "canary")
    const anew = fake(ops, at(14, 30))
    await beat("canary-pull").run({ ...anew.ctx, repo: w.repo, run: realRun })
    expect(anew.sent).toHaveLength(1)
  })

  test("keeps no mark for a failed pull whose line was not queued, so the next beat names it", async () => {
    const w = world()
    git(
      w.leads,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "local",
    )
    const ops = scratch()
    const lost = fake(ops, at(14, 15))
    await beat("canary-pull").run({
      ...lost.ctx,
      repo: w.repo,
      run: realRun,
      send: async () => false,
    })
    const next = fake(ops, at(14, 20))
    await beat("canary-pull").run({ ...next.ctx, repo: w.repo, run: realRun })
    expect(next.sent).toHaveLength(1)
  })

  // git runs for real; run-slot.sh is stubbed, its argv recorded and its exit code given.
  const slotted = (code = 0) => {
    const installs: string[][] = []
    const run: Context["run"] = async (argv, timeoutMs, stdin) => {
      if (!argv[0]!.endsWith("run-slot.sh")) return realRun(argv, timeoutMs, stdin)
      installs.push(argv)
      return { code, out: code ? "error: lockfile had changes, but lockfile is frozen" : "" }
    }
    return { installs, run }
  }
  const pushLock = (w: ReturnType<typeof world>, file = "bun.lock") => {
    mkdirSync(dirname(join(w.seed, file)), { recursive: true })
    writeFileSync(join(w.seed, file), "{}")
    git(w.seed, "add", file)
    git(w.seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "lock")
    git(w.seed, "push", "-q", w.origin, "canary")
  }

  test("installs through run-slot in a worktree whose pull changed bun.lock (#1628)", async () => {
    const w = world()
    pushLock(w)
    const ops = scratch()
    const { installs, run } = slotted()
    const { ctx, sent } = fake(ops, at(14, 5))
    await beat("canary-pull").run({ ...ctx, repo: w.repo, run })
    expect(installs).toEqual([
      [
        join(ops, "run-slot.sh"),
        "ops-tick",
        "--",
        "bun",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--cwd",
        w.leads,
      ],
    ])
    expect(sent).toEqual([])
  })

  test("installs in a worktree whose pull changed a nested package.json alone", async () => {
    const w = world()
    pushLock(w, "web/next/package.json")
    const { installs, run } = slotted()
    const { ctx } = fake(scratch(), at(14, 5))
    await beat("canary-pull").run({ ...ctx, repo: w.repo, run })
    expect(installs).toHaveLength(1)
  })

  test("runs no install for a pull that changed no bun.lock or package.json", async () => {
    const w = world()
    const { installs, run } = slotted()
    const { ctx } = fake(scratch(), at(14, 5))
    await beat("canary-pull").run({ ...ctx, repo: w.repo, run })
    expect(git(w.leads, "rev-parse", "HEAD")).toBe(git(w.origin, "rev-parse", "canary"))
    expect(installs).toEqual([])
  })

  test("names a failed install to ops", async () => {
    const w = world()
    pushLock(w)
    const { run } = slotted(1)
    const { ctx, sent } = fake(scratch(), at(14, 5))
    await beat("canary-pull").run({ ...ctx, repo: w.repo, run })
    expect(sent).toEqual([
      {
        text: `canary-pull: ${w.leads} did not install: error: lockfile had changes, but lockfile is frozen`,
        to: "ops",
      },
    ])
  })

  test("retries a failed install on the next beat with nothing pulled, until one exits 0", async () => {
    const w = world()
    pushLock(w)
    const ops = scratch()
    await beat("canary-pull").run({
      ...fake(ops, at(14, 5)).ctx,
      repo: w.repo,
      run: slotted(1).run,
    })
    const retry = slotted()
    await beat("canary-pull").run({ ...fake(ops, at(14, 10)).ctx, repo: w.repo, run: retry.run })
    expect(retry.installs).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(ops, "tick", "canary-pull-told.json"), "utf8"))).toEqual({})
    const after = slotted()
    await beat("canary-pull").run({ ...fake(ops, at(14, 15)).ctx, repo: w.repo, run: after.run })
    expect(after.installs).toEqual([])
  })
})

describe("relay watch", () => {
  const ID = "f167b6b9-f570-4f15-a4b4-eb15b8c4876f"

  // The relay's outbox with its three cursors last moved at moved, and the ops manager in the roster.
  const outbox = (ops: string, moved: Date) => {
    mkdirSync(join(ops, "outbox"), { recursive: true })
    for (const file of ["cursor.json", "dm-cursor.json", "linear-cursor.json"]) {
      writeFileSync(join(ops, "outbox", file), "{}")
      utimesSync(join(ops, "outbox", file), moved, moved)
    }
    writeFileSync(
      join(ops, "..", "roster.json"),
      JSON.stringify({ agents: [{ kind: "ops", name: OLD.ops, role: "manager" }] }),
    )
  }

  // A context whose runs answer wait.py's peek and bun run ask by argv, recording each bun run ask call with its stdin.
  const watch = (ops: string, now: Date, peek: string, code = 0) => {
    const asks: { argv: string[]; stdin?: string }[] = []
    const { ctx, sent } = fake(ops, now)
    ctx.run = async (argv, _timeoutMs, stdin) => {
      if (argv.join(" ").includes("wait.py")) return { code: 0, out: peek }
      asks.push({ argv, stdin })
      return { code, out: `$ bun api/hono/src/bin/dashboard-ask.ts new\n${ID}\n#i601\n` }
    }
    return { asks, ctx, sent }
  }

  test("posts one Inbox alert once a line has waited past two cycles with no relay cursor moving, and resolves it once a cursor moves", async () => {
    const ops = scratch()
    outbox(ops, at(14, 7))
    const seen = watch(ops, at(14, 20), "pending: ops-unstick.jsonl")
    await beat("relay-watch").run(seen.ctx)
    expect(seen.asks).toEqual([])
    const waiting = watch(ops, at(14, 25), "pending: ops-unstick.jsonl")
    await beat("relay-watch").run(waiting.ctx)
    expect(waiting.asks).toEqual([])
    const first = watch(ops, at(14, 30), "pending: ops-unstick.jsonl")
    await beat("relay-watch").run(first.ctx)
    expect(first.asks).toHaveLength(1)
    expect(first.asks[0]!.argv).toEqual(["bun", "run", "--cwd", "/repo", "ask", "new"])
    expect(JSON.parse(first.asks[0]!.stdin!)).toEqual({
      from: OLD.ops,
      kind: "update",
      preview: { outcome: "alert" },
      title: `The ops relay is down: no ops line has gone out since ${at(14, 7)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z")}. Resume runner-plain-relay.`,
    })
    expect(first.sent).toEqual([])
    const still = watch(ops, at(14, 35), "pending: ops-unstick.jsonl")
    await beat("relay-watch").run(still.ctx)
    expect(still.asks).toEqual([])
    outbox(ops, at(14, 38))
    const back = watch(ops, at(14, 40), "timeout")
    await beat("relay-watch").run(back.ctx)
    expect(back.asks.map((a) => a.argv.slice(4))).toEqual([
      [
        "ask",
        "resolve",
        ID,
        "--by",
        OLD.ops,
        "--note",
        `The relay moved its cursor again at ${at(14, 38)
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z")}`,
      ],
    ])
    expect(existsSync(join(ops, "tick", "relay-watch.json"))).toBe(false)
  })

  test("posts nothing while nothing waits, and times the wait itself, not the cursors' age", async () => {
    const ops = scratch()
    outbox(ops, at(14, 7))
    const quiet = watch(ops, at(15, 0), "timeout")
    await beat("relay-watch").run(quiet.ctx)
    expect(quiet.asks).toEqual([])
    const lands = watch(ops, at(15, 5), "pending: ops-sweep.jsonl")
    await beat("relay-watch").run(lands.ctx)
    expect(lands.asks).toEqual([])
    const gone = watch(ops, at(15, 10), "timeout")
    await beat("relay-watch").run(gone.ctx)
    const again = watch(ops, at(15, 15), "pending: ops-sweep.jsonl")
    await beat("relay-watch").run(again.ctx)
    const late = watch(ops, at(15, 20), "pending: ops-sweep.jsonl")
    await beat("relay-watch").run(late.ctx)
    expect([gone.asks, again.asks, late.asks]).toEqual([[], [], []])
  })

  test("a cursor that moves while a line waits starts the wait over", async () => {
    const ops = scratch()
    outbox(ops, at(14, 7))
    await beat("relay-watch").run(watch(ops, at(14, 20), "pending: a.jsonl").ctx)
    outbox(ops, at(14, 27))
    const moved = watch(ops, at(14, 30), "pending: b.jsonl")
    await beat("relay-watch").run(moved.ctx)
    const early = watch(ops, at(14, 35), "pending: b.jsonl")
    await beat("relay-watch").run(early.ctx)
    expect([moved.asks, early.asks]).toEqual([[], []])
    const due = watch(ops, at(14, 40), "pending: b.jsonl")
    await beat("relay-watch").run(due.ctx)
    expect(due.asks).toHaveLength(1)
  })

  test("a post or a resolve that fails throws for the heartbeat and keeps its state, so the next cycle tries again", async () => {
    const ops = scratch()
    outbox(ops, at(14, 7))
    await beat("relay-watch").run(watch(ops, at(14, 20), "pending: ops-unstick.jsonl").ctx)
    const refused = watch(ops, at(14, 30), "pending: ops-unstick.jsonl", 1)
    await expect(beat("relay-watch").run(refused.ctx)).rejects.toThrow("bun run ask new")
    expect(
      JSON.parse(readFileSync(join(ops, "tick", "relay-watch.json"), "utf8")).id,
    ).toBeUndefined()
    const posted = watch(ops, at(14, 35), "pending: ops-unstick.jsonl")
    await beat("relay-watch").run(posted.ctx)
    expect(posted.asks).toHaveLength(1)
    outbox(ops, at(14, 38))
    const stuck = watch(ops, at(14, 40), "timeout", 1)
    await expect(beat("relay-watch").run(stuck.ctx)).rejects.toThrow(`bun run ask resolve ${ID}`)
    expect(JSON.parse(readFileSync(join(ops, "tick", "relay-watch.json"), "utf8")).id).toBe(ID)
  })

  test("an alert whose item is gone counts as resolved, so the next outage is reported", async () => {
    const ops = scratch()
    outbox(ops, at(14, 7))
    await beat("relay-watch").run(watch(ops, at(14, 20), "pending: ops-unstick.jsonl").ctx)
    await beat("relay-watch").run(watch(ops, at(14, 30), "pending: ops-unstick.jsonl").ctx)
    outbox(ops, at(14, 38))
    const gone = watch(ops, at(14, 40), "timeout")
    gone.ctx.run = async (argv) =>
      argv.join(" ").includes("wait.py")
        ? { code: 0, out: "timeout" }
        : { code: 1, out: `dashboard-ask: no inbox item ${ID}\n` }
    await beat("relay-watch").run(gone.ctx)
    expect(existsSync(join(ops, "tick", "relay-watch.json"))).toBe(false)
    await beat("relay-watch").run(watch(ops, at(15, 0), "pending: ops-unstick.jsonl").ctx)
    const next = watch(ops, at(15, 10), "pending: ops-unstick.jsonl")
    await beat("relay-watch").run(next.ctx)
    expect(next.asks).toHaveLength(1)
  })
})

describe("the relay's own resume", () => {
  const UP = "/m/scripts/spawn.sh resume runner-plain-relay /m 7777 --backend claude"
  const RUN = [...UP.split(" "), "--brief", "brief-runner-plain-relay.md"]

  test("runs the relay's resume line itself rather than queueing it for the relay, once, and tells ops", async () => {
    const ops = scratch()
    writeFileSync(join(ops, "..", "roster.json"), JSON.stringify({ agents: [] }))
    writeFileSync(
      join(ops, "ops-linear-dm.json"),
      JSON.stringify({ lastBeatAt: at(14, 7).toISOString(), lastResult: "ok" }),
    )
    const { ctx, runs, sent } = fake(ops, at(14, 7), { ...QUIET_LOAD, "--sessions": UP })
    await beat("sweep").run(ctx)
    expect(runs).toContainEqual(RUN)
    expect(sent).toEqual([{ text: `Resumed runner-plain-relay: ${UP}`, to: "ops" }])
    const up = fake(ops, at(14, 37), QUIET_LOAD)
    await beat("sweep").run(up.ctx)
    expect(up.runs).not.toContainEqual(RUN)
  })

  test("the same resume line returns with the next outage and runs again, since a resume keeps the session id", async () => {
    const ops = scratch()
    writeFileSync(join(ops, "..", "roster.json"), JSON.stringify({ agents: [] }))
    writeFileSync(
      join(ops, "ops-linear-dm.json"),
      JSON.stringify({ lastBeatAt: at(14, 7).toISOString(), lastResult: "ok" }),
    )
    await beat("sweep").run(fake(ops, at(14, 7), { ...QUIET_LOAD, "--sessions": UP }).ctx)
    await beat("sweep").run(fake(ops, at(14, 37), QUIET_LOAD).ctx)
    const next = fake(ops, at(15, 7), { ...QUIET_LOAD, "--sessions": UP })
    await beat("sweep").run(next.ctx)
    expect(next.runs).toContainEqual(RUN)
  })

  test("a resume that fails is named to ops and runs again at the next sweep", async () => {
    const ops = scratch()
    writeFileSync(join(ops, "..", "roster.json"), JSON.stringify({ agents: [] }))
    writeFileSync(
      join(ops, "ops-linear-dm.json"),
      JSON.stringify({ lastBeatAt: at(14, 7).toISOString(), lastResult: "ok" }),
    )
    const refuse = (f: ReturnType<typeof fake>) => {
      const run = f.ctx.run
      f.ctx.run = async (argv, timeoutMs) =>
        argv[1] === "resume"
          ? { code: 2, out: "spawn.sh: refused: load 40 over 16\n" }
          : run(argv, timeoutMs)
      return f
    }
    const first = refuse(fake(ops, at(14, 7), { ...QUIET_LOAD, "--sessions": UP }))
    await beat("sweep").run(first.ctx)
    expect(first.sent).toEqual([
      {
        text: "Felled runner-plain-relay; its resume failed (exit 2): spawn.sh: refused: load 40 over 16",
        to: "ops",
      },
    ])
    const next = fake(ops, at(14, 37), { ...QUIET_LOAD, "--sessions": UP })
    await beat("sweep").run(next.ctx)
    expect(next.runs).toContainEqual(RUN)
  })
})

test("the switch watch reads no account on a machine with no extensions, so it stays quiet", async () => {
  const data = mkdtempSync(join(tmpdir(), "ops-tick-switch-"))
  expect(await switchAccount(join(data, "ops"))).toBe("")
  rmSync(data, { force: true, recursive: true })
})

test("the worktree sweep takes each git checkout in the home folder's folder for an org ext.links guards, and none with no extensions", async () => {
  const ops = scratch()
  const home = mkdtempSync(join(tmpdir(), "ops-tick-home-"))
  dirs.push(home)
  for (const dir of ["acme-co/web/.git", "acme-co/notes", "other/api/.git"])
    mkdirSync(join(home, dir), { recursive: true })
  expect(await sweepRepos(ops, home)).toEqual([])
  storeWith(join(ops, ".."), {}, { "ext.links": { acme: ["acme-co"] } })
  expect(await sweepRepos(ops, home)).toEqual([join(home, "acme-co", "web")])
})
