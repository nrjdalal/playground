import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, stop } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

const iso = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`
const BATTERY = /^run-slot\.sh: waiting for the Mac's charge to rise/gm

// ops-awake keeps run-slot.battery standing while the charge is at the red mark and falling, on battery or on a charger losing to the load
const redMark = (m: ReturnType<typeof machine>, ends = Date.now() + 600_000) =>
  writeFileSync(
    join(m.ops, "run-slot.battery"),
    `ops-awake ${iso(Date.now())} ${iso(ends)} the battery is at 4% and falling\n`,
  )

describe("run-slot.battery", () => {
  test("on, a heavy run waits and says it waits for the charge, while ops-tick's upkeep runs", async () => {
    const m = machine()
    redMark(m)
    const run = m.start("worker-x", { RUN_SLOT_SIZE: "small" })
    expect(await run.saw(BATTERY)).toBe(true)
    await stop(run.p)
    expect(await m.waits("worker-x", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(await m.runs("ops-tick", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("on, the session that holds focus waits too, since the battery holds every heavy run", async () => {
    const m = machine()
    redMark(m)
    writeFileSync(
      join(m.ops, "run-slot.focus"),
      `worker-f ${iso(Date.now())} ${iso(Date.now() + 600_000)} demo\n`,
    )
    // the focus pick skips the queue's reads, so its wait shows by its line, with no run behind it
    const run = m.start("worker-f", { RUN_SLOT_SIZE: "small" })
    expect(await run.saw(BATTERY)).toBe(true)
    await Bun.sleep(1_000)
    expect(existsSync(run.marker)).toBe(false)
    await stop(run.p)
  })

  test("lifted by ops-awake's .lifted move once the charge rises, the waiting run starts", async () => {
    const m = machine()
    redMark(m)
    const run = m.start("worker-x", { RUN_SLOT_SIZE: "small" })
    expect(await run.saw(BATTERY)).toBe(true)
    renameSync(
      join(m.ops, "run-slot.battery"),
      join(m.ops, "run-slot.battery.lifted-20261110T2100Z"),
    )
    expect(await run.ran()).toBe(true)
  })

  test("lapsed past its expiry, as when ops-awake has stopped, the switch drops itself and the heavy run goes on", async () => {
    const m = machine()
    redMark(m, Date.now() - 60_000)
    expect(await m.runs("worker-x", { RUN_SLOT_SIZE: "small" })).toBe(true)
    expect(existsSync(join(m.ops, "run-slot.battery"))).toBe(false)
  })
})
