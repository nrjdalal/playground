import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { SCRIPT, stop, machine } from "./run-slot-fake"

// a check waits on a line its run prints or logs, so the timeout only catches a hang
setDefaultTimeout(60_000)

type Machine = ReturnType<typeof machine>
const SPACED = /^run-slot\.sh: this clone waits /gm
const cloning = (m: Machine, who: string, script = SCRIPT) => {
  mkdirSync(join(m.root, "node_modules"), { recursive: true })
  return m.start(who, {}, script, ["cp", "-R", "node_modules"])
}
// whether the clone waited (printed its spacing line and had not run when stopped) or ran
const clone = async (m: Machine, who: string) => {
  const run = cloning(m, who)
  if (await run.saw(SPACED)) {
    await stop(run.p)
    return existsSync(run.marker) ? "ran" : "waited"
  }
  return (await run.ran()) ? "ran" : "ended"
}
const log = (m: Machine) => {
  const path = join(m.ops, "run-slot.runs.log")
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}
// the sessions whose clones have started, in the runs log's order
const started = (m: Machine) =>
  [...log(m).matchAll(/ start (\S+) \d+ run-slot-clone /g)].map((s) => s[1])

// issue 1314, 7 Nov: after a ship the Dashboard roll's clone waited about 17 minutes behind a worker's big test run on run-slot-2, so the live Dashboard stayed on the old version
describe("a big run on a CPU slot", () => {
  test("lets the Dashboard roll's clone start", async () => {
    const m = machine()
    m.hold("run-slot-2", 3, "big")
    expect(await clone(m, "ops-dashboard")).toBe("ran")
  })

  test("while it still holds a worker's clone", async () => {
    const m = machine()
    m.hold("run-slot-2", 3, "big")
    expect(await clone(m, "worker-c")).toBe("waited")
  })

  test("and the roll's clone still waits for the load brake", async () => {
    expect(await clone(machine({ cores: 8, load1: 2, load5: 4 }), "ops-dashboard")).toBe("waited")
  })
})

// issue 1317, 7 Nov: the first waiter to mkdir the clone lane won, so a reviewer's clone asked at 20:47:36Z waited 13385 s, passed by five clones asked after it
describe("the clone lane", () => {
  test("starts the older of two waiting clones first", async () => {
    const m = machine()
    m.hold("run-slot-clone", 1, "small")
    const older = cloning(m, "worker-older")
    // it printed that it waits for the lane and sleeps to its next look, so the newer one asks while the lane is free
    expect(await older.saw(/^run-slot\.sh: waiting for the clone slot/gm)).toBe(true)
    m.release("run-slot-clone")
    const newer = cloning(m, "worker-newer")
    while (started(m).length === 0) await Bun.sleep(50)
    await Promise.all([stop(older.p), stop(newer.p)])
    expect(started(m)[0]).toBe("worker-older")
  })

  test("but the Dashboard roll's clone, class 0, goes before an older worker's", async () => {
    const m = machine()
    m.hold("run-slot-clone", 1, "small")
    const worker = cloning(m, "worker-older")
    expect(await worker.saw(/^run-slot\.sh: waiting for the clone slot/gm)).toBe(true)
    const roll = cloning(m, "ops-dashboard")
    expect(await roll.saw(/^run-slot\.sh: waiting for the clone slot/gm)).toBe(true)
    m.release("run-slot-clone")
    while (started(m).length === 0) await Bun.sleep(50)
    await Promise.all([stop(worker.p), stop(roll.p)])
    expect(started(m)[0]).toBe("ops-dashboard")
  })

  // review round 1: a reread's exec kept the entry while the new copy waited in clone_held, so a clone clone-allow names waited behind a waiter clone-off parked
  test("and a waiter a gate holds after its reread holds back no clone the gate lets through", async () => {
    const m = machine({ pressure: 4 })
    const copy = join(m.root, "run-slot.sh")
    copyFileSync(SCRIPT, copy)
    m.hold("run-slot-clone", 1, "small")
    const parked = cloning(m, "worker-parked", copy)
    expect(await parked.saw(/^run-slot\.sh: waiting for the clone slot/gm)).toBe(true)
    writeFileSync(join(m.ops, "run-slot.clone-off"), "")
    writeFileSync(join(m.ops, "run-slot.clone-allow"), "worker-allowed\n")
    copyFileSync(SCRIPT, `${copy}.new`)
    renameSync(`${copy}.new`, copy)
    expect(await parked.saw(/running the new copy/g)).toBe(true)
    m.release("run-slot-clone")
    const allowed = cloning(m, "worker-allowed", copy)
    // it takes the lane, or says whom it waits behind
    await allowed.saw(
      /^run-slot\.sh: (this clone waits behind \S+|worker-allowed holds run-slot-clone)/gm,
    )
    await Promise.all([stop(parked.p), stop(allowed.p)])
    expect(started(m)).toEqual(["worker-allowed"])
  })

  // issue 1316: a run-slot.sh waiter can outlive its test or die without a clean exit, so no stale place may hold the lane
  test("and a waiter stopped by TERM gives up its place, so the next one takes the lane", async () => {
    const m = machine()
    m.hold("run-slot-clone", 1, "small")
    const stopped = cloning(m, "worker-stopped")
    expect(await stopped.saw(/^run-slot\.sh: waiting for the clone slot/gm)).toBe(true)
    stopped.p.kill("SIGTERM")
    await stopped.p.exited
    expect(readdirSync(join(m.ops, "run-slot.clone-waiters"))).toEqual([])
    m.release("run-slot-clone")
    expect(await clone(m, "worker-c")).toBe("ran")
  })

  const place = (m: Machine, pid: number, started: string) => {
    mkdirSync(join(m.ops, "run-slot.clone-waiters"), { recursive: true })
    writeFileSync(join(m.ops, "run-slot.clone-waiters", `2-1-${pid}-worker-gone`), `${started}\n`)
  }

  test("and a dead waiter's place holds back no clone", async () => {
    const m = machine()
    const gone = Bun.spawn(["true"])
    await gone.exited
    place(m, gone.pid, "Thu Jan 1 00:00:00 1970")
    expect(await clone(m, "worker-c")).toBe("ran")
  })

  test("nor does one whose pid a later process has taken", async () => {
    const m = machine()
    place(m, process.pid, "Thu Jan 1 00:00:00 1970")
    expect(await clone(m, "worker-c")).toBe("ran")
  })
})
