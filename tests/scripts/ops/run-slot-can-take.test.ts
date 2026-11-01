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

  test("all four while load1 is under 12", () => {
    expect(slots(machine())).toEqual([0, "4\n"])
  })

  test("run-slot.4-off closes the fourth", () => {
    expect(slots(machine({ off: ["run-slot.4-off"] }))).toEqual([0, "3\n"])
  })

  test("load1 at 12 closes the third and fourth, and a holder keeps each", () => {
    const m = machine({ load1: 12 })
    expect(slots(m)).toEqual([0, "2\n"])
    m.hold("run-slot-3", 2, "medium")
    m.hold("run-slot-4", 2, "medium")
    expect(slots(m)).toEqual([0, "4\n"])
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
  })

  for (const args of reads)
    test(`${args.join(" ")} prints its answer and adds no run to the log`, () => {
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
      expect(answer(true)).toEqual(answer(false))
      expect(answer(true)[2]).toBe(true)
    })
})
