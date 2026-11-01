import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { HERDR_SESSIONS } from "../../../../packages/scripts/src/ops-herdr/herdr"
import { OLD_NAMES } from "../../../session-names"
import { storeWith } from "../../hooks/render-set"

// ops-unstick is Python waiting for its TypeScript port, so these drive its pure readers through a Python of 3.13 (uv, as test:skills runs), else the runner's python3.
const RUN_PY = join(import.meta.dir, "../../../../scripts/ops/unstick/run.py")
const PYTHON = Bun.which("uv")
  ? ["uv", "run", "--quiet", "--python", "3.13", "python"]
  : ["python3"]
const DRIVER = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("run", sys.argv[1])
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)
call = json.loads(sys.stdin.read())
notified = []
run.notify = lambda text, to="dispatcher": notified.append([to, text])
paths = [run.CODE, run.LW, run.OPS, run.HERE]
out = paths if call["fn"] == "paths" else getattr(run, call["fn"])(*call["args"])
print(json.dumps({"notified": notified, "result": out} if call.get("notified") else out))
`

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ops-unstick-"))
  dirs.push(dir)
  // A machine past the switch, so the managers' old names place.
  storeWith(join(dir, "playground"), {}, { "sessions.aliases": OLD_NAMES })
  return dir
}

// Every run swaps notify for a recorder, so no test sends a line; `notified` returns what it would have sent beside the result.
const drive = async (
  env: Record<string, string>,
  config: string,
  body: { args: unknown[]; fn: string; notified?: true },
): Promise<unknown> => {
  const proc = Bun.spawn([...PYTHON, "-I", "-c", DRIVER, RUN_PY], {
    env: {
      CLAUDE_CONFIG_DIR: config,
      PLAYGROUND_DATA_DIR: join(config, "playground"),
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      TZ: "UTC",
      // the sandbox's real-home uv folders, so uv finds its Python 3.13 rather than downloading one into the scratch home
      UV_CACHE_DIR: process.env.UV_CACHE_DIR,
      UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR,
      ...env,
    },
    stderr: "pipe",
    stdin: new TextEncoder().encode(JSON.stringify(body)),
    stdout: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`run.py ${body.fn} exited ${code}: ${err}`)
  return JSON.parse(out)
}
const callWith = (
  env: Record<string, string>,
  config: string,
  fn: string,
  ...args: unknown[]
): Promise<unknown> => drive(env, config, { args, fn })
const call = (config: string, fn: string, ...args: unknown[]): Promise<unknown> =>
  callWith({}, config, fn, ...args)
const notified = (config: string, fn: string, ...args: unknown[]) =>
  drive({}, config, { args, fn, notified: true }) as Promise<{
    notified: [string, string][]
    result: unknown
  }>

// Claude Code's registry, each name a live session: the test's own pid stands in for its claude.
const liveAs = (config: string, names: string[]) => {
  mkdirSync(join(config, "sessions"), { recursive: true })
  for (const [i, name] of names.entries())
    writeFileSync(
      join(config, "sessions", `${i}.json`),
      JSON.stringify({ name, pid: process.pid, sessionId: `s-${i}` }),
    )
}

const DAY = 86_400
// The reset as Claude Code prints it, "Oct 20 at 9:30pm", days from now in local time.
const printed = (days: number): string => {
  const at = new Date(Date.now() + days * DAY * 1000)
  const month = at.toLocaleString("en-US", { month: "short" })
  return `${month} ${at.getDate()} at 9:30pm`
}
const prompt = ["", "────────────────", "> ", "────────────────", "  ? for shortcuts"]
const weekly = (days: number, credits: "inline" | "below") => [
  "⏺ Working on the fix.",
  ...(credits === "inline"
    ? [
        `  ⎿  You've hit your weekly limit · resets ${printed(days)} · /usage-credits to finish what you're working on`,
      ]
    : [
        `  ⎿  You've hit your weekly limit · resets ${printed(days)}`,
        "     /usage-credits to finish what you're working on",
      ]),
  ...prompt,
]

describe("ops-unstick reads Claude Code's weekly limit line", () => {
  for (const credits of ["below", "inline"] as const)
    test(`as a usage-limit block until its dated reset, the /usage-credits hint ${credits}`, async () => {
      const config = scratch()
      const [kind, line, stuck] = (await call(config, "read_block", weekly(2, credits), {})) as [
        string,
        string,
        [string, number],
      ]
      expect(kind).toBe("usage-limit")
      expect(line).toBe(`hit your weekly limit · resets ${printed(2)}`)
      expect(stuck[1]).toBeLessThan(-DAY)
      expect(stuck[1]).toBeGreaterThan(-3 * DAY)
    })

  test("as stuck, not a block, once its dated reset is past", async () => {
    const [kind, , stuck] = (await call(scratch(), "read_block", weekly(-1, "below"), {})) as [
      string | null,
      string,
      [string, number],
    ]
    expect(kind).toBeNull()
    expect(stuck[1]).toBeGreaterThan(0)
  })

  // at 20:40Z (02:10 local) "resets 7:30pm" read as 400m past, though it was that evening's 7:30pm, and the block flapped on and off the list.
  const clock = (minutesFromNow: number, timeZone = "UTC"): string =>
    new Date(Date.now() + minutesFromNow * 60_000)
      .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone })
      .replace(/\s/g, "")
      .toLowerCase()

  test("as the machine's own clock time, as Claude Code prints it", async () => {
    const screen = [
      `  ⎿  You've hit your weekly limit · resets ${clock(1040, "Asia/Kolkata")}`,
      ...prompt,
    ]
    const [kind, , stuck] = (await callWith(
      { TZ: "Asia/Kolkata" },
      scratch(),
      "read_block",
      screen,
      {},
    )) as [string | null, string, [string, number]]
    expect(kind).toBe("usage-limit")
    expect(stuck[1]).toBeLessThan(-1030 * 60)
    expect(stuck[1]).toBeGreaterThan(-1041 * 60)
  })

  test("as a usage-limit block on every cycle when its reset names no date and is 17 hours ahead", async () => {
    const screen = [`  ⎿  You've hit your weekly limit · resets ${clock(1040)}`, ...prompt]
    for (const cycle of [1, 2]) {
      const [kind, , stuck] = (await call(scratch(), "read_block", screen, {})) as [
        string | null,
        string,
        [string, number],
      ]
      expect(kind, `cycle ${cycle}`).toBe("usage-limit")
      expect(stuck[1]).toBeLessThan(-1030 * 60)
      expect(stuck[1]).toBeGreaterThan(-1041 * 60)
    }
  })

  test("as a usage-limit block when its reset names no date and is 19 hours ahead", async () => {
    const screen = [`  ⎿  You've hit your weekly limit · resets ${clock(1140)}`, ...prompt]
    const [kind, , stuck] = (await call(scratch(), "read_block", screen, {})) as [
      string | null,
      string,
      [string, number],
    ]
    expect(kind).toBe("usage-limit")
    expect(stuck[1]).toBeLessThan(-1130 * 60)
  })

  test("as stuck when a weekly reset with no date passed minutes ago", async () => {
    const screen = [`  ⎿  You've hit your weekly limit · resets ${clock(-5)}`, ...prompt]
    const [kind, , stuck] = (await call(scratch(), "read_block", screen, {})) as [
      string | null,
      string,
      [string, number],
    ]
    expect(kind).toBeNull()
    expect(stuck[1]).toBeGreaterThan(0)
  })

  test("as stuck when a five-hour reset with no date passed minutes ago", async () => {
    const screen = [`  ⎿  Usage limit reached · resets ${clock(-5)}`, ...prompt]
    const [kind, , stuck] = (await call(scratch(), "read_block", screen, {})) as [
      string | null,
      string,
      [string, number],
    ]
    expect(kind).toBeNull()
    expect(stuck[1]).toBeGreaterThan(0)
  })
})

