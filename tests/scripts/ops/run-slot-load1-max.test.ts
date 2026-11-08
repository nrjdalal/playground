import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, set, slots } from "./run-slot-fake"

// a check waits on its run's exit, so the timeout only catches a hang
setDefaultTimeout(60_000)

// each row's load5 is 2, under load_line's cap, so it reads the load1 stop alone and slots 2 to 4's load5 wait (issue 1403) stays open
// a machine at 80% idle under `load1` with run-slot.load1-max holding `value` on its last line, below the line a set writes
const withStop = (value: string, load1: number) => {
  const m = machine({ idle: 80, load5: 2, load1 })
  writeFileSync(
    join(m.ops, "run-slot.load1-max"),
    `ops 2026-11-08T00:00:00Z 2099-01-01T00:00:00Z room for the evening batch\n${value}\n`,
  )
  return m
}

// issue 1442: the load1 stop was a constant 45, so the lanes shut while the CPU sat over half idle and 15 runs waited on one lane, with no lever on the stop short of a code change
describe("run-slot.load1-max sets the load1 stop for slots 2 to 4", () => {
  test("with the switch absent the stop is 45: load1 44.9 opens slots 2 to 4 and 45 shuts them", () => {
    expect(slots(machine({ idle: 80, load5: 2, load1: 44.9 }))).toBe("4\n")
    expect(slots(machine({ idle: 80, load5: 2, load1: 45 }))).toBe("1\n")
  })

  test("set to 60, a load1 of 50 opens them and 60 shuts them", () => {
    expect(slots(withStop("60", 50))).toBe("4\n")
    expect(slots(withStop("60", 60))).toBe("1\n")
  })

  test.each(["abc", "0", "1000", "-1", "60.5", ""])(
    "a value that is no whole number from 1 to 999, %j, keeps the stop at 45",
    (value) => {
      expect(slots(withStop(value, 44.9))).toBe("4\n")
      expect(slots(withStop(value, 45))).toBe("1\n")
    },
  )

  test("past its expiry a switch set to 60 keeps the stop at 45: a load1 of 50 shuts them", () => {
    const m = machine({ idle: 80, load5: 2, load1: 50 })
    writeFileSync(
      join(m.ops, "run-slot.load1-max"),
      "ops 2026-10-22T08:10:00Z 2026-10-22T12:10:00Z room for the evening batch\n60\n",
    )
    expect(slots(m)).toBe("1\n")
  })

  test("run-slot.sh set writes the value on the line below, and a load1 of 50 then opens them", async () => {
    const m = machine({ idle: 80, load5: 2, load1: 50 })
    expect(
      (await set(m, "ops", "load1-max", "60", "--reason", "room for the evening batch")).code,
    ).toBe(0)
    expect(readFileSync(join(m.ops, "run-slot.load1-max"), "utf8").trim().split("\n")[1]).toBe("60")
    expect(slots(m)).toBe("4\n")
  })

  test("a set of a switch the script has none of is refused, naming load1-max among the ones it has", async () => {
    const m = machine()
    const r = await set(m, "ops", "load1-min", "--reason", "x")
    expect(r.code).toBe(2)
    expect(r.err).toContain(
      "no switch load1-min (3-off, 4-off, clone-off, focus, idle-min, load1-max, load5-cap, single, off, slot-off)",
    )
  })
})
