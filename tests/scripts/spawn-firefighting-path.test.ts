import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { START_FILE, startPass } from "../../packages/scripts/src/ops-firefighting-start/start"
import type { Context } from "../../packages/scripts/src/ops-tick/tick"
import { capacityLog, placing, root, scratch, slots, spawn, type Spawned } from "./spawn-fake"

// Each case runs ops-firefighting-start's pass, which runs the real spawn.sh on spawn-fake's machine; a start must land within 120s of the relay's write, so each case gets more than that.
setDefaultTimeout(150_000)

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// The machine an urgent ticket met on 6 Nov: load5 at 25 over the cores, and every run-slot lane held with 7 runs waiting.
const BUSY = { FAKE_CPU_IDLE: "80", FAKE_LOAD5: "25.00" }
const FULL = slots(4, 7)

// One ticket's line as the relay writes firefighting.json, with made-up IDs; the relay's own pass() writing it is the org's test.
const relayWrites = (data: string, id: string, urgency: string) =>
  writeFileSync(
    join(data, "firefighting.json"),
    JSON.stringify({
      lastTry: Date.now(),
      lines: {
        [id]: { id, open: true, shownAt: Date.now(), urgency, urgent: urgency === "Urgent" },
      },
    }),
  )

// The job's data folder and its ctx: spawn.sh runs on spawn-fake's machine, whose ~/.playground takes the job's start file and the case's focus, as one data folder holds both on a real Mac.
const job = () => {
  const data = mkdtempSync(join(scratch, "ff-path-"))
  dirs.push(data)
  mkdirSync(join(data, "ops"))
  writeFileSync(join(data, "brief-ff.md"), "Work {TICKET} as {NAME}.\n")
  const spawned: Spawned[] = []
  const placed: number[] = []
  const machine: { focus?: object; stop?: boolean } = {}
  const ctx: Context = {
    now: new Date(),
    ops: join(data, "ops"),
    repo: root,
    run: async (argv) => {
      if (!argv[0]!.endsWith("spawn.sh")) return { code: 0, out: "" }
      const r = await spawn(argv.slice(1), [], BUSY, undefined, undefined, (home) => {
        FULL(home)
        mkdirSync(join(home, "code", "app"), { recursive: true })
        if (existsSync(join(data, START_FILE)))
          copyFileSync(join(data, START_FILE), join(home, ".playground", START_FILE))
        if (machine.stop)
          writeFileSync(
            join(home, ".playground", "firefighting-stop.json"),
            JSON.stringify({ ids: ["MADE-1"] }),
          )
        if (machine.focus)
          writeFileSync(join(home, ".playground", "focus.json"), JSON.stringify(machine.focus))
      })
      spawned.push(r)
      placed.push(Date.now())
      return { code: r.code, out: r.err }
    },
    send: async () => true,
  }
  let n = 0
  const pass = () =>
    startPass({
      config: { brief: "brief-ff.md", freshMinutes: 10, in: "{home}/code/app", prefixes: ["MADE"] },
      ctx: { ...ctx, now: new Date() },
      data,
      linearStates: async () => ({}),
      name: async () => `ffmade${++n}-worker`,
    })
  return { data, machine, pass, placed, spawned }
}

describe("a ticket's firefighting start on a busy machine (#1150)", () => {
  test.each(["Urgent", "High", "Medium", "Low"])(
    "a %s ticket's line starts its session past the load and slots gates within 120s",
    async (urgency) => {
      const j = job()
      const wrote = Date.now()
      relayWrites(j.data, "MADE-1", urgency)
      await j.pass()
      const [r] = j.spawned
      expect(r?.code).toBe(0)
      expect(capacityLog(r!)).toEqual([
        expect.objectContaining({
          readings: expect.objectContaining({
            firefighting: expect.stringMatching(/\/\.playground\/firefighting-start\.json$/),
            lanes_free: 0,
            waiters: 7,
          }),
          verdict: "pass",
        }),
      ])
      expect(placing(r!)).not.toEqual([])
      expect(j.placed[0]! - wrote).toBeLessThan(120_000)
    },
  )

  test("an Urgent focus standing holds a Medium line's start, which starts on the beat after the focus lifts", async () => {
    const j = job()
    const until = new Date(Date.now() + 60 * 60_000).toISOString()
    j.machine.focus = {
      reason: "Urgent SLA MADE-9 open",
      session: "ffmade9-worker",
      since: new Date().toISOString(),
      until,
    }
    relayWrites(j.data, "MADE-1", "Medium")
    await j.pass()
    expect(j.spawned[0]?.code).not.toBe(0)
    expect(j.spawned[0]?.err).toContain("focus stands for ffmade9-worker")
    expect(placing(j.spawned[0]!)).toEqual([])
    delete j.machine.focus
    await j.pass()
    expect(j.spawned[1]?.code).toBe(0)
    expect(placing(j.spawned[1]!)).not.toEqual([])
  })

  test("a second Urgent starts under a standing focus, hand-set or not, while the relay's stop file stands", async () => {
    const j = job()
    const until = new Date(Date.now() + 60 * 60_000).toISOString()
    j.machine.focus = {
      reason: "the owner's demo",
      session: "ffmade9-worker",
      since: new Date().toISOString(),
      until,
    }
    j.machine.stop = true
    relayWrites(j.data, "MADE-1", "Urgent")
    await j.pass()
    const [r] = j.spawned
    expect(r?.code).toBe(0)
    expect(capacityLog(r!)).toEqual([
      expect.objectContaining({
        readings: expect.objectContaining({
          firefighting: expect.stringMatching(/\/\.playground\/firefighting-stop\.json$/),
        }),
        verdict: "pass",
      }),
    ])
    expect(placing(r!)).not.toEqual([])
  })
})
