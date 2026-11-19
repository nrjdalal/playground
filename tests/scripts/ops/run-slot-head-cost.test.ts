import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"

import { SCRIPT, machine, shim } from "./run-slot-fake"

// Issue 2852: head reads each held slot's state in one pass, so no `stat` or `date` per held slot, and the held-slot count changes
// nothing, keeping the whole head run at 8 or fewer stat and date starts until it is measured to move.
test("head reads the held slots' state once, no stat or date per slot, and can-take reads one slot", async () => {
  const four = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
  four.hold("run-slot", 3, "big")
  four.hold("run-slot-2", 3, "big")
  four.hold("run-slot-3", 3, "big")
  four.hold("run-slot-4", 3, "big")
  const one = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
  one.hold("run-slot", 3, "big")
  const { count: fhCount, path: fhPath } = shim(four)
  const { count: ohCount, path: ohPath } = shim(one)

  // head, then can-take, each from a clean count so only its own starts tally, each tally read before the next run clears the count
  writeFileSync(fhCount, "")
  const headFour = await run(four, fhPath, fhCount, ["head"])
  const headFourStat = statDate(fhCount)
  writeFileSync(ohCount, "")
  await run(one, ohPath, ohCount, ["head"])
  const headOneStat = statDate(ohCount)
  writeFileSync(fhCount, "")
  const cantake = await run(four, fhPath, fhCount, [
    "can-take",
    "run-slot",
    "worker-x",
    "--",
    "true",
  ])
  const cantakeStat = statDate(fhCount)

  // head: the slot read has no stat or date per held slot, so a one-held-slot machine and a four-held-slot machine read the same, and
  // the whole call stays a handful of starts
  expect(headFourStat.stat + headFourStat.date).toBe(headOneStat.stat + headOneStat.date)
  expect(headFourStat.stat + headFourStat.date).toBeLessThanOrEqual(8)
  expect(headFour).toBeLessThan(60)
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