// the 98% line and the dialog's room judge a session by the --account its spawn.sh resume record names, none for a GLM pin, else this machine's own login.
describe("a session's account, for the 98% shutdown line and the dialog's room", () => {
  // three days ahead, on the hour as usage.json's resets_at falls, so run.py never skips it as past and the wobble test's round(reset / 3600) holds
  const RESET = Math.ceil(Date.now() / 3_600_000) * 3600 + 3 * DAY
  const write = (path: string, body: string): void => {
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, body)
  }
  const usage = (
    config: string,
    file: string,
    account: string,
    pct: number,
    reset = RESET,
    at = new Date(),
  ) =>
    write(
      join(config, "playground", file),
      JSON.stringify({
        account,
        rate_limits: { seven_day: { resets_at: reset, used_percentage: pct } },
        writtenAt: at.toISOString().replace(/\.\d{3}Z$/, "Z"),
      }),
    )
  const record = (config: string, name: string, flags: string) =>
    write(
      join(config, "playground", "resume", `${name}.sh`),
      `#!/bin/bash\n# server: factory\nexec /x/scripts/spawn.sh resume ${name} /x 0b9e8f1a ${flags}\n`,
    )
  const machine = (ownPct: number, twoPct: number) => {
    const config = scratch()
    mkdirSync(join(config, "playground", "ops", "unstick"), { recursive: true })
    usage(config, "usage.json", "own@example.net", ownPct)
    usage(config, "usage-two.json", "two@example.com", twoPct)
    record(config, "worker-on-two", "--account two@example.com --model claude-opus-5-5")
    record(config, "dispatcher-2", "")
    write(join(config, "playground", "backends", "dispatcher-2"), "glm\n")
    return config
  }

  test("posts no line for usage.json's account at 98% when no live session runs on it", async () => {
    const config = machine(98, 22)
    const { notified: sent, result } = await notified(config, "shutdown_alert", [
      "worker-on-two",
      "dispatcher-2",
    ])
    expect(sent).toEqual([])
    expect(result).toEqual([])
  })

  test("posts one naming a live session's account at 98%, to dispatcher and both leads", async () => {
    const config = machine(40, 98.4)
    const { notified: sent, result } = await notified(config, "shutdown_alert", ["worker-on-two"])
    expect(sent.map(([to]) => to)).toEqual(["dispatcher", "builder", "ops"])
    for (const [, line] of sent)
      expect(line).toStartWith("SHUTDOWN 98%: two@example.com's week is at 98%")
    expect((result as { name: string }[]).map((a) => a.name)).toEqual(["two@example.com"])
  })

  test("counts a session by its record's account line, a login spawn.sh's usage gate picked (PG-2137)", async () => {
    const config = machine(40, 98.4)
    write(
      join(config, "playground", "resume", "worker-picked.sh"),
      "#!/bin/bash\n# server: factory\n# account: two@example.com\nexec /x/scripts/spawn.sh resume worker-picked /x 0b9e8f1a\n",
    )
    const { notified: sent } = await notified(config, "shutdown_alert", ["worker-picked"])
    expect(sent).toHaveLength(3)
    expect(sent[0][1]).toStartWith("SHUTDOWN 98%: two@example.com's week is at 98%")
  })

  test("counts a session with no --account on this machine's own login", async () => {
    const { notified: sent } = await notified(machine(98, 22), "shutdown_alert", ["worker-plain"])
    expect(sent).toHaveLength(3)
    expect(sent[0][1]).toStartWith("SHUTDOWN 98%: own@example.net's week")
  })

  test("counts a session with no --account on usage.json's storedLogin while usage.json reads a factory account", async () => {
    const config = machine(40, 22)
    const own = JSON.parse(readFileSync(join(config, "playground", "usage.json"), "utf8"))
    write(
      join(config, "playground", "usage.json"),
      JSON.stringify({ ...own, storedLogin: { account: "stored@example.org", week: 98 } }),
    )
    const { notified: sent } = await notified(config, "shutdown_alert", ["worker-plain"])
    expect(sent).toHaveLength(3)
    expect(sent[0][1]).toStartWith("SHUTDOWN 98%: stored@example.org's week is at 98%")
  })

  const stored = (config: string, week: number) => {
    const own = JSON.parse(readFileSync(join(config, "playground", "usage.json"), "utf8"))
    write(
      join(config, "playground", "usage.json"),
      JSON.stringify({ ...own, storedLogin: { account: "stored@example.org", week } }),
    )
  }

  test("reads a fresh storedLogin over a stale file of the same account, with that file's reset", async () => {
    const config = machine(40, 22)
    stored(config, 98)
    usage(
      config,
      "usage-stored.json",
      "stored@example.org",
      97,
      RESET,
      new Date(Date.now() - 3_600_000),
    )
    expect(await call(config, "room", "worker-plain")).toEqual([true, "stored@example.org: 7d 98%"])
    const { notified: sent } = await notified(config, "shutdown_alert", ["worker-plain"])
    expect(sent).toHaveLength(3)
    expect(sent[0][1]).toStartWith(
      `SHUTDOWN 98%: stored@example.org's week is at 98% (resets ${new Date(RESET * 1000).toUTCString().slice(0, 3)}`,
    )
  })

  test("takes no reset already past from a stale file of the storedLogin's account", async () => {
    const config = machine(40, 22)
    stored(config, 98)
    const past = Math.floor(Date.now() / 1000) - DAY
    usage(
      config,
      "usage-stored.json",
      "stored@example.org",
      97,
      past,
      new Date(Date.now() - 2 * DAY * 1000),
    )
    const { notified: sent } = await notified(config, "shutdown_alert", ["worker-plain"])
    expect(sent[0][1]).toStartWith(
      "SHUTDOWN 98%: stored@example.org's week is at 98% (resets unknown)",
    )
    const keys = JSON.parse(
      readFileSync(join(config, "playground", "ops", "unstick", "shutdown-98.json"), "utf8"),
    ).keys
    expect(keys["stored@example.org"]).toMatch(/^\d{4}-W\d{2}$/)
  })

  test("sends a storedLogin's line once a week though no file reads its reset", async () => {
    const config = machine(40, 22)
    stored(config, 98)
    const sends = async () =>
      (await notified(config, "shutdown_alert", ["worker-plain"])).notified.length
    expect(await sends()).toBe(3)
    expect(await sends()).toBe(0)
    const sentPath = join(config, "playground", "ops", "unstick", "shutdown-98.json")
    const sentFile = JSON.parse(readFileSync(sentPath, "utf8"))
    expect(sentFile.keys["stored@example.org"]).toMatch(/^\d{4}-W\d{2}$/)
    write(sentPath, JSON.stringify({ ...sentFile, keys: { "stored@example.org": "2020-W01" } }))
    expect(await sends()).toBe(3)
  })

  test("names why a GLM pin has no room", async () => {
    expect(await call(machine(40, 22), "room", "dispatcher-2")).toEqual([
      false,
      "a GLM session, which no usage file reads",
    ])
  })

  test("sends once across a reset that wobbles by a second over the hour, and again the next week", async () => {
    const config = machine(98, 22)
    const sends = async (reset: number) => {
      usage(config, "usage.json", "own@example.net", 98, reset)
      return (await notified(config, "shutdown_alert", ["worker-plain"])).notified.length
    }
    expect(await sends(RESET)).toBe(3)
    expect(await sends(RESET - 1)).toBe(0)
    expect(await sends(RESET)).toBe(0)
    expect(await sends(RESET + 7 * DAY)).toBe(3)
  })

  test("reads no room for a session whose record names a spare at 100%, though usage.json has room", async () => {
    expect(await call(machine(40, 100), "room", "worker-on-two")).toEqual([
      false,
      "two@example.com: 7d 100%",
    ])
  })

  test("reads room for a session on a factory account under 100%, though usage.json is spent", async () => {
    expect(await call(machine(100, 60), "room", "worker-on-two")).toEqual([
      true,
      "two@example.com: 7d 60%",
    ])
  })
})

