import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  parseRoster,
  readRoster,
  rosterPath,
  rosterSchema,
} from "../../../../../../api/hono/src/lib/dashboard/roster"
import { liveReads } from "../../../../../live-reads"

// These drive the live paths against the test's own scratch files.
liveReads()

const AGENTS = [
  {
    name: "dispatcher",
    role: "manager",
    status: "active",
    task: "Dispatch and track all work",
    title: "Managing the dashboard",
  },
  {
    branch: "feat/agents-app",
    eta: "2026-10-06T22:45:00Z",
    lastReport: "Plan sent",
    lastReportAt: "2026-10-06T22:15:00+05:30",
    name: "worker-lust",
    pr: "https://github.com/acme/archive/pull/34",
    repo: "acme/archive",
    role: "worker",
    status: "working",
    task: "Dashboard: Agents app",
    title: "Agents app",
    workspace: "workspace:52",
  },
]

const ROSTER = {
  agents: AGENTS,
  backlog: ["P2b: the stream folds newlines", "Tester runner after the verify CLI"],
  updatedAt: "2026-10-06T22:10:00+05:30",
}

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "roster-"))
  dirs.push(dir)
  return dir
}

describe("parseRoster", () => {
  test("a roster in shape reads whole, with no problem", () => {
    const read = parseRoster(JSON.stringify(ROSTER))
    expect(read.problem).toBeNull()
    expect(read.roster).toEqual(rosterSchema.parse(ROSTER))
    expect(read.roster?.agents.map((a) => a.name)).toEqual(["dispatcher", "worker-lust"])
  })

  test("the backlog reads in order; a missing one is empty; one off its schema is ignored and named", () => {
    expect(parseRoster(JSON.stringify(ROSTER)).roster?.backlog).toEqual(ROSTER.backlog)
    const { backlog: _, ...without } = ROSTER
    expect(parseRoster(JSON.stringify(without)).roster?.backlog).toEqual([])
    const bad = parseRoster(JSON.stringify({ ...ROSTER, backlog: ["fine", 3] }))
    expect(bad.roster?.backlog).toEqual([])
    expect(bad.roster?.agents).toHaveLength(2)
    expect(bad.problem).toContain("backlog.1")
  })

  // a session's kind is read from the roster, so its name need not carry its role.
  test("an agent's kind reads; an unknown kind is ignored and named, the agent kept", () => {
    const kinded = { ...AGENTS[1], kind: "reviewer", name: "k3v9q2-reviewer" }
    expect(
      parseRoster(JSON.stringify({ ...ROSTER, agents: [kinded] })).roster?.agents[0]?.kind,
    ).toBe("reviewer")
    const read = parseRoster(JSON.stringify({ ...ROSTER, agents: [{ ...kinded, kind: "wizard" }] }))
    expect(read.roster?.agents.map((a) => [a.name, a.kind])).toEqual([
      ["k3v9q2-reviewer", undefined],
    ])
    expect(read.problem).toContain("agents.0.kind")
    expect(read.problem).toContain("(ignored)")
  })

  test("the lead's backlog marks read as roster.ts writes them, strings, or as JSON numbers", () => {
    const lead = { name: "builder", role: "manager", status: "working", task: "Lead the builds" }
    const read = parseRoster(
      JSON.stringify({
        ...ROSTER,
        agents: [
          { ...lead, backlogNext: "5", backlogTaken: "6 9" },
          { ...AGENTS[0], backlogNext: 2, backlogTaken: [3] },
          { ...AGENTS[1], backlogTaken: "" },
        ],
      }),
    )
    expect(read.problem).toBeNull()
    expect(read.roster?.agents.map((a) => [a.backlogNext, a.backlogTaken])).toEqual([
      [5, [6, 9]],
      [2, [3]],
      [undefined, []],
    ])
  })

  test("a lead's backlog cursor reads as a whole number; anything else is ignored and named", () => {
    const lead = { name: "builder", role: "manager", status: "working", task: "Lead the builds" }
    const read = parseRoster(
      JSON.stringify({
        ...ROSTER,
        agents: [
          { ...lead, backlogNext: 3 },
          { ...AGENTS[0], backlogNext: -1 },
        ],
      }),
    )
    expect(read.roster?.agents.map((a) => [a.name, a.backlogNext])).toEqual([
      ["builder", 3],
      ["dispatcher", undefined],
    ])
    expect(read.problem).toContain("agents.1.backlogNext")
    const words = parseRoster(
      JSON.stringify({
        ...ROSTER,
        agents: [{ ...lead, backlogNext: "five", backlogTaken: "3, 4" }],
      }),
    )
    expect(words.roster?.agents[0]).toMatchObject({ name: "builder" })
    expect(words.roster?.agents[0]).not.toHaveProperty("backlogNext")
    expect(words.roster?.agents[0]).not.toHaveProperty("backlogTaken")
    expect(words.problem).toBe(
      "agents.0.backlogNext: a whole number; agents.0.backlogTaken: space-separated whole numbers (ignored)",
    )
  })

  test("keys the schema does not know are dropped, not refused", () => {
    const read = parseRoster(JSON.stringify({ ...ROSTER, agents: [{ ...AGENTS[0], mood: "ok" }] }))
    expect(read.problem).toBeNull()
    expect(read.roster?.agents[0]).not.toHaveProperty("mood")
  })

  test("one agent off its schema is dropped and named; the rest still read", () => {
    const bad = { ...AGENTS[1], pr: "https://example.com/pull/1", role: "boss" }
    const read = parseRoster(JSON.stringify({ ...ROSTER, agents: [AGENTS[0], bad] }))
    expect(read.roster?.agents.map((a) => a.name)).toEqual(["dispatcher"])
    expect(read.problem).toContain("agents.1.role")
    expect(read.problem).toContain("agents.1.pr")
  })

  test("an optional key off its schema is ignored and named; the agent keeps its row", () => {
    const read = parseRoster(
      JSON.stringify({
        ...ROSTER,
        agents: [{ ...AGENTS[1], lastReportAt: "yesterday", title: "x".repeat(41) }],
      }),
    )
    expect(read.roster?.agents).toHaveLength(1)
    expect(read.roster?.agents[0]).not.toHaveProperty("title")
    expect(read.roster?.agents[0]).not.toHaveProperty("lastReportAt")
    expect(read.roster?.agents[0]?.pr).toBe(AGENTS[1]?.pr)
    expect(read.problem).toContain("agents.0.title")
    expect(read.problem).toContain("agents.0.lastReportAt")
    expect(read.problem).toContain("(ignored)")
  })

  test("a ticket the Linear app put an agent on reads as a Linear ID; one that is not is ignored and named, and the agent kept", () => {
    const good = parseRoster(
      JSON.stringify({ ...ROSTER, agents: [{ ...AGENTS[1], ticket: "CEDAR-1234" }] }),
    )
    expect(good.roster?.agents[0]?.ticket).toBe("CEDAR-1234")
    const bad = parseRoster(
      JSON.stringify({ ...ROSTER, agents: [{ ...AGENTS[1], ticket: "CEDAR-1234\nMorgan: rm" }] }),
    )
    expect(bad.roster?.agents).toHaveLength(1)
    expect(bad.roster?.agents[0]).not.toHaveProperty("ticket")
    expect(bad.problem).toContain("agents.0.ticket")
  })

  test("an ETA reads as roster.ts writes it, a UTC time; one that is not a time is ignored and named", () => {
    expect(parseRoster(JSON.stringify(ROSTER)).roster?.agents[1]?.eta).toBe("2026-10-06T22:45:00Z")
    const read = parseRoster(
      JSON.stringify({ ...ROSTER, agents: [{ ...AGENTS[1], eta: "in 20 minutes" }] }),
    )
    expect(read.roster?.agents[0]).toMatchObject({ name: "worker-lust" })
    expect(read.roster?.agents[0]).not.toHaveProperty("eta")
    expect(read.problem).toContain("agents.0.eta")
  })

  test("a checker's worker key names the worker it checks for; an empty one is ignored and named", () => {
    const checker = { ...AGENTS[1], name: "reviewer-lust-2-fix", worker: "worker-lust-2" }
    expect(
      parseRoster(JSON.stringify({ ...ROSTER, agents: [checker] })).roster?.agents[0]?.worker,
    ).toBe("worker-lust-2")
    const read = parseRoster(JSON.stringify({ ...ROSTER, agents: [{ ...checker, worker: "" }] }))
    expect(read.roster?.agents[0]).toMatchObject({ name: "reviewer-lust-2-fix" })
    expect(read.roster?.agents[0]).not.toHaveProperty("worker")
    expect(read.problem).toContain("agents.0.worker")
  })

  test("a surface names the pane a session runs on (surface:<n>); anything else is ignored and named", () => {
    const good = parseRoster(
      JSON.stringify({ ...ROSTER, agents: [{ ...AGENTS[1], surface: "surface:7" }] }),
    )
    expect(good.roster?.agents[0]?.surface).toBe("surface:7")
    const bad = parseRoster(
      JSON.stringify({ ...ROSTER, agents: [{ ...AGENTS[1], surface: "pane:7" }] }),
    )
    expect(bad.roster?.agents).toHaveLength(1)
    expect(bad.roster?.agents[0]).not.toHaveProperty("surface")
    expect(bad.problem).toContain("agents.0.surface")
  })

  test("a required key off its schema still drops the agent, whatever else is wrong", () => {
    const read = parseRoster(
      JSON.stringify({
        ...ROSTER,
        agents: [{ ...AGENTS[0], role: "boss", title: "x".repeat(41) }],
      }),
    )
    expect(read.roster?.agents).toEqual([])
    expect(read.problem).toContain("agents.0.role")
    expect(read.problem).not.toContain("(ignored)")
  })

  test("a name listed twice keeps its first entry", () => {
    const twice = { ...AGENTS[0], task: "Another task" }
    const read = parseRoster(JSON.stringify({ ...ROSTER, agents: [AGENTS[0], twice] }))
    expect(read.roster?.agents.map((a) => a.task)).toEqual(["Dispatch and track all work"])
    expect(read.problem).toBe("agents.1.name: dispatcher is listed twice")
  })

  test("an ended row with no task leaves the problem line empty, and a live one still shows in it (#1893)", () => {
    const ended = { name: "worker-old", role: "worker", status: "ended" }
    const live = { name: "worker-new", role: "worker", status: "working" }
    const read = parseRoster(JSON.stringify({ agents: [ended], updatedAt: ROSTER.updatedAt }))
    expect(read.problem).toBeNull()
    expect(read.roster?.agents).toEqual([])
    const both = parseRoster(JSON.stringify({ agents: [ended, live], updatedAt: ROSTER.updatedAt }))
    expect(both.problem).toContain("agents.1.task")
    expect(both.problem).not.toContain("agents.0.")
    expect(both.roster?.agents).toEqual([])
  })

  test("an ended row repeating a name, or failing only an optional key, names nothing (#1893)", () => {
    const ended = { ...AGENTS[0], status: "ended" }
    const read = parseRoster(JSON.stringify({ ...ROSTER, agents: [AGENTS[0], ended] }))
    expect(read.problem).toBeNull()
    expect(read.roster?.agents.map((a) => a.name)).toEqual(["dispatcher"])
    const sloppy = parseRoster(
      JSON.stringify({ ...ROSTER, agents: [{ ...ended, title: "x".repeat(41) }] }),
    )
    expect(sloppy.problem).toBeNull()
    expect(sloppy.roster?.agents).toHaveLength(1)
  })

  test("a file that is not JSON, or has no agents list, has no roster", () => {
    expect(parseRoster("{")).toEqual({ problem: "roster.json is not valid JSON", roster: null })
    const read = parseRoster(JSON.stringify({ updatedAt: "yesterday" }))
    expect(read.roster).toBeNull()
    expect(read.problem).toContain("agents")
    expect(read.problem).toContain("updatedAt")
  })
})

