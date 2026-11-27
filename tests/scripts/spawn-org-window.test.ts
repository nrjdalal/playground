import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { capacityLog, placing, script, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

// "HH:MM" in UTC, `minutes` from now
const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString().slice(11, 16)
const INSIDE = `${at(-60)}-${at(60)}`
const OUTSIDE = `${at(120)}-${at(180)}`

const SETTINGS = { SETTINGS_JSON: JSON.stringify({ "ext.links": { acme: ["acme"] } }) }
// load5 over a medium start's line (the 15 cores less the quarter kept for small items, 11.25) and under the cores' 15
const LOADED = { ...SETTINGS, FAKE_CPU_IDLE: "80", FAKE_LOAD5: "12.00" }
const ORG_WORKER = [
  "worker",
  "worker-a",
  "b.md",
  "--size",
  "medium",
  "--in",
  "{home}/code/acme/app",
]
const PG_WORKER = ["worker", "worker-a", "b.md", "--size", "medium"]

// a fixture jobs.json in the case's own data folder, with one org job's row as the start job keeps its hours, and the org's checkout
const setup =
  (hours: string, focus = false) =>
  (home: string) => {
    mkdirSync(join(home, "code", "acme", "app"), { recursive: true })
    writeFileSync(
      join(home, ".playground", "ops", "jobs.json"),
      JSON.stringify({ jobs: [{ config: { hours }, name: "acme-start", org: "acme" }] }),
    )
    if (focus) {
      const until = new Date(Date.now() + 30 * 60_000).toISOString()
      writeFileSync(
        join(home, ".playground", "focus.json"),
        JSON.stringify({ session: "worker-z", until }),
      )
    }
  }
const start = (args: string[], hours: string, focus = false) =>
  spawn(args, [], LOADED, script, undefined, setup(hours, focus))

describe("in an org job's window, a start in the org's checkout takes the priority path", () => {
  test("a medium start passes the load gate over its line", async () => {
    const r = await start(ORG_WORKER, INSIDE)
    expect(r.code).toBe(0)
    expect(capacityLog(r)).toEqual([
      expect.objectContaining({
        readings: expect.objectContaining({
          priority: expect.stringMatching(/\/\.playground\/ops\/jobs\.json$/),
        }),
        verdict: "pass",
      }),
    ])
  })

  test("it never passes focus", async () => {
    const r = await start(ORG_WORKER, INSIDE, true)
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("focus stands for worker-z")
  })
})

describe("the load gate holds as before", () => {
  test("for a start in the org's checkout outside the window", async () => {
    const r = await start(ORG_WORKER, OUTSIDE)
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("the load gate holds it: max(load1, load5) is 12.00")
  })

  test("for a Playground start inside the window", async () => {
    const r = await start(PG_WORKER, INSIDE)
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("the load gate holds it: max(load1, load5) is 12.00")
  })
})
