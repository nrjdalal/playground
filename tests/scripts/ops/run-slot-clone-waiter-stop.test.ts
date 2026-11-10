import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, stop, machine } from "./run-slot-fake"

// a check waits on a line its run prints or logs, so the timeout only catches a hang
setDefaultTimeout(60_000)

type Machine = ReturnType<typeof machine>
const cloning = (m: Machine, who: string, extra: Record<string, string> = {}) => {
  mkdirSync(join(m.root, "node_modules"), { recursive: true })
  return m.start(who, extra, SCRIPT, ["cp", "-R", "node_modules"])
}
const places = (m: Machine) => readdirSync(join(m.ops, "run-slot.clone-waiters"))
const log = (m: Machine) => {
  const path = join(m.ops, "run-slot.runs.log")
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}
// the sessions whose clones have started, in the runs log's order
const started = (m: Machine) =>
  [...log(m).matchAll(/ start (\S+) \d+ run-slot-clone /g)].map((s) => s[1])
const ordered = (m: Machine) => {
  const names = places(m).sort()
  return (
    names.length === 2 &&
    names.map((n) => n.split("-").slice(3).join("-")).join(",") === "worker-dropped,worker-newer"
  )
}

// issue 1641: a waiter whose wait loop stops mid-wait lost its place in run-slot.clone-waiters and its run, with no word of why; RUN_SLOT_TEST_LOOP_END ends the loop once the way bash 5.2's loop drop (the rule at the load5 wait) does
describe("a clone waiter whose wait loop stops mid-wait", () => {
  test("says why, keeps its place, and runs once the lane frees", async () => {
    const m = machine()
    m.hold("run-slot-clone", 1, "small")
    const run = cloning(m, "worker-dropped", { RUN_SLOT_TEST_LOOP_END: "1" })
    expect(await run.saw(/ended without the slot/gm)).toBe(true)
    expect(places(m).some((n) => n.endsWith("-worker-dropped"))).toBe(true)
    m.release("run-slot-clone")
    expect(await run.ran()).toBe(true)
    await stop(run.p)
  })

  test("and a newer clone still waits behind it until its place goes on its own take", async () => {
    const m = machine()
    m.hold("run-slot-clone", 1, "small")
    const older = cloning(m, "worker-dropped", { RUN_SLOT_TEST_LOOP_END: "1" })
    expect(await older.saw(/ended without the slot/gm)).toBe(true)
    const newer = cloning(m, "worker-newer")
    while (!ordered(m)) await Bun.sleep(50)
    m.release("run-slot-clone")
    while (started(m).length === 0) await Bun.sleep(50)
    await Promise.all([stop(older.p), stop(newer.p)])
    expect(started(m)[0]).toBe("worker-dropped")
  })
})
