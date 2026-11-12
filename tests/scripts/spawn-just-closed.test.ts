import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { capacityLog, herdrPin, lw, placing, root, spawn } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

// The load a Claude Code update met on 7 Nov, when the dispatcher closed Ops and its resume was refused (measured), over the fake's 15 cores.
const HIGH = { FAKE_LOAD1: "23.70", FAKE_LOAD5: "23.70" }
const id = "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"

// The close spawn.sh keeps for a name: the time it closed, as epoch seconds and as ISO, and the row's status before the close ended it.
const closed = (name: string, minutes: number, was: string) => (home: string) => {
  mkdirSync(lw(home, "closes"), { recursive: true })
  const at = new Date(Date.now() - minutes * 60_000)
  writeFileSync(
    lw(home, "closes", name),
    `${Math.floor(at.getTime() / 1000)} ${at.toISOString().slice(0, 19)}Z ${was}\n`,
  )
}

const resume = (name: string, role: string, setup?: (home: string) => void) =>
  spawn(
    ["resume", name, root, id],
    [],
    {
      ...HIGH,
      ROSTER_JSON: JSON.stringify({
        agents: [
          { name, role, kind: role === "manager" ? name : role, status: "ended", task: "t" },
        ],
      }),
    },
    undefined,
    { name, backend: "claude" },
    setup,
  )

const loadVerdict = (r: { home: string }) =>
  capacityLog(r).filter((l) => l.verdict === "pass" || l.gate === "load")

describe("a resume of a row spawn.sh closed live in the last 15 minutes passes the load gate, since that session already counts in the load", () => {
  test.each([
    ["a manager's", "planner", "manager", "working"],
    ["a worker's", "worker-x", "worker", "working"],
  ])("%s resume 2 minutes after its close passes at load 23.70", async (_, name, role, was) => {
    const r = await resume(name, role, closed(name, 2, was))
    expect(r.err).not.toContain("the load gate holds it")
    expect(r.code).toBe(0)
    expect(placing(r).filter((c) => c[1] === "run")).toHaveLength(1)
    expect(loadVerdict(r)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        readings: expect.objectContaining({
          just_closed: expect.stringContaining(`its ${was} row closed at `),
        }),
      }),
    ])
  })

  test("a just-closed resume still meets the memory gate", async () => {
    const r = await spawn(
      ["resume", "worker-x", root, id],
      [],
      {
        ...HIGH,
        FAKE_PRESSURE: "4",
        ROSTER_JSON: JSON.stringify({
          agents: [
            { name: "worker-x", role: "worker", kind: "worker", status: "ended", task: "t" },
          ],
        }),
      },
      undefined,
      { name: "worker-x", backend: "claude" },
      closed("worker-x", 2, "working"),
    )
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("the memory gate holds it: pressure level is 4")
    expect(placing(r).filter((c) => c[1] === "run")).toEqual([])
  })

  test("a new worker start at the same load is refused by the load gate", async () => {
    const r = await spawn(["worker", "worker-x", "b.md"], [], HIGH)
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("the load gate holds it: max(load1, load5) is 23.70")
  })

  test.each([
    ["closed 20 minutes ago, outside the window", 20, "working"],
    ["parked when it closed", 2, "parked"],
    ["ended when it closed", 2, "ended"],
    ["never closed by spawn.sh", null, ""],
    ["whose close time lies in the future", -5, "working"],
  ])("a resume of a row %s is refused by the load gate", async (_, minutes, was) => {
    const r = await resume(
      "worker-x",
      "worker",
      minutes === null ? undefined : closed("worker-x", minutes, was),
    )
    expect(r.code).not.toBe(0)
    expect(placing(r).filter((c) => c[1] === "run")).toEqual([])
    expect(r.err).toContain("the load gate holds it: max(load1, load5) is 23.70")
  })
})

describe("spawn.sh close keeps when it closed a row and what the row read", () => {
  const opened = (home: string) => {
    herdrPin()(home)
    mkdirSync(lw(home, "runtimes"), { recursive: true })
    mkdirSync(lw(home, "resume"), { recursive: true })
    writeFileSync(lw(home, "runtimes", "worker-x"), "herdr\n")
    writeFileSync(
      lw(home, "resume", "worker-x.sh"),
      `#!/bin/bash\n# server: factory\nexec ${root}/scripts/spawn.sh resume worker-x ${root} x\n`,
    )
    writeFileSync(
      join(home, "herdr.panes"),
      JSON.stringify({
        result: { panes: [{ label: "worker-x", pane_id: "w2:p3", workspace_id: "w2" }] },
      }),
    )
  }

  test.each([
    ["working", "working"],
    ["parked", "parked"],
  ])("a %s row's close keeps its time and its status", async (status, was) => {
    const before = Math.floor(Date.now() / 1000)
    const r = await spawn(
      ["close", "worker-x"],
      [],
      {
        ROSTER_JSON: JSON.stringify({
          agents: [{ name: "worker-x", role: "worker", status, task: "t" }],
        }),
      },
      undefined,
      undefined,
      opened,
    )
    expect(r.code).toBe(0)
    expect(r.rosterLog).toEqual(["set worker-x status=ended"])
    const [at, iso, kept] = readFileSync(lw(r.home, "closes", "worker-x"), "utf8")
      .trim()
      .split(" ")
    expect(Number(at)).toBeGreaterThanOrEqual(before)
    expect(iso).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    expect(kept).toBe(was)
  })
})
