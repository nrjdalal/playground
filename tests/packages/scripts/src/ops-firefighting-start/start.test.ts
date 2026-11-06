import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  REASON,
  START_FILE,
  type StartConfig,
  startPass,
  statePath,
} from "../../../../../packages/scripts/src/ops-firefighting-start/start"
import type { Context } from "../../../../../packages/scripts/src/ops-tick/tick"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const NOW = new Date("2026-11-06T08:00:00Z")
const CONFIG: StartConfig = {
  brief: "brief-ff.md",
  freshMinutes: 10,
  in: "/made-up/code/app",
  prefixes: ["MADE", "ALSO"],
}
const MINUTE = 60_000

type Line = {
  busy?: boolean
  from?: string
  id: string
  open?: boolean
  shownAt?: number
  theirs?: boolean
  urgency?: string
  urgent?: boolean
}
const line = (
  id: string,
  urgency: string,
  shownAt: number,
  extra: Partial<Line> = {},
): Record<string, Line> => ({
  [id]: { id, open: true, shownAt, urgency, urgent: urgency === "Urgent", ...extra },
})

// firefighting.json as the relay writes it: its lines, and its clock map, which holds each ticket the tracker's digest lists (every line's unless `listed` says).
const relayFile = (lines: Record<string, Line>, lastTry: number, listed = Object.keys(lines)) =>
  JSON.stringify({
    clock: Object.fromEntries(
      listed.map((id) => [
        id,
        { firstReported: NOW.toISOString(), urgency: lines[id]?.urgency ?? "High" },
      ]),
    ),
    lastTry,
    lines,
  })

// A data folder holding the relay's firefighting.json (written a minute before NOW unless `wrote` says), the standing brief and the files given; a ctx whose runs and lines are recorded, spawn.sh answering with `spawned`, and Linear reading `linear`.
const setup = (
  lines: Record<string, Line>,
  files: Record<string, unknown> = {},
  {
    linear = {},
    listed,
    spawned = { code: 0, out: "" },
    wrote = NOW.getTime() - MINUTE,
  }: {
    linear?: Record<string, string>
    listed?: string[]
    spawned?: { code: number; out: string } | ((argv: string[]) => { code: number; out: string })
    wrote?: number
  } = {},
) => {
  const data = mkdtempSync(join(tmpdir(), "ff-start-"))
  dirs.push(data)
  mkdirSync(join(data, "ops"))
  writeFileSync(join(data, "brief-ff.md"), "Work {TICKET} as {NAME}.\n")
  writeFileSync(join(data, "firefighting.json"), relayFile(lines, wrote, listed))
  for (const [file, body] of Object.entries(files))
    writeFileSync(join(data, file), JSON.stringify(body))
  const runs: string[][] = []
  const sent: string[] = []
  const sentTo: string[] = []
  const asked: string[][] = []
  let now = NOW
  // playground focus as its cli writes focus.json: on stands for --for minutes, off ends it now.
  const focusCli = (args: string[]) => {
    const path = join(data, "focus.json")
    const at = (flag: string) => args[args.indexOf(flag) + 1]!
    if (args[0] === "on")
      writeFileSync(
        path,
        JSON.stringify({
          reason: at("--reason"),
          session: at("--session"),
          since: now.toISOString(),
          until: new Date(now.getTime() + Number(at("--for")) * MINUTE).toISOString(),
        }),
      )
    else if (existsSync(path))
      writeFileSync(
        path,
        JSON.stringify({ ...JSON.parse(readFileSync(path, "utf8")), until: now.toISOString() }),
      )
  }
  const ctx = (): Context => ({
    now,
    ops: join(data, "ops"),
    repo: "/made-up/checkout",
    run: async (argv) => {
      runs.push(argv)
      if (argv.includes("focus")) focusCli(argv.slice(argv.indexOf("focus") + 1))
      if (!argv[0]!.endsWith("spawn.sh")) return { code: 0, out: "" }
      return typeof spawned === "function" ? spawned(argv) : spawned
    },
    send: async (to, text) => (sent.push(text), sentTo.push(to), true),
  })
  let n = 0
  const pass = (config = CONFIG) =>
    startPass({
      config,
      ctx: ctx(),
      data,
      linearStates: async (ids) => (
        asked.push(ids),
        Object.fromEntries(ids.flatMap((id) => (linear[id] ? [[id, linear[id]!]] : [])))
      ),
      name: async () => `worker-made-up-${++n}`,
    })
  const later = (minutes: number) => {
    now = new Date(now.getTime() + minutes * MINUTE)
  }
  const spawns = () => runs.filter((argv) => argv[0]!.endsWith("spawn.sh"))
  const titles = () => spawns().map((argv) => argv[argv.indexOf("--title") + 1])
  const focus = () =>
    runs
      .filter((argv) => argv.includes("focus"))
      .map((argv) => argv.slice(argv.indexOf("focus") + 1))
  const startFile = () =>
    existsSync(join(data, START_FILE))
      ? JSON.parse(readFileSync(join(data, START_FILE), "utf8"))
      : undefined
  const state = () => JSON.parse(readFileSync(statePath(join(data, "ops")), "utf8"))
  return { asked, data, focus, later, pass, runs, sent, sentTo, spawns, startFile, state, titles }
}

