import { describe, expect, test } from "bun:test"

import {
  addCommand,
  extraWordRefusal,
  HELP,
  planStart,
  rollOutcome,
  runStart,
  runStatus,
  statusLines,
  VIEW_HINT,
  dashboardBeatOf,
  waitOutcome,
  wantsHelp,
  type DashboardBeat,
  type Probes,
} from "../../../../../packages/scripts/src/playground/plan"

const UP: Probes = {
  api: true,
  dispatchers: [{ backend: "claude", name: "dispatcher" }],
  follower: true,
  glm: true,
  terminal: true,
  web: true,
}

describe("planStart", () => {
  test("only opens the Dashboard when everything runs", () => {
    expect(planStart(UP)).toEqual(["open"])
  })

  test("starts the jobs and waits when the Dashboard's API is down", () => {
    expect(planStart({ ...UP, api: false })).toEqual(["jobs", "wait", "open"])
  })

  test("starts the dispatcher when no dispatcher session is live", () => {
    expect(planStart({ ...UP, dispatchers: [] })).toEqual(["dispatcher", "open"])
  })

  test("a second dispatcher alone does not count as the lead", () => {
    expect(
      planStart({
        ...UP,
        dispatchers: [{ backend: "glm", name: "dispatcher-2" }],
      }),
    ).toEqual(["dispatcher", "open"])
  })

  test("starts both on a machine with nothing running", () => {
    expect(
      planStart({
        ...UP,
        api: false,
        dispatchers: [],
        follower: false,
        web: false,
      }),
    ).toEqual(["jobs", "dispatcher", "wait", "open"])
  })

  test("a follower alone down starts nothing, since the dashboard's supervisor restarts it", () => {
    expect(planStart({ ...UP, follower: false })).toEqual(["open"])
  })
})

describe("runStart", () => {
  test("starts herdr before the Dashboard's steps, which stop with no live/desk checkout", async () => {
    const order: string[] = []
    const run = runStart(
      async () => {
        order.push("herdr")
        return 0
      },
      async () => {
        order.push("dashboard")
        throw new Error("no checkout of the repo is on branch live/desk")
      },
    )
    await expect(run).rejects.toThrow("live/desk")
    expect(order).toEqual(["herdr", "dashboard"])
  })

  test("runs the Dashboard's steps after a herdr start that failed, and exits 1 when either failed", async () => {
    const order: string[] = []
    const step = (name: string, code: number) => async () => {
      order.push(name)
      return code
    }
    expect(await runStart(step("herdr", 1), step("dashboard", 0))).toBe(1)
    expect(order).toEqual(["herdr", "dashboard"])
    expect(await runStart(step("herdr", 0), step("dashboard", 1))).toBe(1)
    expect(await runStart(step("herdr", 0), step("dashboard", 0))).toBe(0)
  })
})

describe("runStatus", () => {
  test("prints herdr's lines before the Dashboard's part, which stops with no live/desk checkout", async () => {
    const order: string[] = []
    const run = runStatus(
      async () => {
        order.push("herdr")
        return 0
      },
      async () => {
        order.push("dashboard")
        throw new Error("no checkout of the repo is on branch live/desk")
      },
    )
    await expect(run).rejects.toThrow("live/desk")
    expect(order).toEqual(["herdr", "dashboard"])
  })

  test("exits as herdr's status did, once the Dashboard's lines are printed", async () => {
    const order: string[] = []
    const code = await runStatus(
      async () => {
        order.push("herdr")
        return 1
      },
      async () => {
        order.push("dashboard")
      },
    )
    expect(code).toBe(1)
    expect(order).toEqual(["herdr", "dashboard"])
  })
})

