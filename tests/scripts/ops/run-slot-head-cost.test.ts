import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"

import { SCRIPT, machine, shim } from "./run-slot-fake"

// one `head` and one `can-take` call start few processes, and read each held slot's state once, with no `stat` or `date` per slot field,
// since the read loop forked one stat and one date per field before (issue 2852, 0.6 to 3.5 s per call at load): head reads the held
// slots in one pass, reusing the clock the call took once, and can-take reads its one slot, so each is a handful of starts, not a read per
// field. The bound is the pass, and the call takes the clock once, not per slot.
test("head reads the held slots' state once, no stat or date per slot, and can-take reads one slot", async () => {
  const m = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
  m.hold("run-slot", 3, "big")
  m.hold("run-slot-2", 3, "big")
  m.hold("run-slot-3", 3, "big")
  m.hold("run-slot-4", 3, "big")
  const { count, path } = shim(m)

  // head, then can-take, each from a clean count so only its own starts tally, each tally read before the next run clears the count
  writeFileSync(count, "")
  const head = await run(m, path, count, ["head"])
  const headStat = statDate(count)
  writeFileSync(count, "")
  const cantake = await run(m, path, count, ["can-take", "run-slot", "worker-x", "--", "true"])
  const cantakeStat = statDate(count)

  // head: the slot read has no stat or date per slot, only the clock the call took once, and the whole call stays a handful of starts
  expect(headStat.stat + headStat.date).toBeLessThan(6)
  expect(head).toBeLessThan(60)
  // can-take reads its one slot and answers the hold, no per-field read
  expect(cantake).toBeLessThanOrEqual(2)
  expect(cantakeStat.stat).toBeLessThan(3)
})

// run one single-shot run-slot call over the shims, resetting the count first, returning its total starts
async function run(
  m: ReturnType<typeof machine>,
  path: string,
  count: string,
  argv: string[],
): Promise<number> {
  writeFileSync(count, "")
  const p = Bun.spawn(["bash", SCRIPT, ...argv], {
    cwd: m.root,
    env: { ...m.env(), PATH: path },
    stdout: "ignore",
    stderr: "ignore",
  })
  await p.exited
  let n = 0
  for (const l of readFileSync(count, "utf8").split("\n")) {
    if (l) n++
  }
  return n
}

// the count file's stat and date starts
function statDate(count: string): { stat: number; date: number } {
  let stat = 0
  let date = 0
  for (const l of readFileSync(count, "utf8").split("\n")) {
    if (l === "stat") stat++
    if (l === "date") date++
  }
  return { stat, date }
}
