import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { WAITING, machine, shim, starts, waiter } from "./run-slot-fake"

// ten waiters' first looks under xtrace and the shims, about 700 process starts each at a queue of 10, took 45 to 110 s at load5 19 to 25 before the window opened (issue 1612, measured), and this row took 233 s beside the other poll-cost files at load5 15 to 34 (issue 1671, measured), so it has about 1.5 times its time
setDefaultTimeout(360_000)

// issue 1338, 7 Nov: sixteen waiters started about 60 processes a second between them, which held load5 between 30 and 42 on 15 cores with the CPU half idle, so the slots they waited for stayed shut
describe("waiters cost close to nothing while they wait", () => {
  // five waiters and a poll of 5 s keep the first looks and the quiet rounds short, since ten waiters at a 15 s poll took 135 s in CI against a file's 60 s (issue 1671, measured); the bound is per waiter and poll, the old 5 a second for ten at a 15 s poll
  test("five queue waiters behind held slots start fewer than 7.5 processes a poll each", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 3, "big")
    const { count, path } = shim(m)
    const waiters = Array.from({ length: 5 }, (_, i) =>
      waiter(m, path, `worker-${i}`, ["touch"], { RUN_SLOT_POLL: "5" }),
    )
    const rate = await starts(count, waiters, new RegExp(WAITING.source, "m"), 10)
    expect((rate * 5) / waiters.length).toBeLessThan(7.5)
  })
})