// A running job's state, with nothing started yet, so a line seen closed now closed while it ran.
const WATCHING = new Date(NOW.getTime() - 60 * MINUTE).toISOString()
const RUNNING = { closedSeen: {}, reopened: {}, started: {}, told: {}, watchingSince: WATCHING }

// The job's state once it has started ff-first-worker for MADE-1.
const FIRST = {
  closedSeen: {},
  reopened: {},
  started: { "MADE-1": "ff-first-worker" },
  told: {},
  watchingSince: WATCHING,
}

const focusFile = (reason: string, minutesLeft: number, session = "worker-made-up-1") => ({
  reason,
  session,
  since: NOW.toISOString(),
  until: new Date(NOW.getTime() + minutesLeft * MINUTE).toISOString(),
})

describe("ops-firefighting-start", () => {
  test("an open ticket starts one --firefighting worker from the filled brief and sets its ticket", async () => {
    const s = setup(line("MADE-1", "Medium", 1))
    await s.pass()
    expect(s.spawns()).toEqual([
      [
        "/made-up/checkout/scripts/spawn.sh",
        "worker",
        "worker-made-up-1",
        "brief-worker-made-up-1.md",
        "--title",
        "MADE-1 firefight",
        "--in",
        "/made-up/code/app",
        "--size",
        "medium",
        "--firefighting",
      ],
    ])
    expect(await Bun.file(join(s.data, "brief-worker-made-up-1.md")).text()).toBe(
      "Work MADE-1 as worker-made-up-1.\n",
    )
    expect(
      s.runs.some((argv) =>
        argv.join(" ").endsWith("roster.ts set worker-made-up-1 ticket=MADE-1"),
      ),
    ).toBe(true)
    expect(s.sent).toEqual([
      "Started worker-made-up-1 for MADE-1 (Medium) with --firefighting, from brief-ff.md",
    ])
    expect(s.focus()).toEqual([])
  })

  test("Urgent, High, Medium, Low, then oldest first; at most 2 in progress, each waiting line told once", async () => {
    const s = setup({
      ...line("MADE-1", "Medium", 100),
      ...line("MADE-2", "Low", 50),
      ...line("ALSO-3", "High", 300),
      ...line("MADE-4", "Urgent", 400),
      ...line("MADE-5", "Medium", 90),
    })
    await s.pass()
    await s.pass()
    expect(s.titles()).toEqual(["MADE-4 firefight", "ALSO-3 firefight"])
    expect(s.sent.filter((t) => t.startsWith("Waiting on")).map((t) => t.split(" ")[2])).toEqual([
      "MADE-5",
      "MADE-1",
      "MADE-2",
    ])
  })

  test("an Urgent starts while 2 others are in progress, and focus stands for its session", async () => {
    const s = setup(
      {
        ...line("MADE-1", "Medium", 1),
        ...line("MADE-2", "High", 2),
        ...line("MADE-3", "Urgent", 3),
      },
      {
        "roster.json": {
          agents: [
            { name: "a", status: "working", ticket: "MADE-1" },
            { name: "b", status: "working", title: "MADE-2 firefight" },
          ],
        },
      },
    )
    await s.pass()
    expect(s.titles()).toEqual(["MADE-3 firefight"])
    expect(s.focus()).toEqual([
      ["on", "--session", "worker-made-up-1", "--reason", `${REASON} MADE-3 open`, "--for", "180"],
    ])
  })

  test("High, Medium and Low each start, and set no focus", async () => {
    for (const urgency of ["High", "Medium", "Low"]) {
      const s = setup(line("MADE-1", urgency, 1))
      await s.pass()
      expect(s.titles()).toEqual(["MADE-1 firefight"])
      expect(s.focus()).toEqual([])
    }
  })

  test("a ticket a live roster row holds, by ticket= or a title it leads, gets no second start (#1150)", async () => {
    const s = setup(
      { ...line("MADE-1", "High", 1), ...line("MADE-2", "High", 2) },
      {
        "roster.json": {
          agents: [
            { name: "a", status: "working", ticket: "MADE-1" },
            { name: "b", status: "starting", title: "MADE-2 firefight" },
          ],
        },
      },
    )
    await s.pass()
    expect(s.spawns()).toEqual([])
  })

  test("a row already ended on the first beat does not hold its ticket, and a second pass starts nothing new for a ticket the first started", async () => {
    const s = setup(line("MADE-1", "Medium", 1), {
      "roster.json": { agents: [{ name: "a", status: "ended", ticket: "MADE-1" }] },
    })
    await s.pass()
    await s.pass()
    expect(s.spawns()).toHaveLength(1)
  })

  test("a ticket whose roster row ended today never starts again today, and may the next day (#1150)", async () => {
    const roster = (status: string) => ({ agents: [{ name: "a", status, ticket: "MADE-1" }] })
    const s = setup(line("MADE-1", "Medium", 1), {
      "ops/ops-firefighting-start.state.json": RUNNING,
      "roster.json": roster("working"),
    })
    await s.pass()
    writeFileSync(join(s.data, "roster.json"), JSON.stringify(roster("ended")))
    await s.pass()
    s.later(60)
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(line("MADE-1", "Medium", 1), NOW.getTime() + 60 * MINUTE),
    )
    await s.pass()
    expect(s.spawns()).toEqual([])
    expect(s.sent).toEqual(["Not starting MADE-1 again today: a, its session, ended today"])
    s.later(16 * 60)
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(line("MADE-1", "Medium", 1), NOW.getTime() + 17 * 60 * MINUTE),
    )
    await s.pass()
    expect(s.titles()).toEqual(["MADE-1 firefight"])
  })

  test("a session this job started that ends is not started again the same day (#1150)", async () => {
    const s = setup(line("MADE-1", "Medium", 1), {
      "ops/ops-firefighting-start.state.json": RUNNING,
    })
    await s.pass()
    writeFileSync(
      join(s.data, "roster.json"),
      JSON.stringify({ agents: [{ name: "worker-made-up-1", status: "ended", ticket: "MADE-1" }] }),
    )
    await s.pass()
    await s.pass()
    expect(s.titles()).toEqual(["MADE-1 firefight"])
  })

  test("the start window: a line at 12:00Z or at 03:59Z starts nothing, told once, one at 11:59Z starts, and a day off starts nothing (#1150)", async () => {
    const hours = { ...CONFIG, hours: "04:00-12:00" }
    const at = (minutes: number) => {
      const s = setup(
        line("MADE-1", "Urgent", 1),
        {},
        { wrote: NOW.getTime() + (minutes - 1) * MINUTE },
      )
      s.later(minutes)
      return s
    }
    const noon = at(4 * 60)
    await noon.pass(hours)
    await noon.pass(hours)
    expect(noon.spawns()).toEqual([])
    expect(noon.startFile()).toBeUndefined()
    expect(noon.sent).toEqual([
      "Starting nothing: 2026-11-06 12:00Z is outside the start window (04:00-12:00)",
    ])
    const early = at(-4 * 60 - 1)
    await early.pass(hours)
    expect(early.spawns()).toEqual([])
    const last = at(4 * 60 - 1)
    await last.pass(hours)
    expect(last.titles()).toEqual(["MADE-1 firefight"])
    const off = setup(line("MADE-1", "Urgent", 1))
    await off.pass({ ...hours, daysOff: ["2026-11-06"] })
    expect(off.spawns()).toEqual([])
    expect(off.sent).toEqual([
      "Starting nothing: 2026-11-06 08:00Z is outside the start window (04:00-12:00, and a day off)",
    ])
  })

  test("the window's last stretch: a line at 10:59Z starts, one at 11:00Z starts nothing and is told to the dispatcher once as consult, and 12:00Z is outside (#1150)", async () => {
    const config = { ...CONFIG, consultFrom: "11:00", hours: "04:00-12:00" }
    const at = (minutes: number) => {
      const s = setup(
        line("MADE-1", "High", 1),
        {},
        { wrote: NOW.getTime() + (minutes - 1) * MINUTE },
      )
      s.later(minutes)
      return s
    }
    const before = at(179)
    await before.pass(config)
    expect(before.titles()).toEqual(["MADE-1 firefight"])
    const consult = at(180)
    await consult.pass(config)
    await consult.pass(config)
    expect(consult.spawns()).toEqual([])
    expect(consult.sent).toEqual([
      "consult MADE-1 (High): it came in after 11:00Z, the start window's last stretch, so the owner decides whether to take it; a yes goes to the Builder, who starts it",
    ])
    expect(consult.sentTo).toEqual(["dispatcher"])
    const noon = at(240)
    await noon.pass(config)
    expect(noon.spawns()).toEqual([])
    expect(noon.sent[0]).toStartWith(
      "Starting nothing: 2026-11-06 12:00Z is outside the start window",
    )
  })

  test("a row that ends at 13:00Z, outside the window, holds its ticket that day alone, so it starts at 04:00Z the next day (#1160)", async () => {
    const config = { ...CONFIG, hours: "04:00-12:00" }
    const roster = (status: string) => ({ agents: [{ name: "a", status, ticket: "MADE-1" }] })
    const s = setup(line("MADE-1", "Medium", 1), {
      "ops/ops-firefighting-start.state.json": RUNNING,
      "roster.json": roster("working"),
    })
    await s.pass(config)
    s.later(5 * 60)
    writeFileSync(join(s.data, "roster.json"), JSON.stringify(roster("ended")))
    await s.pass(config)
    s.later(15 * 60)
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(line("MADE-1", "Medium", 1), NOW.getTime() + 20 * 60 * MINUTE),
    )
    await s.pass(config)
    expect(s.titles()).toEqual(["MADE-1 firefight"])
  })

  test("in the last stretch, a ticket whose row ended today is told to the Builder as not starting, and is no consult (#1160)", async () => {
    const config = { ...CONFIG, consultFrom: "11:00", hours: "04:00-12:00" }
    const roster = (status: string) => ({ agents: [{ name: "a", status, ticket: "MADE-1" }] })
    const s = setup(line("MADE-1", "Medium", 1), {
      "ops/ops-firefighting-start.state.json": RUNNING,
      "roster.json": roster("working"),
    })
    await s.pass(config)
    writeFileSync(join(s.data, "roster.json"), JSON.stringify(roster("ended")))
    await s.pass(config)
    s.later(3 * 60 + 5)
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(line("MADE-1", "Medium", 1), NOW.getTime() + (3 * 60 + 5) * MINUTE),
    )
    await s.pass(config)
    expect(s.sentTo).toEqual(["builder"])
    expect(s.sent).toEqual(["Not starting MADE-1 again today: a, its session, ended today"])
  })

  test("in the last stretch, a ticket the cap holds waits and is no consult (#1160)", async () => {
    const s = setup(
      {
        ...line("MADE-1", "Medium", 1),
        ...line("MADE-2", "Medium", 2),
        ...line("MADE-3", "Medium", 3),
      },
      {
        "roster.json": {
          agents: [
            { name: "a", status: "working", ticket: "MADE-1" },
            { name: "b", status: "working", ticket: "MADE-2" },
          ],
        },
      },
      { wrote: NOW.getTime() + 179 * MINUTE },
    )
    s.later(180)
    await s.pass({ ...CONFIG, consultFrom: "11:00", hours: "04:00-12:00" })
    expect(s.sentTo).toEqual(["builder"])
    expect(s.sent[0]).toStartWith("Waiting on MADE-3 (Medium): 2 in progress")
  })

  test("a window that wraps past midnight reads its last stretch up to its end: 23:00Z starts, 05:00Z is a consult (#1160)", async () => {
    const config = { ...CONFIG, consultFrom: "05:00", hours: "22:00-06:00" }
    const at = (minutes: number) => {
      const s = setup(
        line("MADE-1", "High", 1),
        {},
        { wrote: NOW.getTime() + (minutes - 1) * MINUTE },
      )
      s.later(minutes)
      return s
    }
    const late = at(15 * 60)
    await late.pass(config)
    expect(late.titles()).toEqual(["MADE-1 firefight"])
    const early = at(21 * 60)
    await early.pass(config)
    expect(early.spawns()).toEqual([])
    expect(early.sentTo).toEqual(["dispatcher"])
  })

  test("theirs, busy, closed and other prefixes start nothing; theirs is told once as a skip", async () => {
    const s = setup({
      ...line("MADE-1", "High", 1, { theirs: true }),
      ...line("MADE-2", "High", 2, { busy: true }),
      ...line("MADE-3", "High", 3, { open: false }),
      ...line("OTHER-4", "Urgent", 4),
    })
    await s.pass()
    await s.pass()
    expect(s.spawns()).toEqual([])
    expect(s.sent).toEqual(["Skipped MADE-1: someone else took it"])
  })

  test("only a ticket the tracker's digest lists starts: a line another channel's thread named, with no clock entry, never does, and is told once; a file with no clock map starts nothing (#1150)", async () => {
    const s = setup(
      {
        ...line("MADE-1", "Urgent", 1, { from: "C-OTHER-THREAD" }),
        ...line("MADE-2", "Medium", 2),
      },
      {},
      { listed: ["MADE-2"] },
    )
    await s.pass()
    await s.pass()
    expect(s.titles()).toEqual(["MADE-2 firefight"])
    expect(s.sent.filter((t) => t.includes("MADE-1"))).toEqual([
      "Skipped MADE-1: no digest of the tracker lists it",
    ])
    expect(s.focus()).toEqual([])
    const bare = setup(line("MADE-1", "High", 1))
    writeFileSync(
      join(bare.data, "firefighting.json"),
      JSON.stringify({ lastTry: NOW.getTime() - MINUTE, lines: line("MADE-1", "High", 1) }),
    )
    await bare.pass()
    expect(bare.spawns()).toEqual([])
  })

  test("a line the owner holds (mine) starts like any other", async () => {
    const s = setup(line("MADE-1", "Medium", 1, { mine: true } as Partial<Line>))
    await s.pass()
    expect(s.titles()).toEqual(["MADE-1 firefight"])
  })

  test("no prefixes set starts nothing, so a fresh install names no org", async () => {
    const s = setup(line("MADE-1", "Urgent", 1))
    await s.pass({ ...CONFIG, prefixes: [] })
    expect(s.spawns()).toEqual([])
    expect(s.startFile()).toBeUndefined()
  })

  test("stale lines start nothing and are told once; fresh ones carry on", async () => {
    const s = setup(line("MADE-1", "Medium", 1), {}, { wrote: NOW.getTime() - 11 * MINUTE })
    await s.pass()
    await s.pass()
    expect(s.spawns()).toEqual([])
    expect(s.sent).toEqual([
      `Starting nothing: firefighting.json's lines are stale since ${new Date(NOW.getTime() - 11 * MINUTE).toISOString()}`,
    ])
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(line("MADE-1", "Medium", 1), NOW.getTime()),
    )
    await s.pass()
    expect(s.spawns()).toHaveLength(1)
  })

  test("the start file names the open tickets it serves, and a stale one with none open goes on the next beat", async () => {
    const s = setup(line("MADE-1", "Medium", 1), {
      [START_FILE]: { ids: ["MADE-9"], since: NOW.toISOString(), updatedAt: NOW.toISOString() },
    })
    await s.pass()
    expect(s.startFile()?.ids).toEqual(["MADE-1"])
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(line("MADE-1", "Medium", 1, { open: false }), NOW.getTime()),
    )
    await s.pass()
    expect(s.startFile()).toBeUndefined()
  })

  test("a closed line Linear reads open again is queued and told once as reopened; a theirs one is not", async () => {
    const s = setup(
      {
        ...line("MADE-1", "High", 1, { open: false }),
        ...line("MADE-2", "High", 2, { open: false, theirs: true }),
      },
      { "ops/ops-firefighting-start.state.json": RUNNING },
      { linear: { "MADE-1": "started", "MADE-2": "started" } },
    )
    await s.pass()
    expect(s.asked).toEqual([["MADE-1"]])
    expect(s.titles()).toEqual(["MADE-1 firefight"])
    expect(s.sent).toContain("MADE-1 reopened")
    expect(Object.keys(s.state().reopened)).toEqual(["MADE-1"])
  })

  test("a closed line Linear still reads done starts nothing, and one first seen closed over 3 days ago is not asked", async () => {
    const s = setup(
      line("MADE-1", "High", 1, { open: false }),
      { "ops/ops-firefighting-start.state.json": RUNNING },
      { linear: { "MADE-1": "completed" } },
    )
    await s.pass()
    expect(s.spawns()).toEqual([])
    s.later(3 * 24 * 60 + 1)
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(
        line("MADE-1", "High", 1, { open: false }),
        NOW.getTime() + (3 * 24 * 60 + 1) * MINUTE,
      ),
    )
    await s.pass()
    expect(s.asked).toEqual([["MADE-1"]])
  })

  test("on its first beat, with no state file, the lines already closed count as closed before it ran and are not asked (#1160)", async () => {
    const s = setup(
      line("MADE-1", "High", 1, { open: false }),
      {},
      { linear: { "MADE-1": "backlog" } },
    )
    await s.pass()
    s.later(10)
    await s.pass()
    expect(s.asked).toEqual([])
    expect(s.spawns()).toEqual([])
  })

  test("a stale first beat leaves the next fresh one the first: a line closed before the job ran is not asked, and a row ended before it ran holds nothing for the day (#1160)", async () => {
    const s = setup(
      line("MADE-1", "High", 1, { open: false }),
      { "roster.json": { agents: [{ name: "a", status: "ended", ticket: "MADE-2" }] } },
      { linear: { "MADE-1": "backlog" }, wrote: NOW.getTime() - 11 * MINUTE },
    )
    await s.pass()
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(
        { ...line("MADE-1", "High", 1, { open: false }), ...line("MADE-2", "Medium", 2) },
        NOW.getTime(),
      ),
    )
    await s.pass()
    expect(s.asked).toEqual([])
    expect(s.titles()).toEqual(["MADE-2 firefight"])
  })

  test("with no folder set it starts none and tells the Builder once, naming the setting", async () => {
    const s = setup(line("MADE-1", "Medium", 1))
    await s.pass({ ...CONFIG, in: undefined })
    await s.pass({ ...CONFIG, in: undefined })
    expect(s.spawns()).toEqual([])
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0]).toContain("firefighting.start.in")
  })

  test("--account goes to spawn.sh when the setting names one", async () => {
    const s = setup(line("MADE-1", "Medium", 1))
    await s.pass({ ...CONFIG, account: "made-up@example.com" })
    expect(s.spawns()[0]!.slice(-2)).toEqual(["--account", "made-up@example.com"])
  })

  test("a refused start keeps one name and one brief for its ticket across retries, told once per reason, both gone once the ticket closes (#1160)", async () => {
    let why = "the memory gate holds it"
    const s = setup(
      line("MADE-1", "Medium", 1),
      {},
      { spawned: (argv) => ({ code: 1, out: `spawn.sh refuses ${argv[2]}: ${why}\n` }) },
    )
    await s.pass()
    await s.pass()
    why = "the load gate holds it"
    await s.pass()
    expect(s.spawns().map((argv) => argv[2])).toEqual([
      "worker-made-up-1",
      "worker-made-up-1",
      "worker-made-up-1",
    ])
    expect(s.sent).toEqual([
      "Not started for MADE-1: the memory gate holds it",
      "Not started for MADE-1: the load gate holds it",
    ])
    const briefs = () => readdirSync(s.data).filter((file) => file.startsWith("brief-worker-"))
    expect(briefs()).toEqual(["brief-worker-made-up-1.md"])
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(line("MADE-1", "Medium", 1, { open: false }), NOW.getTime()),
    )
    await s.pass()
    expect(briefs()).toEqual([])
    expect(s.state().named).toEqual({})
  })

  test("a High, Medium or Low line waits while any focus stands, with no name or brief, told once, and starts once it lifts (#1160)", async () => {
    // MADE-9, an open Urgent, holds the focus ff-first-worker works under, so the job's own focus is no all-clear's to lower
    for (const reason of [`${REASON} MADE-9 open`, "the owner's demo"]) {
      const s = setup(
        { ...line("MADE-1", "Medium", 2), ...line("MADE-9", "Urgent", 1) },
        {
          "focus.json": focusFile(reason, 30, "ff-first-worker"),
          "ops/ops-firefighting-start.state.json": {
            ...RUNNING,
            started: { "MADE-9": "ff-first-worker" },
          },
          "roster.json": {
            agents: [{ name: "ff-first-worker", status: "working", ticket: "MADE-9" }],
          },
        },
      )
      await s.pass()
      await s.pass()
      expect(s.spawns()).toEqual([])
      expect(s.sent).toEqual(["Waiting on MADE-1 (Medium): focus stands for ff-first-worker"])
      expect(readdirSync(s.data).filter((file) => file.startsWith("brief-worker-"))).toEqual([])
      s.later(31)
      writeFileSync(
        join(s.data, "firefighting.json"),
        relayFile(
          { ...line("MADE-1", "Medium", 2), ...line("MADE-9", "Urgent", 1) },
          NOW.getTime() + 31 * MINUTE,
        ),
      )
      await s.pass()
      expect(s.titles()).toEqual(["MADE-1 firefight"])
    }
  })

  test("a second Urgent starts past this job's own focus, which stands again for the session that held it", async () => {
    const s = setup(
      { ...line("MADE-1", "Urgent", 1), ...line("MADE-2", "Urgent", 2) },
      {
        "focus.json": focusFile(`${REASON} MADE-1 open`, 60, "ff-first-worker"),
        "ops/ops-firefighting-start.state.json": FIRST,
        "roster.json": {
          agents: [{ name: "ff-first-worker", status: "working", ticket: "MADE-1" }],
        },
      },
    )
    await s.pass()
    expect(s.titles()).toEqual(["MADE-2 firefight"])
    expect(s.focus()).toEqual([
      ["off"],
      [
        "on",
        "--session",
        "ff-first-worker",
        "--reason",
        `${REASON} MADE-1 MADE-2 open`,
        "--for",
        "180",
      ],
    ])
  })

  test("its own focus is re-armed under 10 minutes left by an on that extends it and lowered once no Urgent is open; a hand-set one is left alone", async () => {
    const ours = setup(line("MADE-1", "Urgent", 1), {
      "focus.json": focusFile(`${REASON} MADE-1 open`, 5, "ff-first-worker"),
      "ops/ops-firefighting-start.state.json": FIRST,
      "roster.json": { agents: [{ name: "ff-first-worker", status: "working", ticket: "MADE-1" }] },
    })
    await ours.pass()
    expect(ours.spawns()).toEqual([])
    expect(ours.focus().map((args) => args[0])).toEqual(["on"])
    const cleared = setup(line("MADE-1", "Urgent", 1, { open: false }), {
      "focus.json": focusFile(`${REASON} MADE-1 open`, 60),
    })
    await cleared.pass()
    expect(cleared.focus()).toEqual([["off"]])
    const hand = setup(line("MADE-1", "Urgent", 1, { open: false }), {
      "focus.json": focusFile("the owner's demo", 60),
    })
    await hand.pass()
    expect(hand.focus()).toEqual([])
  })
})
