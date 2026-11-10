import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { SCRIPT, WAITING, machine, runSlot, shim, starts, waiter } from "./run-slot-fake"

// ten waiters' first looks under xtrace and the shims, about 700 process starts each at a queue of 10, took 45 to 110 s at load5 19 to 25 before the window opened (issue 1612, measured), and this row took 236 s beside the other poll-cost files at load5 15 to 34 (issue 1671, measured), so it has about 1.5 times its time
setDefaultTimeout(360_000)

// issue 1338, 7 Nov: sixteen waiters started about 60 processes a second between them, which held load5 between 30 and 42 on 15 cores with the CPU half idle, so the slots they waited for stayed shut
describe("waiters cost close to nothing while they wait", () => {
  // a count of polls to look again on (an older copy's 20) sets each waiter looking within the window, about 900 to 2,200 processes a look with ten tickets
  // round 4 of the review: every waiter's mark shared one path, which a read subcommand's exit removed, so each run's end set every waiter looking
  test("ten queue waiters across 25 polls, with nothing changed but a read of the slots, start fewer than 20 processes a poll", async () => {
    const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 3, "big")
    const { count, path } = shim(m)
    const waiters = Array.from({ length: 10 }, (_, i) =>
      waiter(m, path, `worker-${i}`, ["touch"], { RUN_SLOT_POLL: "1" }),
    )
    // a read subcommand, run outside the shims, so only the waiters' own starts count
    const slots = async () => {
      await Bun.sleep(5_000)
      await runSlot(["bash", SCRIPT, "slots"], {
        cwd: m.root,
        env: m.env(),
        stdout: "ignore",
        stderr: "ignore",
        ops: m.ops,
      }).exited
    }
    expect(await starts(count, waiters, new RegExp(WAITING.source, "m"), 25, slots)).toBeLessThan(
      20,
    )
  })
})