describe("statusLines", () => {
  test("everything running", () => {
    expect(statusLines(UP, "cmux terminal")).toEqual([
      "In a cmux terminal: yes",
      "Dashboard web: up",
      "Dashboard API: up",
      "Session follower: running",
      "Dispatcher on Claude: running",
      "GLM: set up",
    ])
  })

  test("everything down, outside the terminal, with no GLM", () => {
    expect(
      statusLines(
        {
          api: false,
          dispatchers: [],
          follower: false,
          glm: false,
          terminal: false,
          web: false,
        },
        "cmux terminal",
      ),
    ).toEqual([
      "In a cmux terminal: no",
      "Dashboard web: down",
      "Dashboard API: down",
      "Session follower: stopped",
      "Dispatcher: not running",
      "GLM: not set up",
    ])
  })

  test("names each dispatcher by the model it runs, the lead first", () => {
    expect(
      statusLines(
        {
          ...UP,
          dispatchers: [
            { backend: "glm", name: "dispatcher-2" },
            { backend: "claude", name: "dispatcher" },
          ],
        },
        "cmux terminal",
      ).filter((line) => line.startsWith("Dispatcher")),
    ).toEqual(["Dispatcher on Claude: running", "Dispatcher on GLM: running"])
  })

  test("a second dispatcher with no lead still says the lead is not running", () => {
    expect(
      statusLines(
        { ...UP, dispatchers: [{ backend: null, name: "dispatcher-2" }] },
        "cmux terminal",
      ).filter((line) => line.startsWith("Dispatcher")),
    ).toEqual(["Dispatcher: not running", "Dispatcher on an unknown model: running"])
  })
})

describe("addCommand", () => {
  const all = () => true
  // The --model list models.claude sets, at its default.
  const MODELS = ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"]
  const pick = (kind: string) => `${kind}-brave-otter`

  test("a worker- name is used as given, as a worker on the fixed new-worker brief", () => {
    expect(addCommand(["worker-brave-otter"], all, pick, MODELS)).toEqual({
      argv: ["worker", "worker-brave-otter", "handoffs/new-worker.md"],
      started: "Started worker-brave-otter",
    })
  })

  test("with no name, takes a worker's name from the picker", () => {
    expect(addCommand([], all, pick, MODELS)).toEqual({
      argv: ["worker", "worker-brave-otter", "handoffs/new-worker.md"],
      started: "Started worker-brave-otter",
    })
  })

  // spawn.sh refuses a worker with no title, so add passes the one it is given.
  test("passes --title to spawn.sh as given", () => {
    expect(
      addCommand(["--title", "Fix the CSV export", "worker-brave-otter"], all, pick, MODELS),
    ).toEqual({
      argv: [
        "worker",
        "worker-brave-otter",
        "handoffs/new-worker.md",
        "--title",
        "Fix the CSV export",
      ],
      started: "Started worker-brave-otter",
    })
  })

  test("--kind runner starts a runner, its name picked for that kind", () => {
    expect(addCommand(["--kind", "runner", "--brief", "b-x.md"], all, pick, MODELS)).toEqual({
      argv: ["runner", "runner-brave-otter", "b-x.md"],
      started: "Started runner-brave-otter",
    })
  })

  test("an <id>-<kind> name is used as given (#966)", () => {
    expect(addCommand(["k3m9px-worker"], all, pick, MODELS)).toEqual({
      argv: ["worker", "k3m9px-worker", "handoffs/new-worker.md"],
      started: "Started k3m9px-worker",
    })
  })

  test("--kind runner with a name uses the name as given", () => {
    expect(addCommand(["--kind", "runner", "runner-calm-owl"], all, pick, MODELS)).toEqual({
      argv: ["runner", "runner-calm-owl", "handoffs/new-worker.md"],
      started: "Started runner-calm-owl",
    })
  })

  test("a model models.claude adds is one --model takes, and one it lacks is refused", () => {
    const added = [...MODELS, "claude-opus-6"]
    expect(
      "argv" in addCommand(["worker-otter", "--model", "claude-opus-6"], all, pick, added),
    ).toBe(true)
    expect(
      addCommand(["worker-otter", "--model", "claude-opus-6"], all, pick, ["claude-opus-5-5"]),
    ).toEqual({
      error: "--model takes claude-opus-5-5, not claude-opus-6",
    })
  })

  test("passes --brief, --model and --backend as spawn.sh takes them", () => {
    expect(
      addCommand(
        [
          "worker-otter",
          "--brief",
          "b-920.md",
          "--model",
          "claude-fable-5-1",
          "--backend",
          "claude",
        ],
        all,
        pick,
        MODELS,
      ),
    ).toEqual({
      argv: [
        "worker",
        "worker-otter",
        "b-920.md",
        "--model",
        "claude-fable-5-1",
        "--backend",
        "claude",
      ],
      started: "Started worker-otter",
    })
  })

  test("--dispatcher starts sessions.names' dispatcher with -2 on GLM", () => {
    expect(addCommand(["--dispatcher", "--backend", "glm"], all, pick, MODELS)).toEqual({
      argv: ["manager", "dispatcher-2", "brief-dispatcher-2.md", "--backend", "glm"],
      started: "Started a second dispatcher on GLM",
    })
  })

  test.each([
    [["--manager", "builder"], "--manager is not ready yet"],
    [
      ["otter", "--model", "claude-opus-4"],
      "--model takes claude-opus-5-5, claude-fable-5-1, claude-sonnet-5-5 or claude-haiku-5-5, not claude-opus-4",
    ],
    [["otter", "--backend", "gpt"], "--backend takes claude or glm, not gpt"],
    [
      ["k3m9px-runner"],
      "k3m9px-runner reads as a runner, not a worker: bun run name worker gives one",
    ],
    [
      ["--kind", "runner", "worker-calm-owl"],
      "worker-calm-owl reads as a worker, not a runner: bun run name runner gives one",
    ],
    [["otter"], "otter gives no kind: bun run name worker gives one"],
    [["--kind", "runner", "calm-owl"], "calm-owl gives no kind: bun run name runner gives one"],
    [["Otter"], "a name is lowercase words joined by hyphens, not Otter"],
    [["otter", "extra"], "playground add takes one name, not extra"],
    [["otter", "--force"], "playground add takes no --force"],
    [["--dispatcher", "--brief", "x.md"], "--dispatcher takes --backend alone"],
    [["--kind", "researcher"], "--kind takes worker or runner, not researcher"],
    [["--dispatcher", "--kind", "runner"], "--dispatcher takes --backend alone"],
    [["--dispatcher", "--title", "Plain work"], "--dispatcher takes --backend alone"],
    [
      ["--dispatcher"],
      "a second dispatcher runs on --backend glm, since on Claude it needs a second account",
    ],
    [
      ["--dispatcher", "--backend", "claude"],
      "a second dispatcher runs on --backend glm, since on Claude it needs a second account",
    ],
    [["otter", "--brief"], "--brief needs a value"],
  ])("refuses %j", (args, error) => {
    expect(addCommand(args, all, pick, MODELS)).toEqual({ error })
  })

  test.each([
    "/Users/someone/.playground/handoffs/b-x.md",
    "~/.playground/handoffs/b-x.md",
    "/etc/hosts",
    "../x.md",
  ])("a given brief %s goes to spawn.sh as typed, for its one brief rule (#1546)", (brief) => {
    expect(addCommand(["worker-otter", "--brief", brief], () => false, pick, MODELS)).toEqual({
      argv: ["worker", "worker-otter", brief],
      started: "Started worker-otter",
    })
  })

  test("refuses a brief that is not a file", () => {
    expect(addCommand(["worker-otter"], () => false, pick, MODELS)).toEqual({
      error: "~/.playground/handoffs/new-worker.md is missing: run scripts/link-skills.sh",
    })
  })
})

