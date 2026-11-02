import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { capacityLog, placing, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

const LANES = ["run-slot", "run-slot-2", "run-slot-3", "run-slot-4"]

// run-slot's state in the case's own home (spawn-fake's mkdtemp scratch): `held` lanes held by this live test process, and `waiters` live tickets in its queue.
const slots =
  (held: number, waiters: number) =>
  (home: string): void => {
    const ops = join(home, ".playground", "ops")
    for (const lane of LANES.slice(0, held)) {
      mkdirSync(join(ops, lane), { recursive: true })
      writeFileSync(
        join(ops, `${lane}.holder`),
        `worker-held ${process.pid} 2026-11-02T18:00:00Z 2 medium\n`,
      )
    }
    const queue = join(ops, "run-slot.waiters")
    mkdirSync(queue, { recursive: true })
    for (let i = 0; i < waiters; i++)
      writeFileSync(
        join(queue, `${1_000_000 + i}-${process.pid}-worker-wait${i}`),
        "s2 22 2 medium\n",
      )
  }

describe("the slots gate admits a new worker only when run-slot has room for its runs", () => {
  test("a worker start is refused while every lane is held and waiters queue", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {},
      undefined,
      undefined,
      slots(4, 2),
    )
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      "the slots gate holds it: run-slot's 4 lanes are all held and 2 runs wait in its queue (run-slot.sh room)",
    )
    expect(capacityLog(r)).toEqual([
      expect.objectContaining({
        gate: "slots",
        readings: expect.objectContaining({ lanes: 4, lanes_held: 4, waiters: 2 }),
        verdict: "refused",
      }),
    ])
  })

  test.each(["reviewer", "tester"])("a %s start passes on the same full lanes", async (role) => {
    const r = await spawn(
      ["column", role, `${role}-x`, "worker-x", "w1:p2", "b.md"],
      [],
      {},
      undefined,
      undefined,
      slots(4, 2),
    )
    expect(r.code).toBe(0)
    expect(capacityLog(r)).toEqual([expect.objectContaining({ verdict: "pass" })])
  })

  test("a worker start passes while a lane is free, waiters or not", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {},
      undefined,
      undefined,
      slots(3, 2),
    )
    expect(r.code).toBe(0)
    expect(capacityLog(r)).toEqual([
      expect.objectContaining({
        readings: expect.objectContaining({ lanes: 4, lanes_held: 3, waiters: 2 }),
        verdict: "pass",
      }),
    ])
  })

  test("a worker start passes on held lanes with no one waiting", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {},
      undefined,
      undefined,
      slots(4, 0),
    )
    expect(r.code).toBe(0)
    expect(capacityLog(r)).toEqual([expect.objectContaining({ verdict: "pass" })])
  })
})
