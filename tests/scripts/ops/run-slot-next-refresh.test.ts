import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine, runSlot, stop } from "./run-slot-fake"

// a check waits on its run's exit, so the timeout only catches a hang
setDefaultTimeout(60_000)

// issue 1477, 7 Nov 17:21 to 17:52Z: a reviewer's ticket sat 30 minutes while every fresh head read named it,
// because the oldest waiter's look had named a bigger ticket under its own frozen lanes verdict and the verdict
// it passed over never reached run-slot.next again: capacity counts the slots the lanes open, so first_waiter's
// pick moves with the verdict, and a waiter behind the head looks again on nothing but run-slot.next, the
// priority and the focus. These rows hold the oldest to naming, within a poll or two, whoever a fresh read names.

type Machine = ReturnType<typeof machine>

// two paper tickets behind the live oldest waiter, whose ns names sit after its spawn's so the oldest stays the
// oldest and writes run-slot.next: a reviewer's medium, which fits the lanes open alone (4 held of 8, class 4
// ahead of the plain), and a plain small, which fits both verdicts (4 held of 6 shut)
const trio = () => {
  const now = Date.now()
  const ns2 = now * 1e6 + 60e9
  const ns3 = now * 1e6 + 120e9
  return { ns2, ns3 }
}
// the fake top reading `idle` next, and the gauges cache staled, so the next gauges read lands on it
const flip = (m: Machine, idle: number) => {
  writeFileSync(
    join(m.bin, "top"),
    `#!/bin/bash\necho "$*" >> ${join(m.root, "top.log")}\necho "CPU usage: 1.00% user, 1.00% sys, 98.00% idle "\necho "CPU usage: ${((100 - idle) / 2).toFixed(2)}% user, ${((100 - idle) / 2).toFixed(2)}% sys, ${idle}% idle "\n`,
  )
  writeFileSync(join(m.ops, "run-slot.gauges"), "0 80 0 120 3.50\n")
}
// a fresh read, whose own lanes reading reads the gauges as they are now
const head = async (m: Machine) => {
  const p = runSlot(["bash", SCRIPT, "head"], {
    cwd: m.root,
    env: m.env(),
    stdout: "pipe",
    ops: m.ops,
  })
  return (await new Response(p.stdout).text()).trim()
}

describe("the oldest names the queue's fresh pick through a lanes flip", () => {
  test("one the gauges shut within a poll or two of its open-lanes look, as a fresh head read names it", async () => {
    const m = machine({ load1: 2, load5: 2 })
    m.hold("run-slot-3", 2, "medium")
    m.hold("run-slot-4", 2, "medium")
    const { ns2, ns3 } = trio()
    m.ticket(ns2, "rt2-reviewer", "s2 22 2 medium")
    m.ticket(ns3, "worker-t3", "s2 21 1 small")
    const t2 = `${ns2}-${process.pid}-rt2-reviewer`
    const t3 = `${ns3}-${process.pid}-worker-t3`
    const named = () =>
      existsSync(join(m.ops, "run-slot.next"))
        ? readFileSync(join(m.ops, "run-slot.next"), "utf8")
        : ""
    const w = m.start("worker-w", { RUN_SLOT_POLL: "0.2", RUN_SLOT_SIZE: "big" })
    // the open-lanes look names the reviewer's medium, the first in the order that fits 4 held of 8
    while (!named().startsWith(t2)) await Bun.sleep(20)
    flip(m, 30)
    await Bun.sleep(2_000)
    // the fresh read names the small ticket the frozen verdict never named again, and the oldest follows it
    expect(await head(m)).toBe(t3)
    expect(named().startsWith(t3)).toBe(true)
    expect(existsSync(join(m.ops, "run-slot.holder"))).toBe(false)
    await stop(w.p)
  })

  // the direction the head already watched, so the flip in both directions keeps its naming
  test("and one the gauges open within a poll or two of its shut-lanes look, as a fresh head read names it", async () => {
    const m = machine({ idle: 30, load1: 2, load5: 2 })
    m.hold("run-slot-3", 2, "medium")
    m.hold("run-slot-4", 2, "medium")
    const { ns2, ns3 } = trio()
    m.ticket(ns2, "rt2-reviewer", "s2 22 2 medium")
    m.ticket(ns3, "worker-t3", "s2 21 1 small")
    const t2 = `${ns2}-${process.pid}-rt2-reviewer`
    const t3 = `${ns3}-${process.pid}-worker-t3`
    const named = () =>
      existsSync(join(m.ops, "run-slot.next"))
        ? readFileSync(join(m.ops, "run-slot.next"), "utf8")
        : ""
    const w = m.start("worker-w", { RUN_SLOT_POLL: "0.2", RUN_SLOT_SIZE: "big" })
    // the shut-lanes look names the small ticket, the first in the order that fits 4 held of 6
    while (!named().startsWith(t3)) await Bun.sleep(20)
    flip(m, 80)
    await Bun.sleep(2_000)
    expect(await head(m)).toBe(t2)
    expect(named().startsWith(t2)).toBe(true)
    expect(existsSync(join(m.ops, "run-slot.holder"))).toBe(false)
    await stop(w.p)
  })
})