describe("rollOutcome", () => {
  test("reads nothing yet as still building", () => {
    expect(rollOutcome([], [])).toEqual({ phase: "building" })
  })

  test("reads the roll's start as switching", () => {
    expect(rollOutcome(["2026-10-18T02:00:00Z roll-now: rolling to abc1234 at once"], [])).toEqual({
      phase: "switching",
    })
  })

  test("reads a passing roll as updated, with its sha", () => {
    expect(
      rollOutcome(
        [],
        [
          "2026-10-18T02:03:00Z ROLL canary abc1234 (roll-now) abc1234 PASS version=abc1234 verify=PASS approvals=blank follower=running",
        ],
      ),
    ).toEqual({ done: "Updated to abc1234", ok: true })
  })

  const FAILED =
    "2026-10-18T02:03:00Z ROLL canary def5678 (roll-now) def5678 FAIL dev=DOWN (dev: refusing to start: x)"

  test("reads a failing roll as going back until the fallback's result lands", () => {
    expect(rollOutcome([], [FAILED])).toEqual({ phase: "going back" })
  })

  test("reads a failing roll and a passing fallback as failed, back on the build before", () => {
    expect(
      rollOutcome(
        [],
        [FAILED, "2026-10-18T02:05:00Z FALLBACK abc1234 PASS version=abc1234 verify=PASS"],
      ),
    ).toEqual({
      done: "Failed: dev=DOWN (dev: refusing to start: x); back on abc1234",
      ok: false,
    })
  })

  test("reads a refused roll by its own refusing line, which follows roll_up's FAIL, so its count reaches the report (#1357)", () => {
    expect(
      rollOutcome(
        [],
        [
          "2026-10-18T02:03:00Z ROLL canary def5678 (roll-now) def5678 FAIL dev=DOWN (dev: refusing to start: x) follower=running",
          "2026-10-18T02:03:01Z ROLL canary def5678 (roll-now) def5678 FAIL dev refusing: x (refusal 1 of 3, no bad build)",
          "2026-10-18T02:05:00Z FALLBACK abc1234 PASS version=abc1234 verify=PASS",
        ],
      ),
    ).toEqual({
      done: "Failed: dev refusing: x (refusal 1 of 3, no bad build); back on abc1234",
      ok: false,
    })
  })

  test("reads a failing fallback as failed twice", () => {
    expect(
      rollOutcome([], [FAILED, "2026-10-18T02:05:00Z FALLBACK abc1234 FAIL dev=DOWN (dev: y)"]),
    ).toEqual({
      done: "Failed: dev=DOWN (dev: refusing to start: x); going back to abc1234 failed too",
      ok: false,
    })
  })

  test("reads a failing roll after a migration as failed, left on the new build", () => {
    expect(
      rollOutcome(
        [],
        [
          "2026-10-18T02:03:00Z ROLL canary def5678 (roll-now) (install migrate ) def5678 FAIL dev=DOWN (dev: x)",
        ],
      ),
    ).toEqual({
      done: "Failed: dev=DOWN (dev: x); it changed the database, so the Dashboard stays on def5678",
      ok: false,
    })
  })

  test("reads a roll the supervisor would not start as failed", () => {
    expect(
      rollOutcome([], ["2026-10-18T02:01:00Z ANOMALY stop left processes alive; not rolling"]),
    ).toEqual({ done: "Failed: stop left processes alive; not rolling", ok: false })
  })

  test("reads nothing new to build as already up to date", () => {
    expect(rollOutcome([], ["2026-10-18T02:01:00Z CURRENT abc1234"])).toEqual({
      done: "Already up to date at abc1234",
      ok: true,
    })
  })

  test("reads a head whose roll failed before as failed", () => {
    expect(
      rollOutcome(
        [],
        ["2026-10-18T02:01:00Z SKIP def5678 FAIL def5678 failed its roll before (bad-builds)"],
      ),
    ).toEqual({ done: "Failed: def5678 failed its roll before (bad-builds)", ok: false })
  })

  test("ignores an unrelated result line", () => {
    expect(rollOutcome([], ["2026-10-18T02:01:00Z RESTART follower follower=running"])).toEqual({
      phase: "building",
    })
  })
})

