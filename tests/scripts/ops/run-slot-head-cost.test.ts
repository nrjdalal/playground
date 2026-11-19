import { expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"

import { SCRIPT, machine, shim } from "./run-slot-fake"

// Issue 2852: on a full four-slot machine head reads no stat or date per held slot, so the run stays 8 or fewer starts.
test("head on a machine whose four slots are all held starts 8 or fewer stat and date processes, so a held slot adds none", async () => {
  const four = machine({ off: ["run-slot.3-off", "run-slot.4-off"] })
  four.hold("run-slot", 3, "big")
  four.hold("run-slot-2", 3, "big")
  four.hold("run-slot-3", 3, "big")
  four.hold("run-slot-4", 3, "big")
  const { count: fhCount, path: fhPath } = shim(four)

  // head, then can-take, each from a clean count so only its own starts tally, each tally read before the next run clears the count
  writeFileSync(fhCount, "")
  const headFour = await run(four, fhPath, fhCount, ["head"])
  const headFourStat = statDate(fhCount)
  writeFileSync(fhCount, "")
  const cantake = await run(four, fhPath, fhCount, [
    "can-take",
    "run-slot",
    "worker-x",
    "--",
    "true",
  ])
  const cantakeStat = statDate(fhCount)

  // a held slot adds no stat or date; a full four-slot machine stays a handful of starts
  expect(headFourStat.stat + headFourStat.date).toBeLessThanOrEqual(8)
  expect(headFour).toBeLessThan(60)
  // can-take reads its one slot and answers the hold, no per-field read, under its first bound
  expect(cantake).toBeLessThan(6)
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
