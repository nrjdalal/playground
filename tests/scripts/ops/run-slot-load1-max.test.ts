import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, set, slots } from "./run-slot-fake"

// a check waits on its run's exit, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a machine at `load1` with load5 10 and the CPU 80% idle, with run-slot.load1-max holding `value` on its last line, below the line a set writes
const withStop = (value: string, load1: number) => {
  const m = machine({ load1, load5: 10 })
  writeFileSync(
    join(m.ops, "run-slot.load1-max"),
    `ops 2026-11-07T15:00:00Z 2099-01-01T00:00:00Z the CPU idle at load1 45\n${value}\n`,
  )
  return m
}

// issue 1442: the load1 stop was a constant, so with the CPU 55 to 57% idle the lanes still shut on load1 and 15 runs waited on one lane
describe("run-slot.load1-max sets the load1 stop for slots 2 to 4", () => {
  test("with the switch absent the stop is 45: load1 44 opens slots 2 to 4 and 45 shuts them", () => {
    expect(slots(machine({ load1: 44, load5: 10 }))).toBe("4\n")
    expect(slots(machine({ load1: 45, load5: 10 }))).toBe("1\n")
  })

  test("set to 60, a load1 of 50 opens them and 60 shuts them", () => {
    expect(slots(withStop("60", 50))).toBe("4\n")
    expect(slots(withStop("60", 60))).toBe("1\n")
  })

  test("the ends 1 and 999 are stops too: 1 opens them at load1 0 and shuts them at 1, and 999 opens them at 998 and shuts them at 999", () => {
    expect(slots(withStop("1", 0))).toBe("4\n")
    expect(slots(withStop("1", 1))).toBe("1\n")
    expect(slots(withStop("999", 998))).toBe("4\n")
    expect(slots(withStop("999", 999))).toBe("1\n")
  })

  test.each(["abc", "0", "1000", "-1", "45.5", ""])(
    "a value that is no whole number from 1 to 999, %j, keeps the stop at 45",
    (value) => {
      expect(slots(withStop(value, 44))).toBe("4\n")
      expect(slots(withStop(value, 45))).toBe("1\n")
    },
  )

  test("past its expiry a switch set to 60 keeps the stop at 45: a load1 of 50 shuts them", () => {
    const m = machine({ load1: 50, load5: 10 })
    writeFileSync(
      join(m.ops, "run-slot.load1-max"),
      "ops 2026-10-22T08:10:00Z 2026-10-22T12:10:00Z the CPU idle at load1 45\n60\n",
    )
    expect(slots(m)).toBe("1\n")
  })

  test("run-slot.sh set writes the value on the line below, and a load1 of 50 then opens them", async () => {
    const m = machine({ load1: 50, load5: 10 })
    expect(
      (await set(m, "ops", "load1-max", "60", "--reason", "the CPU idle at load1 45")).code,
    ).toBe(0)
    expect(readFileSync(join(m.ops, "run-slot.load1-max"), "utf8").trim().split("\n")[1]).toBe("60")
    expect(slots(m)).toBe("4\n")
  })

  test("a set of a switch the script has none of is refused, naming load1-max among the ones it has", async () => {
    const r = await set(machine(), "ops", "load1-min", "--reason", "x")
    expect(r.code).toBe(2)
    expect(r.err).toContain(
      "no switch load1-min (3-off, 4-off, clone-off, focus, idle-min, load1-max, load5-cap, single, off, slot-off)",
    )
  })
})