describe("wantsHelp", () => {
  test("--help, -h or help as the command asks for the help", () => {
    for (const command of ["--help", "-h", "help"]) expect(wantsHelp([command])).toBe(true)
  })

  test("--help or -h after any command asks for the help, so update --help never rolls", () => {
    expect(wantsHelp(["update", "--help"])).toBe(true)
    expect(wantsHelp(["add", "worker-x", "-h"])).toBe(true)
    expect(wantsHelp(["status", "-h"])).toBe(true)
  })

  test("a plain command, or none, is not a help ask", () => {
    expect(wantsHelp([])).toBe(false)
    expect(wantsHelp(["update"])).toBe(false)
    expect(wantsHelp(["add", "worker-help"])).toBe(false)
  })
})

describe("playground view", () => {
  test("help names view, herdr in start and status, and the hint bare dispatcher ends with names it", () => {
    expect(HELP).toContain("playground view       open the factory herdr server")
    expect(HELP).toContain("start herdr's servers that are down and restore their sessions")
    expect(HELP).toContain("each herdr server")
    expect(HELP).toContain("in cmux while a session is open there, else in herdr")
    expect(VIEW_HINT).toContain("playground view")
  })

  test("view takes no word, with its usage line; add keeps its options; the rest take none", () => {
    expect(extraWordRefusal(["view"])).toBeNull()
    expect(extraWordRefusal(["view", "probes"])).toBe(
      "playground view takes no probes\nusage: playground view",
    )
    expect(extraWordRefusal(["add", "--kind", "runner"])).toBeNull()
    expect(extraWordRefusal(["status", "now"])).toBe(
      "playground status takes no now\nusage: playground status",
    )
    expect(extraWordRefusal([])).toBeNull()
  })

  test("update takes --to and a tag, or nothing", () => {
    expect(extraWordRefusal(["update", "--to", "v0.0.20"])).toBeNull()
    expect(extraWordRefusal(["update", "--to"])).toBe("usage: playground update [--to <tag>]")
    for (const words of [
      ["update", "now"],
      ["update", "--to", "v1", "now"],
    ])
      expect(extraWordRefusal(words)).toBe(
        "playground update takes no now\nusage: playground update [--to <tag>]",
      )
  })

  test("alerts-wait takes exactly one name, and picker takes its session, answer, key and reason", () => {
    expect(extraWordRefusal(["alerts-wait", "builder"])).toBeNull()
    expect(extraWordRefusal(["alerts-wait"])).toBe(
      "usage: playground alerts-wait <name> (your own session's name)",
    )
    expect(extraWordRefusal(["alerts-wait", "builder", "now"])).toBe(
      "playground alerts-wait takes no now\nusage: playground alerts-wait <name>",
    )
    expect(
      extraWordRefusal(["picker", "k3m9px-worker", "deny", "0a1b2c3d", "use", "mv"]),
    ).toBeNull()
  })

  test("sweep takes exactly its lead's name", () => {
    expect(extraWordRefusal(["sweep", "builder"])).toBeNull()
    expect(extraWordRefusal(["sweep"])).toBe("usage: playground sweep <lead> (builder or ops)")
    expect(extraWordRefusal(["sweep", "builder", "now"])).toBe(
      "playground sweep takes no now\nusage: playground sweep <lead>",
    )
  })
})

