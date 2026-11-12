import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, set, slots } from "./run-slot-fake"

// a check waits on its run's exit, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a machine at `idle`% under load1 18 with run-slot.idle-min holding `value` on its last line, below the line a set writes
const withBar = (value: string, idle: number) => {
  const m = machine({ idle, load1: 18 })
  writeFileSync(
    join(m.ops, "run-slot.idle-min"),
    `ops 2026-11-07T15:00:00Z 2099-01-01T00:00:00Z more of the cores in use\n${value}\n`,
  )
  return m
}

// issue 1431: the 40% bar was a constant, so on a machine whose owner wants more of its cores in use Ops had no way to lower it short of a code change
describe("run-slot.idle-min sets the CPU idle bar for slots 2 to 4", () => {
  test("with the switch absent the bar is 40: 39.9% idle shuts slots 2 to 4 and 40% opens them", () => {
    expect(slots(machine({ idle: 39.9, load1: 18 }))).toBe("1\n")
    expect(slots(machine({ idle: 40, load1: 18 }))).toBe("4\n")
  })

  test("set to 15, a 20% idle reading opens them and 14.9% shuts them", () => {
    expect(slots(withBar("15", 20))).toBe("4\n")
    expect(slots(withBar("15", 14.9))).toBe("1\n")
  })

  test.each(["abc", "101", "-1", "15.5", ""])(
    "a value that is no whole number from 0 to 100, %j, keeps the bar at 40",
    (value) => {
      expect(slots(withBar(value, 39.9))).toBe("1\n")
      expect(slots(withBar(value, 40))).toBe("4\n")
    },
  )

  test("past its expiry a switch set to 15 keeps the bar at 40: a 20% idle reading shuts them", () => {
    const m = machine({ idle: 20, load1: 18 })
    writeFileSync(
      join(m.ops, "run-slot.idle-min"),
      "ops 2026-10-22T08:10:00Z 2026-10-22T12:10:00Z more of the cores in use\n15\n",
    )
    expect(slots(m)).toBe("1\n")
  })

  test("run-slot.sh set writes the value on the line below, and a 20% idle reading then opens them", async () => {
    const m = machine({ idle: 20, load1: 18 })
    expect(
      (await set(m, "ops", "idle-min", "15", "--reason", "more of the cores in use")).code,
    ).toBe(0)
    expect(readFileSync(join(m.ops, "run-slot.idle-min"), "utf8").trim().split("\n")[1]).toBe("15")
    expect(slots(m)).toBe("4\n")
  })

  test("a set of a switch the script has none of is refused, naming idle-min among the ones it has", async () => {
    const m = machine()
    const r = await set(m, "ops", "idle-max", "--reason", "x")
    expect(r.code).toBe(2)
    expect(r.err).toContain(
      "no switch idle-max (3-off, 4-off, clone-off, focus, idle-min, load1-max, load5-cap, single, off, slot-off)",
    )
  })
})
