import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { WAITING, machine, shim, stop, subshells, waiter } from "./run-slot-fake"

// each look of the two waits out its own quiet (asleep, its last start the sleep, no look over a whole poll), so the row has about 8 times its quiet time
setDefaultTimeout(300_000)

// issue 1654: one look's process starts climbed with queue depth, 21 a ticket over a base of about 516 (measured at canary 628d629: 516 at depth 0, 936 at depth 20), because ordered_waiters paid a printf|cut and a stat per ticket and first_waiter paid a cat per ticket it walked, so a full folder made every look about twice the process starts of an empty one; this row bounds one head waiter's look beside 20 ranked tickets within a small margin of one beside none
type Machine = ReturnType<typeof machine>
const lines = (f: string) => readFileSync(f, "utf8").split("\n").filter(Boolean)
const lastTop = (err: string) => err.match(/^\+0 .*$/gm)?.at(-1) ?? ""

// one look's starts: a head waiter settled asleep with `depth` ranked tickets behind it, woken by a holder line that changed, counted from before the look's first read to its settling sleep, execs and trace subshells together
const look = async (depth: number) => {
  const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
  m.hold("run-slot", 3, "big")
  m.hold("run-slot-2", 3, "big")
  const { count, path } = shim(m)
  const base = Date.now() * 1e6
  const w = waiter(m, path, "worker-a", ["touch"], { RUN_SLOT_POLL: "2" })
  while (!new RegExp(WAITING.source, "m").test(w.err)) await Bun.sleep(50)
  for (let i = 0; i < depth; i++) m.ticket(base + 1e12 + i * 1e6, `worker-${i}`, "s2 21 1 small")
  for (;;) {
    const at = w.err.length
    await Bun.sleep(3_000)
    if (
      !/^\++\d+ look_mark$/m.test(w.err.slice(at)) &&
      /^\+0 sleep \S+$/.test(lastTop(w.err)) &&
      lines(count).at(-1) === "sleep"
    )
      break
  }
  const from = w.err.length
  const before = lines(count).length
  // a holder line that changes, so the head's next poll looks once
  writeFileSync(
    join(m.ops, "run-slot-2.holder"),
    `worker-held ${process.pid} 2026-10-18T19:00:01Z 3 big\n`,
  )
  while (!/^\++\d+ look_mark$/m.test(w.err.slice(from))) await Bun.sleep(20)
  const mark = w.err.indexOf("look_mark", from)
  while (!(/^\+0 sleep \S+$/m.test(w.err.slice(mark)) && lines(count).at(-1) === "sleep"))
    await Bun.sleep(20)
  const end = w.err.indexOf("\n", w.err.slice(mark).search(/^\+0 sleep \S+$/m) + mark)
  const execs = lines(count).length - before
  const total = execs + subshells(w.err.slice(from, end))
  await stop(w.p)
  expect(existsSync(w.marker)).toBe(false)
  return total
}

describe("one look's process starts stay flat with queue depth", () => {
  test("a head waiter's look beside 20 tickets costs within 60 starts of one beside none", async () => {
    const shallow = await look(0)
    const deep = await look(20)
    expect(deep - shallow).toBeLessThan(60)
  })
})
