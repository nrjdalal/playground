import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { capacityLog, placing, root, scratch, script, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

const LANES = ["run-slot", "run-slot-2", "run-slot-3", "run-slot-4"]

// run-slot's state in the case's own home (spawn-fake's mkdtemp scratch): `held` lanes held by this live test process with `units` load units each, and `waiters` live tickets in its queue.
const slots =
  (held: number, waiters: number, units = 2) =>
  (home: string): void => {
    const ops = join(home, ".playground", "ops")
    for (const lane of LANES.slice(0, held)) {
      mkdirSync(join(ops, lane), { recursive: true })
      writeFileSync(
        join(ops, `${lane}.holder`),
        `worker-held ${process.pid} 2026-11-02T18:00:00Z ${units} medium\n`,
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

const start = (args: string[], held: number, waiters: number, units?: number) =>
  spawn(args, [], {}, undefined, undefined, slots(held, waiters, units))
const worker = ["worker", "worker-brave-otter", "b.md"]

describe("the slots gate admits a new worker only when run-slot has room for its runs", () => {
  test("a worker start is refused while every lane is held and waiters queue", async () => {
    const r = await start(worker, 4, 2)
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      "the slots gate holds it: run-slot's 4 lanes are all held, and 2 runs wait in its queue (run-slot.sh room)",
    )
    expect(capacityLog(r)).toEqual([
      expect.objectContaining({
        gate: "slots",
        readings: expect.objectContaining({ lanes: 4, lanes_free: 0, lanes_held: 4, waiters: 2 }),
        verdict: "refused",
      }),
    ])
  })

  test("a worker start is refused while the free lanes lack the load units for a run", async () => {
    const r = await start(worker, 2, 1, 3)
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(
      "the slots gate holds it: 2 of run-slot's 4 lanes are held and the rest lack the load units for a run, and 1 run waits in its queue",
    )
  })

  test.each(["reviewer", "tester"])("a %s start passes on the same full lanes", async (role) => {
    const r = await start(["column", role, `${role}-x`, "worker-x", "w1:p2", "b.md"], 4, 2)
    expect(r.code).toBe(0)
    expect(capacityLog(r)).toEqual([expect.objectContaining({ verdict: "pass" })])
  })

  test("a worker start passes while a lane is free with the load units for a run, waiters or not", async () => {
    const r = await start(worker, 3, 2, 1)
    expect(r.code).toBe(0)
    expect(capacityLog(r)).toEqual([
      expect.objectContaining({
        readings: expect.objectContaining({ lanes: 4, lanes_free: 1, lanes_held: 3, waiters: 2 }),
        verdict: "pass",
      }),
    ])
  })

  test("a worker start passes on held lanes with no one waiting", async () => {
    const r = await start(worker, 4, 0)
    expect(r.code).toBe(0)
    expect(capacityLog(r)).toEqual([expect.objectContaining({ verdict: "pass" })])
  })

  test("a worker start is refused when run-slot.sh room gives no reading", async () => {
    // a scratch checkout holding spawn.sh, its data-folder resolver and a run-slot.sh that prints nothing
    const checkout = mkdtempSync(join(scratch, "no-room-"))
    mkdirSync(join(checkout, "scripts", "ops"), { recursive: true })
    writeFileSync(join(checkout, "scripts", "spawn.sh"), readFileSync(script))
    writeFileSync(join(checkout, "scripts", "ops", "run-slot.sh"), "#!/bin/bash\nexit 0\n")
    chmodSync(join(checkout, "scripts", "ops", "run-slot.sh"), 0o755)
    mkdirSync(join(checkout, "packages", "env", "src"), { recursive: true })
    for (const file of ["aliases.ts", "data-dir.ts"])
      writeFileSync(
        join(checkout, "packages", "env", "src", file),
        readFileSync(join(root, "packages", "env", "src", file)),
      )
    const r = await spawn(worker, [], {}, join(checkout, "scripts", "spawn.sh"))
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      "the slots gate holds it: it cannot read run-slot's lanes and queue (run-slot.sh room)",
    )
  })
})