describe("the usage-limit dialog's Escape", () => {
  const dialog = (days: number) => [
    `  ⎿  You've hit your weekly limit · resets ${printed(days)}`,
    "",
    "  What do you want to do?",
    "",
    "  ❯ 1. Stop and wait for limit to reset",
    "    2. Switch to extra usage",
    "",
    "  Enter to confirm · Esc to cancel",
  ]
  const spent = (config: string) => {
    mkdirSync(join(config, "playground"), { recursive: true })
    writeFileSync(
      join(config, "playground", "usage.json"),
      JSON.stringify({
        account: "pat@example.com",
        rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 100 } },
        writtenAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      }),
    )
    return config
  }

  test("goes once the printed reset has passed, though usage.json still reads the week spent", async () => {
    const [room, why] = (await call(
      spent(scratch()),
      "dialog_room",
      "worker-brave-otter",
      dialog(-1),
    )) as [boolean, string]
    expect(room).toBe(true)
    expect(why).toStartWith("its reset (")
  })

  test("waits while the week is spent and its reset is ahead", async () => {
    const [room, why] = (await call(
      spent(scratch()),
      "dialog_room",
      "worker-brave-otter",
      dialog(2),
    )) as [boolean, string]
    expect(room).toBe(false)
    expect(why).toBe("pat@example.com: 5h 12%, 7d 100%")
  })
})

describe("run from the repo", () => {
  test("keeps its state in $PLAYGROUND_DATA_DIR, never in the checkout", async () => {
    const config = scratch()
    const [code, lw, ops, here] = (await call(config, "paths")) as string[]
    expect(code).toBe(join(import.meta.dir, "../../../../scripts/ops"))
    expect([lw, ops, here]).toEqual([
      join(config, "playground"),
      join(config, "playground", "ops"),
      join(config, "playground", "ops", "unstick"),
    ])
  })
})

describe("an account move", () => {
  const moveFile = (config: string, move: unknown): void => {
    mkdirSync(join(config, "playground", "ops", "unstick"), { recursive: true })
    writeFileSync(join(config, "playground", "ops", "unstick", "move.json"), JSON.stringify(move))
  }
  const iso = (secondsFromNow: number): string =>
    new Date(Date.now() + secondsFromNow * 1000).toISOString().replace(/\.\d+Z$/, "Z")

  test("names its dispatcher while move.json's until is ahead", async () => {
    const config = scratch()
    moveFile(config, { to: "dispatcher-2", until: iso(3600) })
    expect(await call(config, "moving")).toBe("dispatcher-2")
  })

  test("names none once until has passed, with no move.json, or with a name that is not a session's", async () => {
    const past = scratch()
    moveFile(past, { to: "dispatcher-2", until: iso(-60) })
    expect(await call(past, "moving")).toBeNull()
    expect(await call(scratch(), "moving")).toBeNull()
    const odd = scratch()
    moveFile(odd, { to: "dispatcher 2; rm", until: iso(3600) })
    expect(await call(odd, "moving")).toBeNull()
  })

  test("reads an until written with milliseconds or an offset, and no move from one with no zone", async () => {
    const until = new Date(Date.now() + 3600 * 1000)
    const ms = scratch()
    moveFile(ms, { to: "dispatcher-2", until: until.toISOString() })
    expect(await call(ms, "moving")).toBe("dispatcher-2")
    const offset = scratch()
    moveFile(offset, {
      to: "dispatcher-2",
      until: until.toISOString().replace(/\.\d+Z$/, "+00:00"),
    })
    expect(await call(offset, "moving")).toBe("dispatcher-2")
    const bare = scratch()
    moveFile(bare, { to: "dispatcher-2", until: until.toISOString().replace(/\.\d+Z$/, "") })
    expect(await call(bare, "moving")).toBeNull()
  })

  test("holds only a limit block's own alert, and only while a move runs", async () => {
    const config = scratch()
    expect(await call(config, "held_for_move", "usage-limit", "dispatcher-2")).toBe(true)
    expect(await call(config, "held_for_move", "usage-limit-stuck", "dispatcher-2")).toBe(true)
    expect(await call(config, "held_for_move", "permission", "dispatcher-2")).toBe(false)
    expect(await call(config, "held_for_move", "usage-limit", null)).toBe(false)
  })

  test("sums the limit blocks into one line and names every other block", async () => {
    const blocks = {
      a: { kind: "usage-limit", name: "worker-b" },
      b: { kind: "usage-limit-stuck", name: "worker-a" },
      c: { kind: "permission", name: "tester-c" },
    }
    expect(await call(scratch(), "move_summary", blocks)).toBe(
      "2 sessions blocked on the usage limit. Blocked for another reason: tester-c (permission). On the limit: worker-a, worker-b",
    )
    expect(await call(scratch(), "move_summary", { a: blocks.a })).toBe(
      "1 session blocked on the usage limit. Nothing blocked for another reason. On the limit: worker-b",
    )
  })

  test("keeps the count and the other blocks inside notify.sh's 400-character cut with 25 sessions at the limit", async () => {
    const blocks: Record<string, { kind: string; name: string }> = {
      z: { kind: "permission", name: "tester-calm-ridge" },
    }
    for (let i = 0; i < 12; i++)
      blocks[`o${i}`] = { kind: "picker", name: `tester-calm-ridge-${i}` }
    for (let i = 0; i < 25; i++)
      blocks[`s${i}`] = { kind: "usage-limit", name: `worker-steady-lathe-${i}` }
    const line = (await call(scratch(), "move_summary", blocks)) as string
    expect(line.length).toBeGreaterThan(400)
    expect(line.slice(0, 400)).toStartWith("25 sessions blocked on the usage limit.")
    expect(line.slice(0, 400)).toContain("tester-calm-ridge (permission)")
  })
})

