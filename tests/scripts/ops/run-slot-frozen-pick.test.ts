import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { WAITING, machine, stop, within } from "./run-slot-fake"

// the frozen pick, as Ops' A/B measured it live on v0.0.95 (17:04:36Z to 17:07:15Z): a waiter behind the head wakes only on the next line (cheap_idle's else branch), so a freeing - a holder's end, a SIG change - with next unchanged leaves it asleep; the pick's look mark stayed at 16:58Z through the no-op switch bump and the freed gate, and the queue moved the second the walk's answer changed (44951 named and started within 1s). The wall is a rank-1 ticket of a live process that never looks, so nothing rewrites next and the pick stays behind it.
setDefaultTimeout(60_000)

// three holds put five held units up: c=8 with the reserve 2 means the big wall needs h<=3 and the medium pick h<=4, so nothing fits until the freeing drops the held to 4, which fits the pick alone - the wall reads closed before and after, so next's content never changes
const stalled = (m: ReturnType<typeof machine>) => {
  m.hold("run-slot", 3, "big")
  m.hold("run-slot-2", 1, "small")
  m.hold("run-slot-3", 1, "small")
  m.ticket(1, "worker-wall", "0 23 3 big", 120)
}

describe("a stable pick behind a wall", () => {
  test("a freeing with next unchanged starts the pick within one poll", async () => {
    const m = machine()
    stalled(m)
    const w = m.start("worker-pick", { RUN_SLOT_SIZE: "medium" })
    expect(await w.saw(WAITING)).toBe(true)
    // the freeing: the gate's slot ends, a holder's end, which is a SIG change the else branch never read
    m.release("run-slot-3")
    await within(() => existsSync(w.marker), "the pick to start once the freeing landed", m)
    await w.p.exited
    expect(existsSync(w.marker)).toBe(true)
  })

  test("with no freeing the pick sleeps through its polls", async () => {
    const m = machine()
    stalled(m)
    const w = m.start("worker-pick", { RUN_SLOT_SIZE: "medium" })
    expect(await w.saw(WAITING)).toBe(true)
    await Bun.sleep(1_500)
    expect(existsSync(w.marker)).toBe(false)
    await stop(w.p)
  })

  test("a look signature bump with next unchanged leaves the pick asleep", async () => {
    const m = machine()
    stalled(m)
    const w = m.start("worker-pick", { RUN_SLOT_SIZE: "medium" })
    expect(await w.saw(WAITING)).toBe(true)
    // the bump: a no-op switch, Ops' 17:04:36Z idle-min write; a look is not a start, and the stable next line holds the pick
    writeFileSync(
      join(m.ops, "run-slot.noop"),
      "ops 2026-11-11T12:00:00Z 2026-11-12T12:00:00Z the bump\n",
    )
    await Bun.sleep(1_500)
    expect(existsSync(w.marker)).toBe(false)
    await stop(w.p)
  })
})
