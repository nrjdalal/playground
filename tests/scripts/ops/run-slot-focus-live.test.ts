import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine, runSlot, set, type Setup } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

type Machine = ReturnType<typeof machine>

// what `run-slot.sh room` prints: "<lanes> <held> <free> <waiters>"
const room = (m: Machine) =>
  Bun.spawnSync(["bash", SCRIPT, "room"], { cwd: m.root, env: m.env() }).stdout.toString().trim()

// a roster of the focus session's row at `status` beside the queued run's own
const roster = (status: string) => ({
  agents: [
    { name: "worker-f", status },
    { name: "worker-h", status: "working" },
  ],
})

// one queued run's ticket, the 4 lanes free
const queued = (setup: Setup) => {
  const m = machine(setup)
  m.ticket(2, "worker-h", "s2 21 1 small")
  return m
}
const TICKET = `2-${process.pid}-worker-h`

// PG-3184, 27 Nov 10:01Z: room read "4 0 0 4" under a focus on `firefighting`, which no session held, so every lane idled
describe("run-slot.focus on a name no live session holds leaves the lanes to the queue", () => {
  for (const [what, setup, who] of [
    ["a name the roster has no row for", { roster: roster("working") }, "worker-gone"],
    ["an ended session", { roster: roster("ended") }, "worker-f"],
    [
      "firefighting without the urgent guard's hold reason",
      { roster: roster("working") },
      "firefighting",
    ],
  ] as const)
    test(`a focus on ${what}: can-take and room let the queued run take a lane, and it runs`, async () => {
      const m = queued(setup)
      await set(m, who, "focus", "--for", "30m", "--reason", "demo")
      expect(await m.canTake("run-slot", TICKET)).toBe(true)
      expect(room(m)).toBe("4 0 4 1")
      // the ticket stands in for a waiter that never takes its lane, so the run itself goes on a machine without it
      const bare = machine(setup)
      await set(bare, who, "focus", "--for", "30m", "--reason", "demo")
      expect(await bare.runs("worker-h", { RUN_SLOT_SIZE: "small" })).toBe(true)
    })
})

describe("run-slot.focus on a live session still holds the other runs", () => {
  for (const [what, setup, who, reason] of [
    ["a working roster row", { roster: roster("working") }, "worker-f", "demo"],
    ["a starting roster row", { roster: roster("starting") }, "worker-f", "demo"],
    // the urgent guard's stand-in for the owner fixing an Urgent ticket himself, with no session named in ff-session
    [
      "firefighting under the urgent guard's hold",
      { roster: roster("working") },
      "firefighting",
      "Ops firefighting hold: headsup-1 open",
    ],
    // a roster that does not read cannot say the session is gone, so the hold stands as before
    ["a name, with no roster to read", {}, "worker-f", "demo"],
  ] as const)
    test(`a focus on ${what}: can-take and room hold the queued run, and it waits`, async () => {
      const m = queued(setup)
      await set(m, who, "focus", "--for", "30m", "--reason", reason)
      expect(await m.canTake("run-slot", TICKET)).toBe(false)
      expect(room(m)).toBe("4 0 0 1")
      const bare = machine(setup)
      await set(bare, who, "focus", "--for", "30m", "--reason", reason)
      expect(await bare.waits("worker-h", { RUN_SLOT_SIZE: "small" })).toBe(true)
    })
})

// #3179's org window keeps a lane for an org's run, which takes the last one open; focus on a live session holds that run too, and on a dead name lets it go
describe("run-slot.focus beside an org job's window, run-slot and run-slot-2 held", () => {
  const windowed = (status: string) => {
    const m = machine({
      roster: {
        agents: [
          ...roster(status).agents,
          { name: "worker-lw", repo: "acme-co/web", status: "working" },
        ],
      },
      windowJob: "acme-start",
    })
    const ops = join(m.root, "claude", "playground", "ops")
    mkdirSync(ops, { recursive: true })
    writeFileSync(
      join(ops, "jobs.json"),
      JSON.stringify({ jobs: [{ config: {}, name: "acme-start", org: "acme-co" }] }),
    )
    m.hold("run-slot", 1, "small")
    m.hold("run-slot-2", 1, "small")
    return m
  }

  test("a focus on a live session holds an org's run", async () => {
    const m = windowed("working")
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "demo")
    expect(await m.waits("worker-lw", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("a focus on an ended session lets an org's run take a lane", async () => {
    const m = windowed("ended")
    await set(m, "worker-f", "focus", "--for", "30m", "--reason", "demo")
    expect(await m.runs("worker-lw", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })
})

// preempt reads focus as the wait loop does, so a focus no session holds stops no one's run
test("preempt under a focus on a name no live session holds stops nothing and says so", async () => {
  const m = machine({ roster: roster("ended") })
  m.hold("run-slot", 1, "small")
  const run = Bun.spawn(["sleep", "60"])
  writeFileSync(join(m.ops, "run-slot.child"), `${run.pid}\n`)
  await set(m, "worker-f", "focus", "--for", "30m", "--reason", "demo")
  const p = runSlot(["bash", SCRIPT, "preempt"], {
    cwd: m.root,
    env: m.env(),
    stderr: "pipe",
    ops: m.ops,
  })
  expect(await p.exited).toBe(2)
  expect(await new Response(p.stderr).text()).toContain("no focus stands")
  expect(existsSync(join(m.ops, "run-slot.preempted"))).toBe(false)
  expect(run.exitCode).toBeNull()
  run.kill()
  await run.exited
})