// review round 1: under the load units a waiter for units that are not free waits beside a free run-slot by design
describe("the slot-stuck alert", () => {
  // older: a big ticket older than the medium one, which the window has tracked; took: a start of run-slot in the runs log inside the window
  const queue = (held: boolean, { older = false, took = false } = {}) => {
    const config = scratch()
    const ops = join(config, "playground", "ops")
    const bin = join(config, "bin")
    mkdirSync(join(ops, "run-slot.waiters"), { recursive: true })
    mkdirSync(bin)
    writeFileSync(
      join(bin, "sysctl"),
      `#!/bin/bash\ncase "$2" in hw.ncpu) echo 15 ;; vm.loadavg) echo "{ 2.00 2.00 2.00 }" ;; esac\n`,
    )
    chmodSync(join(bin, "sysctl"), 0o755)
    for (const off of ["run-slot.3-off", "run-slot.4-off"]) writeFileSync(join(ops, off), "")
    if (held) {
      mkdirSync(join(ops, "run-slot-2"))
      writeFileSync(
        join(ops, "run-slot-2.holder"),
        `worker-big ${process.pid} 2026-10-18T19:00:00Z 3 big\n`,
      )
    }
    writeFileSync(join(ops, "run-slot.waiters", `2-${process.pid}-worker-m`), "s2 22 2 medium\n")
    if (older)
      writeFileSync(join(ops, "run-slot.waiters", `1-${process.pid}-worker-big`), "s2 23 3 big\n")
    const now = Date.now() / 1000
    if (took)
      writeFileSync(
        join(ops, "run-slot.runs.log"),
        `${new Date((now - 60) * 1000).toISOString().slice(0, 19)}Z start worker-x 4242 run-slot waited=3s\n`,
      )
    const state = { slot_free: { since: now - 200, ticket: `${older ? 1 : 2}${process.pid}` } }
    return callWith(
      { PATH: `${bin}:${process.env.PATH}`, RUN_SLOT_SIZE: "medium" },
      config,
      "slot_stuck",
      state,
      now,
    )
  }

  test("pages when the waiter could take run-slot", async () => {
    const alert = (await queue(false)) as { kind: string; name: string }
    expect(alert.kind).toBe("slot-stuck")
    expect(alert.name).toBe("worker-m")
  })

  test("stays quiet while the waiter's units are not free", async () => {
    expect(await queue(true)).toBeNull()
  })

  // 31 Oct: both alerts named a big session's ticket, the oldest, which ranks behind a newer medium one by design
  test("watches the queue's head, so an older big ticket behind a newer medium one fires nothing", async () => {
    expect(await queue(false, { older: true })).toBeNull()
  })

  // 31 Oct: two samples 2 minutes apart read free while the runs log shows run-slot taken 5 times between them
  test("stays quiet when the runs log shows run-slot taken inside the window", async () => {
    expect(await queue(false, { took: true })).toBeNull()
  })
})

// a lead is known by its roster kind, so a manager respawned under a new name is still known as one, and every alert names a kind notify.sh resolves.
describe("managers by kind", () => {
  test("a lead by its roster kind, else by its <id>-<kind> name or today's name (PG-1644)", async () => {
    const config = scratch()
    mkdirSync(join(config, "playground"), { recursive: true })
    writeFileSync(
      join(config, "playground", "roster.json"),
      JSON.stringify({
        agents: [
          { kind: "builder", name: "x7mh4d-builder" },
          { kind: "worker", name: "k3v9q2-worker" },
        ],
      }),
    )
    const kinds = await call(config, "roster_kinds")
    expect(kinds).toEqual({ "k3v9q2-worker": "worker", "x7mh4d-builder": "builder" })
    for (const [name, lead] of [
      ["x7mh4d-builder", true],
      ["builder", true],
      ["planner", true],
      ["k3v9q2-worker", false],
      ["dispatcher", false],
      ["m4n7vw-builder", true],
      ["m4n7vw-ops", true],
      ["m4n7vw-planner", true],
      ["m4n7vw-dispatcher", false],
      ["ops-dashboard", false],
    ] as const)
      expect(await call(config, "is_lead", name, kinds), name).toBe(lead)
  })

  test("a session's lead is a kind word", async () => {
    const config = scratch()
    expect(await call(config, "lead_of", "worker-greed")).toBe("builder")
    expect(await call(config, "lead_of", "runner-pride")).toBe("ops")
    expect(await call(config, "lead_of", "ops")).toBe("dispatcher")
    expect(await call(config, "lead_of", "m4n7vw-ops")).toBe("dispatcher")
    expect(await call(config, "lead_of", "m4n7vw-dispatcher")).toBe("builder")
    expect(await call(config, "lead_of", "dispatcher")).toBe("builder")
    expect(await call(config, "lead_of", "dispatcher-2")).toBe("dispatcher")
  })

  test("the second dispatcher's lead is the first dispatcher, never the builder (PG-1644)", async () => {
    const config = scratch()
    mkdirSync(join(config, "playground"), { recursive: true })
    writeFileSync(
      join(config, "playground", "roster.json"),
      JSON.stringify({
        agents: [
          { kind: "dispatcher", name: "m4n7vw-dispatcher", status: "working", task: "t" },
          { kind: "dispatcher", name: "q8r2tx-dispatcher", slot: 2, status: "working", task: "t" },
        ],
      }),
    )
    expect(await call(config, "lead_of", "q8r2tx-dispatcher")).toBe("dispatcher")
    expect(await call(config, "lead_of", "m4n7vw-dispatcher")).toBe("builder")
  })
})

// a probe's prompts are its spawner's to answer, so its block alert goes to the session its spawn brief names, never dispatcher.
describe("block alerts", () => {
  test("a probe's go to its live spawner, else the builder; a worker's to its manager (PG-2184)", async () => {
    const config = scratch()
    liveAs(config, ["worker-mild-lark", "builder"])
    const transcript = join(config, "probe.jsonl")
    const brief =
      "You are probe-herdr-answer, a probe in the Playground factory; you report to worker-mild-lark. Report to worker-mild-lark with SendMessage (to: worker-mild-lark)."
    writeFileSync(
      transcript,
      `${JSON.stringify({ message: { content: brief, role: "user" }, type: "user" })}\n`,
    )
    expect(await call(config, "alert_to", "probe-herdr-answer", transcript)).toBe(
      "worker-mild-lark",
    )
    expect(
      await call(config, "alert_to", "probe-herdr-answer", join(config, "missing.jsonl")),
    ).toBe("builder")
    expect(await call(config, "alert_to", "probe-herdr-answer", null)).toBe("builder")
    expect(await call(config, "alert_to", "worker-mild-lark", null)).toBe("builder")
    expect(await call(config, "limit_targets", "probe-herdr-answer", transcript)).toEqual([
      "worker-mild-lark",
    ])
    expect(await call(config, "limit_targets", "worker-mild-lark", transcript)).toEqual([
      "builder",
      "dispatcher",
    ])
  })
})