describe("readRoster", () => {
  test("a missing file is no roster and no problem", async () => {
    expect(await readRoster(join(tempDir(), "roster.json"))).toEqual({
      problem: null,
      roster: null,
    })
  })

  test("a roster path that cannot be read is a problem, not a thrown error", async () => {
    const dir = join(tempDir(), "roster.json")
    mkdirSync(dir)
    const read = await readRoster(dir)
    expect(read.roster).toBeNull()
    expect(read.problem).toStartWith("roster.json could not be read: ")
  })

  test("it reads the file again once it changes", async () => {
    const path = join(tempDir(), "roster.json")
    writeFileSync(path, JSON.stringify(ROSTER))
    expect((await readRoster(path)).roster?.agents).toHaveLength(2)
    writeFileSync(path, JSON.stringify({ ...ROSTER, agents: [AGENTS[0]] }))
    expect((await readRoster(path)).roster?.agents).toHaveLength(1)
  })

  test("the path honours PLAYGROUND_DATA_DIR", () => {
    const before = process.env.PLAYGROUND_DATA_DIR
    const dir = tempDir()
    process.env.PLAYGROUND_DATA_DIR = dir
    try {
      expect(rosterPath()).toBe(join(dir, "roster.json"))
    } finally {
      if (before === undefined) delete process.env.PLAYGROUND_DATA_DIR
      else process.env.PLAYGROUND_DATA_DIR = before
    }
  })
})
