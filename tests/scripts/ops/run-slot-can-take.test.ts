import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang: 60s, twice the slowest case under SLOW_CHILD=1.5 but local CI's, which sets its own
setDefaultTimeout(60_000)

// issue 285: can-take and head set the command to a bare `true`, so once run-slot.runs.log holds three short runs of one, quick_kind read both as quick and ran them past their own exits, and a held slot read free
const threeShortTrueRuns = (m: ReturnType<typeof machine>) =>
  writeFileSync(
    join(m.ops, "run-slot.runs.log"),
    [0, 1, 2]
      .map(
        (i) =>
          `2026-10-31T10:00:0${i}Z ask worker-q ${900 + i} true\n2026-10-31T10:01:0${i}Z end worker-q ${900 + i} rc=0 ran=1s\n`,
      )
      .join(""),
  )

describe("a read command while the runs log holds three short true runs", () => {
  test("can-take stays at 1 on a held slot", async () => {
    const m = machine()
    m.hold("run-slot", 1, "small")
    threeShortTrueRuns(m)
    expect(await m.canTake("run-slot", "worker-probe")).toBe(false)
  })

  test("slots still counts the CPU slots and adds no run to the log", () => {
    const m = machine()
    threeShortTrueRuns(m)
    const log = readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
    const run = Bun.spawnSync(["bash", SCRIPT, "slots"], { cwd: m.root, env: m.env() })
    expect([run.exitCode, run.stdout.toString()]).toEqual([0, "4\n"])
    expect(readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")).toBe(log)
  })

  test("head still names the waiter it named before", () => {
    const m = machine()
    threeShortTrueRuns(m)
    m.ticket(2, "worker-m", "s2 22 2 medium")
    const run = Bun.spawnSync(["bash", SCRIPT, "head"], { cwd: m.root, env: m.env() })
    expect([run.exitCode, run.stdout.toString()]).toEqual([0, `2-${process.pid}-worker-m\n`])
  })
})

// ops-unstick's heavy-job cap reads this count, so four slots run-slot opens never read as over the cap
describe("slots counts the CPU slots held or open now", () => {
  const slots = (m: ReturnType<typeof machine>) => {
    const run = Bun.spawnSync(["bash", SCRIPT, "slots"], { cwd: m.root, env: m.env() })
    return [run.exitCode, run.stdout.toString()]
  }

  test("all four while the CPU idles and load1 is low", () => {
    expect(slots(machine())).toEqual([0, "4\n"])
  })

  test("run-slot.4-off closes the fourth", () => {
    expect(slots(machine({ off: ["run-slot.4-off"] }))).toEqual([0, "3\n"])
  })
})

// spawn.sh's slots gate reads this line before it admits a new worker
describe("room prints the lanes, the held ones, the ones a run can take and the live waiters", () => {
  const room = (m: ReturnType<typeof machine>) => {
    const run = Bun.spawnSync(["bash", SCRIPT, "room"], { cwd: m.root, env: m.env() })
    return [run.exitCode, run.stdout.toString()]
  }

  test("an idle machine has four free lanes and no one waiting", () => {
    expect(room(machine())).toEqual([0, "4 0 4 0\n"])
  })

  test("held lanes and live tickets count, and a dead waiter's ticket does not", () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 2, "medium")
    m.hold("run-slot-2", 2, "medium")
    m.ticket(2, "worker-a", "s2 22 2 medium")
    m.ticket(3, "worker-b", "s2 21 1 small")
    writeFileSync(join(m.ops, "run-slot.waiters", "4-999999-worker-gone"), "s2 22 2 medium\n")
    expect(room(m)).toEqual([0, "2 2 0 2\n"])
  })

  test("an unheld lane is not free while a medium run's load units do not fit", () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    m.ticket(2, "worker-a", "s2 22 2 medium")
    expect(room(m)).toEqual([0, "2 1 0 1\n"])
  })

  test("under Claude Code's sandbox it reads a live waiter by kill, and the memory it cannot read leaves one lane", () => {
    const m = machine({ sandboxed: true })
    m.ticket(2, "worker-a", "s2 22 2 medium")
    expect(room(m)).toEqual([0, "1 0 1 1\n"])
  })
})

// each subcommand the script dispatches that runs on as a bare `true` is a read: read from the script, so a new one is covered here as it lands
const reads = [
  ...readFileSync(SCRIPT, "utf8").matchAll(
    /^if \[ "\$\{1:-\}" = ([a-z-]+) \]; then\n([\s\S]*?)^fi$/gm,
  ),
]
  .filter(([, , body]) => /^\s*set -- .* -- true$/m.test(body ?? ""))
  .map(([, name, body]) => {
    const usage = (body ?? "").match(/usage: run-slot\.sh ([^"]+)"/)?.[1]?.split(" ") ?? [name]
    const values: Record<string, string> = { "<slot>": "run-slot", "<who>": "worker-probe" }
    return usage.map((word) => {
      if (!word.startsWith("<")) return word
      const value = values[word]
      if (!value) throw new Error(`run-slot.sh ${name}: give ${word} a value in this test`)
      return value
    })
  })

describe("every read subcommand answers as before when the runs log holds three short true runs", () => {
  test("the script's reads are found", () => {
    expect(reads.map((args) => args[0])).toEqual(
      expect.arrayContaining(["can-take", "head", "slots"]),
    )
    // a read written in another shape still counts here, so it fails rather than going untested
    expect(reads).toHaveLength(
      readFileSync(SCRIPT, "utf8").match(/set -- .*-- true\b/g)?.length ?? 0,
    )
  })

  for (const args of reads)
    test(`${args.join(" ")} gives its answer and adds no run to the log`, () => {
      const answer = (short: boolean) => {
        const m = machine()
        m.ticket(2, "worker-m", "s2 22 2 medium")
        if (short) threeShortTrueRuns(m)
        const log = () =>
          existsSync(join(m.ops, "run-slot.runs.log"))
            ? readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
            : ""
        const before = log()
        const run = Bun.spawnSync(["bash", SCRIPT, ...args], { cwd: m.root, env: m.env() })
        return [run.exitCode, run.stdout.toString(), log() === before]
      }
      const short = answer(true)
      expect(short).toEqual(answer(false))
      expect(short[2]).toBe(true)
    })
})

// LANES carries one slot count's lanes verdict inside capacity(), so a value the caller's env holds must steer no check outside a count
describe("a LANES value in the caller's env", () => {
  test("LANES=open leaves slot 2 shut on a machine whose gauges shut the lanes", async () => {
    expect(
      await machine({ idle: 30 }).canTake("run-slot-2", "worker-probe", { LANES: "open" }),
    ).toBe(false)
  })

  test("LANES=shut leaves slot 2 open on a machine whose gauges open the lanes", async () => {
    expect(await machine().canTake("run-slot-2", "worker-probe", { LANES: "shut" })).toBe(true)
  })

  test("slots counts one lane under LANES=open on a machine whose gauges shut the lanes", () => {
    const m = machine({ idle: 30 })
    const run = Bun.spawnSync(["bash", SCRIPT, "slots"], {
      cwd: m.root,
      env: m.env({ LANES: "open" }),
    })
    expect([run.exitCode, run.stdout.toString()]).toEqual([0, "1\n"])
  })
})