// with every session on herdr, a cycle asks cmux nothing. The test's own process stands in for a live claude: its pid is alive and ps gives its start.
describe("with no session live in cmux", () => {
  const pid = String(process.pid)
  const started = Bun.spawnSync(["ps", "-o", "lstart=", "-p", pid], {
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
  })
    .stdout.toString()
    .trim()
  const script = (path: string, body: string): void => {
    writeFileSync(path, `#!/bin/sh\n${body}\n`)
    chmodSync(path, 0o755)
  }
  // A cmux that fails every call and records it, and a herdr server whose one pane runs claude at `held` (none when null).
  const machine = (held: string | null, registry: Record<string, unknown>[]) => {
    const config = scratch()
    const bin = join(config, "bin")
    const herdrDir = join(config, "herdr")
    mkdirSync(bin)
    mkdirSync(herdrDir)
    mkdirSync(join(config, "sessions"))
    writeFileSync(join(herdrDir, "factory.sock"), "")
    const calls = join(config, "cmux-calls")
    script(join(bin, "cmux"), `echo "$*" >> "${calls}"\nexit 1`)
    const panes = held ? '[{"pane_id":"p1","workspace_id":"w1"}]' : "[]"
    const info = `{"result":{"process_info":{"foreground_processes":[{"argv":["claude"],"name":"claude","pid":${held}}]}}}`
    script(
      join(bin, "herdr"),
      `case "$1 $2" in\n"pane list") echo '{"result":{"panes":${panes}}}' ;;\n"pane process-info") echo '${info}' ;;\n*) exit 1 ;;\nesac`,
    )
    for (const entry of registry)
      writeFileSync(join(config, "sessions", `${entry.pid}.json`), JSON.stringify(entry))
    const env = {
      PLAYGROUND_HERDR_DIR: herdrDir,
      PLAYGROUND_HERDR_SESSIONS: "factory",
      HERDR_BIN_PATH: join(bin, "herdr"),
      PATH: `${bin}:${process.env.PATH}`,
    }
    return { calls, config, env }
  }
  const session = (entry: Record<string, unknown> = {}) => ({
    entrypoint: "cli",
    pid: Number(pid),
    procStart: started,
    sessionId: "0b9e8f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
    ...entry,
  })

  test("reads herdr's sessions and makes no cmux call while herdr holds every live one", async () => {
    const { calls, config, env } = machine(pid, [session()])
    const found = (await callWith(env, config, "sessions")) as { herdr: string; pid: string }[]
    expect(found.map((s) => [s.herdr, s.pid])).toEqual([["factory", pid]])
    expect(existsSync(calls)).toBe(false)
  })

  test("runs the pinned herdr in HOME's data folder when HERDR_BIN_PATH is unset", async () => {
    const { config, env } = machine(pid, [session()])
    const { HERDR_BIN_PATH: bin, ...rest } = env
    const home = scratch()
    mkdirSync(join(home, ".playground", "bin"), { recursive: true })
    script(join(home, ".playground", "bin", "herdr"), readFileSync(bin, "utf8"))
    const found = (await callWith({ ...rest, HOME: home }, config, "sessions")) as { pid: string }[]
    expect(found.map((s) => s.pid)).toEqual([pid])
  })

  test("makes no cmux call, and fails nothing, with no session live anywhere", async () => {
    const { calls, config, env } = machine(null, [])
    expect(await callWith(env, config, "sessions")).toEqual([])
    expect(existsSync(calls)).toBe(false)
  })

  test("asks cmux in doubt: a procStart in another shape, or an entry naming no entrypoint", async () => {
    for (const entry of [{ procStart: "2026-10-19T00:00:00Z" }, { entrypoint: undefined }]) {
      const { config, env } = machine(null, [session(entry)])
      expect(await callWith(env, config, "cmux_may_hold", []), JSON.stringify(entry)).toBe(true)
    }
  })

  test("asks cmux once a live interactive session is in no herdr pane", async () => {
    const { calls, config, env } = machine(null, [session()])
    expect(await callWith(env, config, "cmux_may_hold", [])).toBe(true)
    await expect(callWith(env, config, "sessions")).rejects.toThrow("cmux tree")
    expect(readFileSync(calls, "utf8")).toStartWith("tree --all")
  })

  test("counts no headless run, no ended session and no pid handed on", async () => {
    for (const entry of [
      { entrypoint: "sdk-cli" },
      { pid: 999_999 },
      { procStart: "Thu Jan  1 00:00:00 1970" },
    ]) {
      const { config, env } = machine(null, [session(entry)])
      expect(await callWith(env, config, "cmux_may_hold", []), JSON.stringify(entry)).toBe(false)
    }
  })
})

describe("the quiet read", () => {
  const line = (type: string, secondsAgo: number) =>
    JSON.stringify({ timestamp: new Date(Date.now() - secondsAgo * 1000).toISOString(), type })
  const quiet = async (lines: string[]): Promise<number> => {
    const config = scratch()
    const path = join(config, "t.jsonl")
    writeFileSync(path, `${lines.join("\n")}\n`)
    return (await call(config, "quiet_for", path, Date.now() / 1000)) as number
  }

  test("counts a session whose newest work line is old as quiet, though queued messages wrote since", async () => {
    expect(
      await quiet([
        line("assistant", 300),
        line("queue-operation", 20),
        line("queue-operation", 5),
      ]),
    ).toBeGreaterThan(290)
  })

  test("passes over the lines Claude Code writes with no timestamp", async () => {
    const untimed = [
      "last-prompt",
      "custom-title",
      "agent-name",
      "mode",
      "permission-mode",
      "atis-latch",
    ].map((type) => JSON.stringify({ type }))
    expect(
      await quiet([
        line("assistant", 300),
        ...untimed,
        line("queue-operation", 20),
        line("queue-operation", 5),
      ]),
    ).toBeGreaterThan(290)
  })

  test("counts a session that wrote a work line just now as at work", async () => {
    expect(await quiet([line("queue-operation", 30), line("assistant", 5)])).toBeLessThan(60)
  })

  test("counts a line still being written as at work", async () => {
    expect(await quiet([line("assistant", 300), '{"type":"assis'])).toBeLessThan(60)
  })
})

