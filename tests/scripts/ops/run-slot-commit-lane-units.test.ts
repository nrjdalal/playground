import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { holdLane, machine } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 06:41Z, 3 Nov: a cold next build in a pre-commit ran on run-slot-commit beside a node_modules clone with no units held, and load1 reached 56
describe("the commit and clone lanes hold load units", () => {
  test("a big run waits while a commit's build and a clone hold their lanes", async () => {
    const m = machine({ poll: 0.05 })
    holdLane(m, "run-slot-commit", "commit-wt")
    holdLane(m, "run-slot-clone", "worker-c")
    expect(await m.waits("worker-b", { RUN_SLOT_SIZE: "big" })).toBe(true)
  })

  test("a medium run still starts beside them", async () => {
    const m = machine({ poll: 0.05 })
    holdLane(m, "run-slot-commit", "commit-wt")
    holdLane(m, "run-slot-clone", "worker-c")
    expect(await m.runs("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  // idle 30 keeps slots 2 to 4 shut, so one CPU slot is open and 2 units are the whole capacity
  test("a small run still starts beside a held commit lane while one CPU slot is open", async () => {
    const m = machine({ idle: 30, poll: 0.05 })
    holdLane(m, "run-slot-commit", "commit-wt")
    expect(await m.runs("worker-s", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("a run that gates a merge still starts beside a held clone lane while one CPU slot is open", async () => {
    const m = machine({ idle: 30, poll: 0.05 })
    holdLane(m, "run-slot-clone", "worker-c")
    expect(await m.runs("ops-checks-1", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })

  test("a medium run waits beside a held commit lane while one CPU slot is open", async () => {
    const m = machine({ idle: 30, poll: 0.05 })
    holdLane(m, "run-slot-commit", "commit-wt")
    expect(await m.waits("worker-m", { RUN_SLOT_SIZE: "medium" })).toBe(true)
  })
})
