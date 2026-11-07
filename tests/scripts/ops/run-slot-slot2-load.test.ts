import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { WAITING, machine } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// A machine with run-slot held by a small run, which leaves room for a medium one, and slots 3 and 4 off, so a medium run can take only run-slot-2, at load1 2 and the load5 given, with run-slot.load5-cap's cap when one is given
const loaded = (load5: number, cap?: number) => {
  const m = machine({ load1: 2, load5, off: ["run-slot.3-off", "run-slot.4-off"] })
  m.hold("run-slot", 1, "small")
  if (cap !== undefined) writeFileSync(join(m.ops, "run-slot.load5-cap"), `${cap}\n`)
  // moves the fake load5 from one figure to another in sysctl and uptime, as a load that falls
  const setLoad5 = (from: number, to: number) => {
    for (const bin of ["sysctl", "uptime"]) {
      const path = join(m.bin, bin)
      writeFileSync(path, readFileSync(path, "utf8").split(from.toFixed(2)).join(to.toFixed(2)))
    }
  }
  const lane = (who: string) =>
    readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
      .split("\n")
      .find((l) => l.split(" ")[1] === "start" && l.split(" ")[2] === who)
      ?.split(" ")[4]
  return { ...m, lane, setLoad5 }
}
const MEDIUM = { RUN_SLOT_SIZE: "medium" }

// issue 1403, 7 Nov 11:07Z: two checker suites, one in run-slot and one in run-slot-2, took load5 to 17.96 on their own, since slot 2 took a holder at the cap unless single-slot mode was on
describe("run-slot-2 with single-slot mode off", () => {
  test("waits while load5 is at or over run-slot.load5-cap's cap", async () => {
    expect(await loaded(18, 15).waits("worker-m", MEDIUM)).toBe(true)
  })

  test("and takes its holder once load5 is under the cap", async () => {
    const m = loaded(18, 15)
    const run = m.start("worker-m", MEDIUM)
    expect(await run.saw(WAITING)).toBe(true)
    m.setLoad5(18, 10)
    expect(await run.ran()).toBe(true)
    expect(m.lane("worker-m")).toBe("run-slot-2")
  })

  test("waits under load_line's 22 while no switch stands", async () => {
    expect(await loaded(23).waits("worker-m", MEDIUM)).toBe(true)
  })

  test("takes it at once under the cap", async () => {
    const m = loaded(14, 15)
    expect(await m.runs("worker-m", MEDIUM)).toBe(true)
    expect(m.lane("worker-m")).toBe("run-slot-2")
  })

  test("and takes it once the run has waited LOAD_WAIT s, with load5 still at the cap", async () => {
    const m = loaded(18, 15)
    expect(await m.runs("worker-m", { ...MEDIUM, RUN_SLOT_LOAD_WAIT: "2" })).toBe(true)
    expect(m.lane("worker-m")).toBe("run-slot-2")
  })

  for (const who of ["ops-dashboard", "ops-merge-train"])
    test(`but ${who} takes it at the cap`, async () => {
      const m = loaded(18, 15)
      expect(await m.runs(who, MEDIUM)).toBe(true)
      expect(m.lane(who)).toBe("run-slot-2")
    })
})