// Claude Code's autocompact thrashing stop is an API error line; its resume and its lead's line name the small-reads fix, since redoing the step refills the context.
describe("an api-error stop", () => {
  const THRASH =
    "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh."
  const stopped = (config: string, text: string) => {
    const transcript = join(config, "stopped.jsonl")
    const line = {
      apiError: "autocompact_thrashing",
      error: "invalid_request",
      isApiErrorMessage: true,
      message: { content: [{ text, type: "text" }], role: "assistant" },
      timestamp: "2026-10-19T20:43:00.000Z",
      type: "assistant",
      uuid: "e1",
    }
    writeFileSync(transcript, `${JSON.stringify(line)}\n`)
    return transcript
  }

  test("reads a thrash stop from the transcript, and its lines name small reads and a fresh start", async () => {
    const config = scratch()
    const transcript = stopped(config, THRASH)
    const [entry, text] = (await call(
      config,
      "api_error_stop",
      { session_id: "s1", transcript_path: transcript },
      Date.now() / 1000 + 300,
    )) as [string, string, number]
    expect(entry).toBe("e1")
    expect(text.startsWith("Autocompact is thrashing")).toBe(true)
    const [resume, lead] = (await call(config, "api_stop_lines", "worker-x", text, "5m")) as [
      string,
      string,
    ]
    expect(resume).toContain("Carry on with small reads (Read with offset and limit, grep, head")
    expect(resume).not.toContain("redo the step")
    expect(resume.length).toBeLessThanOrEqual(400)
    expect(lead).toBe(
      "worker-x stopped on autocompact thrashing and sat idle 5m; ops-unstick sent it a resume line with small reads. If it thrashes again, start it fresh from its brief (api-error stop).",
    )
  })

  test("a stop its StopFailure hook recorded as failed is ops-session-resume's, and an older failed record leaves it here (#1637)", async () => {
    const config = scratch()
    const transcript = stopped(config, "API Error: Connection lost mid-response")
    const states = join(config, "playground", "session-state")
    mkdirSync(states, { recursive: true })
    const record = (at: string) =>
      writeFileSync(
        join(states, "s1.json"),
        JSON.stringify({
          at,
          event: "StopFailure",
          reason: "server_error",
          sessionId: "s1",
          state: "failed",
        }),
      )
    const stop = () =>
      call(
        config,
        "api_error_stop",
        { session_id: "s1", transcript_path: transcript },
        Date.now() / 1000 + 300,
      )
    expect(await stop()).not.toBeNull()
    record("2026-10-19T20:43:00.027Z")
    expect(await stop()).toBeNull()
    record("2026-10-19T20:40:00.000Z")
    expect(await stop()).not.toBeNull()
  })

  test("any other API error keeps its redo line", async () => {
    const config = scratch()
    const [resume, lead] = (await call(
      config,
      "api_stop_lines",
      "worker-x",
      "API Error: Server error mid-response",
      "3m",
    )) as [string, string]
    expect(resume).toBe(
      "ops-unstick: your last turn ended on an API error (API Error: Server error mid-response) and you have sat idle 3m since. Carry on from where you stopped: redo the step that failed.",
    )
    expect(lead).toBe(
      "worker-x stopped on an API error (API Error: Server error mid-response) and sat idle 3m; ops-unstick sent it a resume line (api-error stop).",
    )
  })
})

describe("factory names (#966)", () => {
  test("an <id>-<kind> name reads as its kind, as an old prefixed name does, and goes to its lead", async () => {
    const config = scratch()
    const names = [
      "k3m9px-worker",
      "k3m9px-reviewer",
      "k3m9px-runner",
      "k3m9px-probe",
      "worker-greed",
      "runner-calm-heron",
      "probe-x",
      "builder",
      "k3m9px-builder",
      "worker-",
    ]
    expect(await Promise.all(names.map((name) => call(config, "kind_of_name", name)))).toEqual([
      "worker",
      "reviewer",
      "runner",
      "probe",
      "worker",
      "runner",
      "probe",
      null,
      null,
      null,
    ])
    expect(
      await Promise.all(names.slice(0, 3).map((name) => call(config, "lead_of", name))),
    ).toEqual(["builder", "builder", "ops"])
  })

  test("an <id>-probe's alerts go to its spawner, as a probe-<what>'s do", async () => {
    const config = scratch()
    liveAs(config, ["worker-mild-lark"])
    const transcript = join(config, "probe.jsonl")
    const brief =
      "You are k3m9px-probe, a probe in the Playground factory; you report to worker-mild-lark. Report to worker-mild-lark with SendMessage (to: worker-mild-lark)."
    writeFileSync(
      transcript,
      `${JSON.stringify({ message: { content: brief, role: "user" }, type: "user" })}\n`,
    )
    expect(await call(config, "alert_to", "k3m9px-probe", transcript)).toBe("worker-mild-lark")
    expect(await call(config, "limit_targets", "k3m9px-probe", transcript)).toEqual([
      "worker-mild-lark",
    ])
  })

  test("a session started under a plain name reads as its roster kind, which wins over its name's", async () => {
    const config = scratch()
    mkdirSync(join(config, "playground"), { recursive: true })
    writeFileSync(
      join(config, "playground", "roster.json"),
      JSON.stringify({
        agents: [
          { kind: "worker", name: "anne-liaison" },
          { kind: "runner", name: "night-watch" },
          { kind: "probe", name: "herdr-check" },
          { kind: "reviewer", name: "worker-odd-name" },
        ],
      }),
    )
    const names = ["anne-liaison", "night-watch", "herdr-check", "worker-odd-name", "plain"]
    expect(await Promise.all(names.map((name) => call(config, "kind_of", name)))).toEqual([
      "worker",
      "runner",
      "probe",
      "reviewer",
      null,
    ])
    expect(await call(config, "lead_of", "anne-liaison")).toBe("builder")
    expect(await call(config, "lead_of", "night-watch")).toBe("ops")
    liveAs(config, ["worker-mild-lark"])
    const transcript = join(config, "probe.jsonl")
    const brief =
      "You are herdr-check, a probe in the Playground factory; you report to worker-mild-lark. Report to worker-mild-lark with SendMessage (to: worker-mild-lark)."
    writeFileSync(
      transcript,
      `${JSON.stringify({ message: { content: brief, role: "user" }, type: "user" })}\n`,
    )
    expect(await call(config, "alert_to", "herdr-check", transcript)).toBe("worker-mild-lark")
    expect(await call(config, "limit_targets", "herdr-check", transcript)).toEqual([
      "worker-mild-lark",
    ])
  })
})

