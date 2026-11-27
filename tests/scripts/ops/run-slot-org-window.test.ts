import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine, runSlot } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

type Machine = ReturnType<typeof machine>

// "HH:MM" in UTC, `minutes` from now
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString().slice(11, 16)
const today = () => new Date().toISOString().slice(0, 10)
const INSIDE = () => `${at(-60)}-${at(60)}`
const OUTSIDE = () => `${at(120)}-${at(180)}`

// a fixture jobs.json in the case's own data folder, with one org job's row as the start job keeps its hours and days off
const jobs = (m: Machine, config: Record<string, unknown>, row: Record<string, unknown> = {}) => {
  const ops = join(m.root, "claude", "playground", "ops")
  mkdirSync(ops, { recursive: true })
  writeFileSync(
    join(ops, "jobs.json"),
    JSON.stringify({ jobs: [{ config, name: "acme-start", org: "acme-co", ...row }] }),
  )
}
const ORG = { agents: [{ name: "worker-lw", repo: "acme-co/web" }] }

// three of the four lanes held, so one lane stays open
const threeHeld = (m: Machine) => {
  for (const s of ["run-slot", "run-slot-2", "run-slot-3"]) m.hold(s, 1, "small")
}

describe("in an org job's window, a run that is not an org's leaves the org's runs a lane", () => {
  test("a Playground run waits rather than take the last open lane", async () => {
    const m = machine()
    jobs(m, { hours: INSIDE() })
    threeHeld(m)
    expect(await m.waits("worker-pg", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("a Playground run waits while one lane alone is open", async () => {
    const m = machine({ load1: 50, load5: 2 })
    jobs(m, { hours: INSIDE() })
    expect(await m.waits("worker-pg", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("a Playground run takes a lane while another stays free", async () => {
    const m = machine()
    jobs(m, { hours: INSIDE() })
    m.hold("run-slot", 1, "small")
    m.hold("run-slot-2", 1, "small")
    expect(await m.runs("worker-pg", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("an org's run takes the last open lane", async () => {
    const m = machine({ roster: ORG })
    jobs(m, { hours: INSIDE() })
    threeHeld(m)
    expect(await m.runs("worker-lw", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })

  test("an org's run takes the one open lane", async () => {
    const m = machine({ load1: 50, load5: 2, roster: ORG })
    jobs(m, { hours: INSIDE() })
    expect(await m.runs("worker-lw", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })
})

describe("outside an org job's window the lanes are as before", () => {
  for (const [what, config, row] of [
    ["outside its hours", { hours: OUTSIDE() }, {}],
    ["on a day off", { daysOff: [today()], hours: INSIDE() }, {}],
    ["while its row is disabled", { hours: INSIDE() }, { disabled: true }],
    ["for a row with no hours", {}, {}],
    ["for a row that names no org", { hours: INSIDE() }, { org: undefined }],
  ] as const)
    test(`a Playground run takes the last open lane ${what}`, async () => {
      const m = machine()
      jobs(m, config, row)
      threeHeld(m)
      expect(await m.runs("worker-pg", { RUN_SLOT_SIZE: "small" })).toBe(true)
    })

  test("a Playground run takes the one open lane with no jobs.json", async () => {
    const m = machine({ load1: 50, load5: 2 })
    expect(await m.runs("worker-pg", { RUN_SLOT_SIZE: "small" })).toBe(true)
  })
})

describe("run-slot.sh org-window", () => {
  const window = async (m: Machine) => {
    const p = runSlot(["bash", SCRIPT, "org-window"], { cwd: m.root, env: m.env(), ops: m.ops })
    return await p.exited
  }

  test("exits 0 inside the hours, a window past midnight included", async () => {
    const m = machine()
    jobs(m, { hours: INSIDE() })
    expect(await window(m)).toBe(0)
    jobs(m, { hours: `${at(1)}-${at(-1)}` })
    expect(await window(m)).toBe(1)
    jobs(m, { hours: `${at(-1)}-${at(-2)}` })
    expect(await window(m)).toBe(0)
  })

  test("exits 1 outside them, on a day off and with no jobs.json", async () => {
    const m = machine()
    expect(await window(m)).toBe(1)
    jobs(m, { hours: OUTSIDE() })
    expect(await window(m)).toBe(1)
    jobs(m, { daysOff: [today()], hours: INSIDE() })
    expect(await window(m)).toBe(1)
  })
})