describe("managing the install", () => {
  test("help names doctor, version, uninstall and update with what each does", () => {
    for (const line of ["doctor ", "version ", "uninstall [--purge]\n", "update "])
      expect(HELP).toContain(`\nplayground ${line}`)
    expect(HELP).toContain("fast-forward this checkout onto origin/main")
  })

  test("update's help names its steps in the order update runs them: link-skills.sh before install, build and the restarts", () => {
    const update = HELP.slice(HELP.indexOf("\nplayground update "))
    const at = (step: string) => update.indexOf(step)
    const order = [
      "fast-forward",
      "link-skills.sh",
      "install when",
      "build packages",
      "restart the ops jobs",
      "roll the Dashboard",
    ]
    expect(order.map(at).every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => at(a) - at(b))).toEqual(order)
  })

  test("help names herdr pin, which takes --check or --asset <file>", () => {
    expect(HELP).toContain("\nplayground herdr pin [--check | --asset <file>]\n")
    expect(extraWordRefusal(["herdr", "pin", "--asset", "/scratch/herdr"])).toBeNull()
  })

  test("uninstall takes --purge alone, and doctor and version take nothing", () => {
    expect(extraWordRefusal(["uninstall"])).toBeNull()
    expect(extraWordRefusal(["uninstall", "--purge"])).toBeNull()
    expect(extraWordRefusal(["uninstall", "--all"])).toBe("usage: playground uninstall [--purge]")
    for (const command of ["doctor", "uninstall --purge", "version"])
      expect(extraWordRefusal([...command.split(" "), "now"])).toStartWith(
        `playground ${command.split(" ")[0]} takes no now\nusage: playground ${command.split(" ")[0]}`,
      )
  })
})