describe("ops-unstick's slot alerts", () => {
  const at = "2026-10-25T21:00:00Z"
  const devRow = (pid: string, tree: string): string =>
    `  ${pid}      1 bun /repo/.claude/worktrees/${tree}/api/hono/src/bin/dev.ts`

  test("a worker's dev stack outside a slot raises no outside-slot", async () => {
    const jobs = [{ inside: false, kind: "dev stack", pid: "101", where: "pg-2088-usage-bars" }]
    expect(await call(scratch(), "slot_alerts", jobs, 2, at)).toEqual([])
  })

  test("a dev stack still counts toward the heavy-jobs cap", async () => {
    const jobs = [
      { inside: false, kind: "dev stack", pid: "101", where: "pg-2088-usage-bars" },
      { inside: false, kind: "dev stack", pid: "102", where: "pg-2090-question-red-flash" },
      { inside: true, kind: "suite", pid: "103", where: "review-2112" },
    ]
    expect(await call(scratch(), "slot_alerts", jobs, 2, at)).toEqual([
      {
        at,
        kind: "heavy-jobs",
        line: "3 heavy jobs at once (cap 2): pg-2088-usage-bars dev stack, pg-2090-question-red-flash dev stack, review-2112 suite",
        name: "machine",
        since: at,
      },
    ])
  })

  test("a suite outside a slot still raises outside-slot", async () => {
    const jobs = [
      { inside: false, kind: "suite", pid: "104", where: "pg-2121-dev-stack-outside-slot" },
    ]
    expect(await call(scratch(), "slot_alerts", jobs, 2, at)).toEqual([
      {
        at,
        kind: "outside-slot",
        line: "a suite runs outside the run slots (pid 104); use run-slot.sh",
        name: "pg-2121-dev-stack-outside-slot",
        since: at,
      },
    ])
  })

  test("a self-hosted runner's CI job reads as a ci job, raises no outside-slot and counts toward the cap", async () => {
    const rows = [
      "  999431      1 /x/.playground/ops/mac-runners/runner-1/bin/Runner.Worker spawnclient 1 2",
      "  999432 999431 /bin/bash -e /x/.playground/ops/mac-runners/runner-1/_work/_temp/a.sh",
      "  999433 999432 bun run test",
    ]
    const jobs = (await call(scratch(), "heavy_jobs", rows)) as {
      inside: boolean
      kind: string
      pid: string
      where: string
    }[]
    expect(jobs).toEqual([{ inside: false, kind: "ci job", pid: "999433", where: "mac-runner" }])
    expect(await call(scratch(), "slot_alerts", jobs, 2, at)).toEqual([])
    const more = [
      ...jobs,
      { inside: true, kind: "suite", pid: "105", where: "review-2112" },
      { inside: true, kind: "suite", pid: "106", where: "review-2113" },
    ]
    expect(await call(scratch(), "slot_alerts", more, 2, at)).toEqual([
      {
        at,
        kind: "heavy-jobs",
        line: "3 heavy jobs at once (cap 2): mac-runner ci job, review-2112 suite, review-2113 suite",
        name: "machine",
        since: at,
      },
    ])
  })

  test("the live dashboard's own dev stack is skipped, its worktree read canary before desk", async () => {
    expect(
      await call(scratch(), "heavy_jobs", [devRow("999421", "desk"), devRow("999422", "canary")]),
    ).toEqual([])
  })

  // a slotted commit's pre-commit suite: run-slot.sh holds the slot, git commit runs under it, and the suite under that
  const held = (slot: string) => {
    const config = scratch()
    const ops = join(config, "playground", "ops")
    mkdirSync(join(ops, slot), { recursive: true })
    writeFileSync(join(ops, `${slot}.holder`), "worker-x 999441 2026-11-01T13:00:00Z 1 small\n")
    return config
  }
  const committing = (holder: string) => [
    `  ${holder}      1 bash /x/.playground/ops/run-slot.sh worker-x -- git commit`,
    `  999442 ${holder} git commit`,
    "  999443 999442 bun run test:file tests/AGENTS.test.ts /x/.claude/worktrees/pg-334-x",
  ]

  for (const slot of ["run-slot-commit", "run-slot-model-2"])
    test(`a suite under ${slot}'s holder reads as inside a slot`, async () => {
      expect(await call(held(slot), "heavy_jobs", committing("999441"))).toEqual([
        { inside: true, kind: "suite", pid: "999443", where: "pg-334-x" },
      ])
    })

  test("a suite with no slot holder in its chain is still outside", async () => {
    const jobs = await call(held("run-slot-commit"), "heavy_jobs", committing("999444"))
    expect(jobs).toEqual([{ inside: false, kind: "suite", pid: "999443", where: "pg-334-x" }])
    expect(await call(scratch(), "slot_alerts", jobs, 2, at)).toHaveLength(1)
  })

  test("the slots read are run-slot.sh's own, each model slot by its name", async () => {
    const script = readFileSync(
      join(import.meta.dir, "../../../../scripts/ops/run-slot.sh"),
      "utf8",
    )
    const fixed = script
      .match(/^\s*for s in ((?:run-slot\S* )+)\$\(ls "\$OPS"/m)?.[1]
      ?.trim()
      .split(" ")
    expect(fixed?.length).toBeGreaterThan(0)
    const config = held("run-slot-model-2")
    writeFileSync(join(config, "playground", "ops", "run-slot-model-10.holder"), "")
    expect(await call(config, "slot_names")).toEqual([
      ...(fixed ?? []),
      "run-slot-model-10",
      "run-slot-model-2",
    ])
  })

  test("an idle holder raises slot-idle on each of run-slot.sh's CPU slots alone", async () => {
    const script = readFileSync(
      join(import.meta.dir, "../../../../scripts/ops/run-slot.sh"),
      "utf8",
    )
    const cpu = script.match(/^held_units\(\) \{\n[^\n]*\n\s*for s in ([^;]+);/m)?.[1]?.split(" ")
    expect(cpu?.length).toBeGreaterThan(0)
    const config = scratch()
    const ops = join(config, "playground", "ops")
    const bin = join(config, "bin")
    mkdirSync(bin)
    // the holder's one child has used no CPU
    writeFileSync(
      join(bin, "ps"),
      `#!/bin/bash\necho "  999461 ${process.pid} 0:00.00 sleep 900"\n`,
    )
    chmodSync(join(bin, "ps"), 0o755)
    const now = Date.now() / 1000
    const slots = ["run-slot-commit", "run-slot-clone", "run-slot-quick", "run-slot-model-1"]
    const state: { slot_idle: Record<string, unknown> } = { slot_idle: {} }
    for (const slot of [...(cpu ?? []), ...slots]) {
      mkdirSync(join(ops, slot), { recursive: true })
      writeFileSync(join(ops, `${slot}.holder`), `worker-x ${process.pid} 2026-11-01T13:00:00Z\n`)
      state.slot_idle[`${slot}:${process.pid}`] = { cpu: 0, since: now - 1000, told: true }
    }
    const alerts = (await callWith(
      { PATH: `${bin}:${process.env.PATH}` },
      config,
      "slot_idle_alerts",
      state,
      now,
    )) as { kind: string; line: string }[]
    expect(alerts.map((a) => a.line.match(/holds (\S+) with/)?.[1])).toEqual(cpu ?? [])
    expect(new Set(alerts.map((a) => a.kind))).toEqual(new Set(["slot-idle"]))
  })

  // the heavy-job cap reads run-slot.sh's own count of the CPU slots held or open, on a machine at load1 2 with the given off-switches
  const capped = (off: string[] = [], held: string[] = []) => {
    const config = scratch()
    const ops = join(config, "playground", "ops")
    const bin = join(config, "bin")
    mkdirSync(ops, { recursive: true })
    mkdirSync(bin)
    writeFileSync(
      join(bin, "sysctl"),
      `#!/bin/bash\ncase "$2" in hw.ncpu) echo 15 ;; vm.loadavg) echo "{ 2.00 2.00 2.00 }" ;; esac\n`,
    )
    chmodSync(join(bin, "sysctl"), 0o755)
    for (const name of off) writeFileSync(join(ops, name), "")
    for (const slot of held) {
      mkdirSync(join(ops, slot))
      writeFileSync(
        join(ops, `${slot}.holder`),
        `worker-x ${process.pid} 2026-11-01T14:00:00Z 2 medium\n`,
      )
    }
    return callWith({ PATH: `${bin}:${process.env.PATH}` }, config, "heavy_cap") as Promise<number>
  }

  test("four CPU slots held at load1 under 12 raise no heavy-jobs alert", async () => {
    const cap = await capped([], ["run-slot", "run-slot-2", "run-slot-3", "run-slot-4"])
    const jobs = ["101", "102", "103", "104"].map((pid) => ({
      inside: true,
      kind: "suite",
      pid,
      where: `pg-340-${pid}`,
    }))
    expect(await call(scratch(), "slot_alerts", jobs, cap, at)).toEqual([])
  })

  test("with run-slot.4-off and no run-slot-4 holder, the cap is at most 3", async () => {
    expect(await capped(["run-slot.4-off"])).toBe(3)
  })

  test("a cap read that fails allows every CPU slot and logs it", async () => {
    const config = scratch()
    const bin = join(config, "bin")
    mkdirSync(join(config, "playground", "ops", "unstick"), { recursive: true })
    mkdirSync(bin)
    writeFileSync(join(bin, "bash"), "#!/bin/sh\nexit 1\n")
    chmodSync(join(bin, "bash"), 0o755)
    expect(await callWith({ PATH: `${bin}:${process.env.PATH}` }, config, "heavy_cap")).toBe(4)
    expect(
      readFileSync(join(config, "playground", "ops", "unstick", "unstick.log"), "utf8"),
    ).toContain("run-slot.sh slots gave no count ('')")
  })
})

// ops-unstick routes a block to the session's manager and presses nothing on a permission prompt; a block the session's own hook recorded is that hook's to route.
describe("pickers go to the manager (PG-2184)", () => {
  test("a block the session's own hook recorded as stuck or failed is the hook's; any other is unstick's", async () => {
    const config = scratch()
    const states = join(config, "playground", "session-state")
    mkdirSync(states, { recursive: true })
    const record = (state: string) =>
      JSON.stringify({ at: "2026-10-26T05:00:00.000Z", event: "x", sessionId: "s", state })
    writeFileSync(join(states, "stuck.json"), record("stuck"))
    writeFileSync(join(states, "failed.json"), record("failed"))
    writeFileSync(join(states, "working.json"), record("working"))
    expect(
      await Promise.all(
        ["stuck", "failed", "working", "none"].map((sid) => call(config, "hook_owned", sid)),
      ),
    ).toEqual([true, true, false, false])
  })

  test("run.py presses Escape for the usage-limit dialog alone, never on a permission prompt", () => {
    const source = readFileSync(RUN_PY, "utf8")
    expect([...source.matchAll(/\bescape\(s, name, "([^"]+)"\)/g)].map((m) => m[1])).toEqual([
      "the usage-limit dialog",
    ])
  })
})

// OrbStack hung twice on 27 Oct and the live dashboard lost its database for about 6 minutes each time, until a person restarted it.
describe("a hung Docker with the live dashboard's db unreachable restarts OrbStack (#2437)", () => {
  // A machine whose `docker info` hangs until `answer()`, whose live dashboard's health reads `db`, and whose orbctl records each call; its state folder carries from one cycle to the next.
  // The probe gets 2 s, 5 times the 0.4 s an answering probe took at most beside twice the cores in busy loops, and the hang execs its sleep, so the probe's kill ends it and none outlives its case.
  const machine = (db: string) => {
    const config = scratch()
    const bin = join(config, "bin")
    mkdirSync(bin)
    mkdirSync(join(config, "playground", "ops", "unstick"), { recursive: true })
    const orbctl = join(config, "orbctl-calls")
    const answers = join(config, "docker-answers")
    const script = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
      chmodSync(join(bin, name), 0o755)
    }
    script("docker", `if [ -f "${answers}" ]; then echo 28.0.0; else exec sleep 10; fi`)
    script("orbctl", `echo "$1" >> "${orbctl}"`)
    script(
      "git",
      `printf 'worktree /repo\\nbranch refs/heads/main\\n\\nworktree ${config}\\nbranch refs/heads/live/dashboard\\n'`,
    )
    script("bunx", "echo http://127.0.0.1:1")
    script("curl", `echo '{"data":{"db":"${db}","dashboard":"live","message":"degraded"}}'`)
    const env = { PLAYGROUND_REPO: "/repo", PATH: `${bin}:${process.env.PATH}` }
    const check = (state: Record<string, unknown> = {}) =>
      drive(env, config, { args: [state, 2], fn: "docker_check", notified: true }) as Promise<{
        notified: [string, string][]
        result: { kind: string; line: string }[]
      }>
    const calls = () => (existsSync(orbctl) ? readFileSync(orbctl, "utf8").trim().split("\n") : [])
    const answer = (yes: boolean) => (yes ? writeFileSync(answers, "") : rmSync(answers))
    return { answer, calls, check }
  }

  test("restarts OrbStack on the first cycle, logs both exit codes and tells ops", async () => {
    const { calls, check } = machine("unreachable")
    const { notified, result } = await check()
    expect(calls()).toEqual(["stop", "start"])
    expect(result.map((a) => a.kind)).toEqual(["docker-restarted"])
    expect(result[0]?.line).toContain("orbctl stop exited 0, orbctl start exited 0")
    expect(notified.map(([to]) => to)).toEqual(["ops"])
  })

  test("restarts once per outage, a job restart between cycles included, and again in the next outage", async () => {
    const { answer, calls, check } = machine("unreachable")
    await check()
    // each check is a fresh process, as ops-up's restart of this job would be, so only the state folder carries the restart
    expect((await check({ docker_misses: 1 })).result.map((a) => a.kind)).toEqual(["docker-hung"])
    expect(calls()).toEqual(["stop", "start"])
    answer(true)
    expect((await check({ docker_misses: 2 })).result).toEqual([])
    answer(false)
    expect((await check()).result.map((a) => a.kind)).toEqual(["docker-restarted"])
    expect(calls()).toEqual(["stop", "start", "stop", "start"])
  })

  test("a docker timeout with the dashboard's db ok keeps today's count: no restart, an alert from the second miss", async () => {
    const { calls, check } = machine("ok")
    expect((await check()).result).toEqual([])
    expect((await check({ docker_misses: 1 })).result.map((a) => a.kind)).toEqual(["docker-hung"])
    expect(calls()).toEqual([])
  })

  test("a Docker that answers restarts nothing and alerts nothing, even with the dashboard's db unreachable", async () => {
    const { answer, calls, check } = machine("unreachable")
    answer(true)
    expect((await check({ docker_misses: 3 })).result).toEqual([])
    expect(calls()).toEqual([])
  })
})

// unstick read Playground's herdr servers under the names they had before ops-herdr renamed them, so it found none of the sessions on them
describe("the herdr servers", () => {
  test("unstick's default list is ops-herdr's", () => {
    const text = readFileSync(RUN_PY, "utf8")
    expect(/^HERDR_SESSIONS = .* or "([^"]+)"\)\.split/m.exec(text)?.[1]).toBe(
      HERDR_SESSIONS.join(","),
    )
  })
})
