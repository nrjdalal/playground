import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine, slots, stop, within } from "./run-slot-fake"

// the verdicts answer for the holds the wait loop obeys: battery_holds and focus_holds gate the wait loop first (run-slot.sh's hold check), and can-take and room answer for them too, so a hold reads closed to every check while it keeps a fitting head waiter from taking (issue 1818: at 12:52:45Z can-take answered takeable beside a waiter that took nothing, both reads saying the lane was free); an idle share that reads - is a dark sensor, not a busy CPU, so it keeps the slots open too (issue 1818, the 15:20Z lanes shut with why=cpu idle=-% on an idle machine)
setDefaultTimeout(60_000)

// the battery switch, held for the row: its line's third field is its expiry, a day out
const battery = (m: ReturnType<typeof machine>) =>
  writeFileSync(
    join(m.ops, "run-slot.battery"),
    "ops 2026-11-11T12:00:00Z 2026-11-12T12:00:00Z held for the row\n",
  )

// what `run-slot.sh room` prints: "<lanes> <held> <free> <waiters>"
const room = (m: ReturnType<typeof machine>) =>
  Bun.spawnSync(["bash", SCRIPT, "room"], { cwd: m.root, env: m.env() }).stdout.toString().trim()

// a fake top that prints no CPU usage line, so the gauges' idle share reads -
const darkTop = (m: ReturnType<typeof machine>) => {
  writeFileSync(join(m.bin, "top"), "#!/bin/bash\necho no cpu usage reading\n")
  chmodSync(join(m.bin, "top"), 0o755)
}

describe("a hold the wait loop obeys", () => {
  test("can-take and room answer closed beside the hold the wait loop obeys", async () => {
    const m = machine()
    battery(m)
    const w = m.start("worker-h", {})
    // the hold names itself on the waiter's stderr
    expect(await w.saw(/waiting for the Mac's charge to rise/)).toBe(true)
    const ticket = m.tickets().find((t) => t.endsWith("-worker-h"))
    expect(ticket).toBeDefined()
    // the verdicts answer for the hold: the lane reads closed to both, as it reads to the wait loop
    expect(await m.canTake("run-slot", ticket!)).toBe(false)
    expect(room(m)).toBe("4 0 0 1")
    // no start across three polls while the hold stands
    await Bun.sleep(700)
    expect(existsSync(w.marker)).toBe(false)
    await stop(w.p)
  })

  test("once the hold lifts, the start lands within one poll", async () => {
    const m = machine()
    battery(m)
    const w = m.start("worker-h", {})
    expect(await w.saw(/waiting for the Mac's charge to rise/)).toBe(true)
    rmSync(join(m.ops, "run-slot.battery"))
    await within(() => existsSync(w.marker), "the run to start once the battery hold lifted", m)
    await w.p.exited
    expect(existsSync(w.marker)).toBe(true)
  })

  test("an idle share that reads - keeps slots 2 to 4 open on an idle machine", () => {
    const m = machine()
    darkTop(m)
    expect(slots(m)).toBe("4\n")
  })
})