describe("waitOutcome", () => {
  const RUNNING: DashboardBeat = { ageMs: 5_000, cycleSeconds: 60, running: true }
  const at = (now: number, beat: DashboardBeat | null = RUNNING, api = false) =>
    waitOutcome({ api, beat, now }, { shownAt: 0, startedAt: 0 })

  test("ends at once when the API answers", () => {
    expect(at(42_000, RUNNING, true)).toEqual({
      done: "The Dashboard answered after 42s",
      ok: true,
    })
    expect(at(80_000, null, true)).toMatchObject({ ok: true })
  })

  test("ends at the next poll when the supervisor exits mid-wait, naming it and the command", () => {
    expect(at(80_000, { ...RUNNING, running: false })).toEqual({
      done: "ops-dashboard's supervisor is not running, so the Dashboard will not come up (waited 1m 20s); see ops/dashboard/supervisor.log, then run playground again",
      ok: false,
    })
    expect(at(80_000, null)).toMatchObject({ ok: false })
  })

  test("ends when ops-dashboard's heartbeat is older than three of its cycles, naming its age", () => {
    expect(at(200_000, { ...RUNNING, ageMs: 180_001 })).toEqual({
      done: "ops-dashboard's heartbeat is 3m 0s old, past three of its 60s cycles, so its supervisor has stopped; see ops/dashboard/supervisor.log, then run playground again",
      ok: false,
    })
    expect(at(200_000, { ...RUNNING, ageMs: 180_000 })).not.toHaveProperty("done")
  })

  test("gives the supervisor 30s to start before judging its heartbeat", () => {
    expect(at(29_000, null)).not.toHaveProperty("done")
    expect(at(29_000, { ...RUNNING, ageMs: 3_600_000, running: false })).not.toHaveProperty("done")
    expect(at(30_000, null)).toMatchObject({ ok: false })
  })

  test("prints what it waits on and the time spent, at most every 10s", () => {
    expect(at(10_000)).toEqual({ progress: "Waiting for the Dashboard's API to answer… 10s" })
    expect(
      waitOutcome({ api: false, beat: RUNNING, now: 75_000 }, { shownAt: 70_000, startedAt: 0 }),
    ).toEqual({ progress: null })
    expect(
      waitOutcome({ api: false, beat: RUNNING, now: 80_000 }, { shownAt: 70_000, startedAt: 0 }),
    ).toEqual({ progress: "Waiting for the Dashboard's API to answer… 1m 20s" })
  })

  test("ends after 15 minutes, as before", () => {
    expect(at(15 * 60_000)).toEqual({
      done: "the Dashboard did not answer within 15 minutes; see ops/dashboard/supervisor.log, then run playground again",
      ok: false,
    })
  })
})

describe("dashboardBeatOf", () => {
  const NOW = Date.parse("2026-10-19T22:00:00Z")
  const alive = () => true
  const BEAT = { cycleSeconds: 60, lastBeatAt: "2026-10-19T21:59:50Z", lastResult: "ok", pid: 4242 }

  test("reads a heartbeat's age, cycle and running pid", () => {
    expect(dashboardBeatOf(BEAT, NOW, alive)).toEqual({
      ageMs: 10_000,
      cycleSeconds: 60,
      running: true,
    })
  })

  test("is null for a file that is not a heartbeat", () => {
    expect(dashboardBeatOf(null, NOW, alive)).toBeNull()
    expect(dashboardBeatOf([], NOW, alive)).toBeNull()
    expect(dashboardBeatOf({ ...BEAT, lastBeatAt: undefined }, NOW, alive)).toBeNull()
    expect(dashboardBeatOf({ ...BEAT, lastBeatAt: "soon" }, NOW, alive)).toBeNull()
    expect(dashboardBeatOf({ ...BEAT, cycleSeconds: 0 }, NOW, alive)).toBeNull()
    expect(dashboardBeatOf({ ...BEAT, cycleSeconds: "60" }, NOW, alive)).toBeNull()
  })

  test("takes a 60s cycle when the file names none", () => {
    expect(dashboardBeatOf({ ...BEAT, cycleSeconds: undefined }, NOW, alive)).toMatchObject({
      cycleSeconds: 60,
    })
  })

  test("is not running once its loop has exited or its pid is gone", () => {
    expect(
      dashboardBeatOf({ ...BEAT, lastResult: "supervisor exited: 1" }, NOW, alive),
    ).toMatchObject({
      running: false,
    })
    expect(dashboardBeatOf({ ...BEAT, lastResult: "loop exited" }, NOW, alive)).toMatchObject({
      running: false,
    })
    expect(dashboardBeatOf(BEAT, NOW, () => false)).toMatchObject({ running: false })
    expect(dashboardBeatOf({ ...BEAT, pid: undefined }, NOW, alive)).toMatchObject({
      running: false,
    })
  })
})
