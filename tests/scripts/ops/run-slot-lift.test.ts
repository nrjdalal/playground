import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, set, slots } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// issue 1737, 11 Nov: run-slot.single and a load5-cap of 14 stood by timer with load5 at 5.6, and eight runs queued behind one lane on an idle Mac
const UNDER = "run-slot.under"
const now = () => Math.floor(Date.now() / 1000)
// a machine at the load5 given, under run-slot.load5-cap's cap of 14, with the throttles given on and, when `under` is given, load5 read under the cap since that many seconds back
const throttled = (load5: number, off: string[], under?: number) => {
  const m = machine({ load1: 2, load5, off })
  writeFileSync(join(m.ops, "run-slot.load5-cap"), "14\n")
  if (under !== undefined) writeFileSync(join(m.ops, UNDER), `${now() - under}\n`)
  return m
}
const since = (m: ReturnType<typeof machine>) =>
  existsSync(join(m.ops, UNDER)) ? Number(readFileSync(join(m.ops, UNDER), "utf8")) : null

describe("a load throttle lifts by itself once load5 holds under its cap", () => {
  test("single lifts after 5 minutes under the cap, so all four slots open", () => {
    expect(slots(throttled(5, ["run-slot.single"], 301))).toBe("4\n")
  })

  test("single still holds inside the 5 minutes", () => {
    expect(slots(throttled(5, ["run-slot.single"], 60))).toBe("2\n")
  })

  test("the first reading under the cap starts the 5 minutes", () => {
    const m = throttled(5, ["run-slot.single"])
    expect(slots(m)).toBe("2\n")
    expect(Math.abs(since(m)! - now())).toBeLessThanOrEqual(2)
  })

  test("single comes back on when load5 crosses the cap, before its end time", () => {
    const m = throttled(16, ["run-slot.single"], 3600)
    expect(slots(m)).toBe("1\n")
    expect(since(m)).toBeNull()
  })

  test("3-off and 4-off lift the same way", () => {
    const off = ["run-slot.3-off", "run-slot.4-off"]
    expect(slots(throttled(5, off, 301))).toBe("4\n")
    expect(slots(throttled(5, off, 60))).toBe("2\n")
  })

  test("a set of a load throttle starts the 5 minutes again", async () => {
    const m = throttled(5, [], 3600)
    expect((await set(m, "ops", "single", "--reason", "suites one at a time")).code).toBe(0)
    expect(since(m)).toBeNull()
    expect(slots(m)).toBe("2\n")
  })

  test("a waiter held by single takes a slot when the 5 minutes end", async () => {
    const m = throttled(5, ["run-slot.single"], 297)
    m.hold("run-slot", 1, "small")
    m.hold("run-slot-2", 1, "small")
    expect(await m.runs("worker-s", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })
})
