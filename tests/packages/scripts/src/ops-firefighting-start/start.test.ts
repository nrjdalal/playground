import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
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

  test("High, Medium, Low, then oldest first; at most 2 in progress, each waiting line told once", async () => {
    const s = setup({
      ...line("MADE-1", "Medium", 100),
      ...line("MADE-2", "Low", 50),
      ...line("ALSO-3", "High", 300),
      ...line("MADE-5", "Medium", 90),
    })
    await s.pass()
    await s.pass()
    expect(s.titles()).toEqual(["ALSO-3 firefight", "MADE-5 firefight"])
    expect(s.sent.filter((t) => t.startsWith("Waiting on"))).toEqual([
      "Waiting on MADE-1 (Medium): the cap of 2 in progress is reached",
      "Waiting on MADE-2 (Low): the cap of 2 in progress is reached",
    ])
  })

  test("an Urgent starts first and alone in its beat, and the High after it waits under its focus, told once (#1160)", async () => {
    const s = setup({ ...line("ALSO-3", "High", 300), ...line("MADE-4", "Urgent", 400) })
    await s.pass()
    await s.pass()
    expect(s.titles()).toEqual(["MADE-4 firefight"])
    expect(s.sent.filter((t) => t.startsWith("Waiting on"))).toEqual([
      "Waiting on ALSO-3 (High): focus stands for worker-made-up-1",
    ])
  })

  test("at 04:00Z the window opens on an Urgent and a Medium queued overnight, and the Urgent starts alone (#1160)", async () => {
    const s = setup(
      { ...line("MADE-1", "Urgent", 1), ...line("MADE-2", "Medium", 2) },
      {},
      { wrote: NOW.getTime() + (20 * 60 - 1) * MINUTE },
    )
    s.later(20 * 60)
    await s.pass({ ...CONFIG, hours: "04:00-12:00" })
    expect(s.titles()).toEqual(["MADE-1 firefight"])
    expect(s.sent).toContain("Waiting on MADE-2 (Medium): focus stands for worker-made-up-1")
  })

  test("a Medium queued after a second Urgent started past the job's own focus waits in that beat (#1160)", async () => {
    const s = setup(
      { ...line("MADE-2", "Urgent", 2), ...line("MADE-3", "Medium", 3) },
      { "focus.json": focusFile(`${REASON} MADE-1 open`, 60, "ff-first-worker") },
    )
    await s.pass()
    expect(s.titles()).toEqual(["MADE-2 firefight"])
    expect(s.sent.some((t) => t.startsWith("Waiting on MADE-3 (Medium): focus stands for"))).toBe(
      true,
    )
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
      "Starting nothing: outside the start window (hours 04:00-12:00, days off none)",
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
      "Starting nothing: outside the start window (hours 04:00-12:00, days off 2026-11-06)",
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
    expect(noon.sent[0]).toBe(
      "Starting nothing: outside the start window (hours 04:00-12:00, days off none)",
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
    expect(s.sent).toEqual(["Waiting on MADE-3 (Medium): the cap of 2 in progress is reached"])
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

  test("a High, Medium or Low line waits while any focus stands or an Urgent session the job started lives, with no name or brief, told once, and starts once both lift (#1160)", async () => {
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
      expect(s.spawns()).toEqual([])
      expect(s.sent).toEqual(["Waiting on MADE-1 (Medium): focus stands for ff-first-worker"])
      writeFileSync(
        join(s.data, "roster.json"),
        JSON.stringify({
          agents: [{ name: "ff-first-worker", status: "ended", ticket: "MADE-9" }],
        }),
      )
      // the beat that sees the Urgent's session ended lowers the focus raised for it, and the next starts the line
      await s.pass()
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

  test("an Urgent session that ends while its ticket stays open has the job's focus lowered, and none raised again (#1160)", async () => {
    const s = setup(line("MADE-1", "Urgent", 1), {
      "ops/ops-firefighting-start.state.json": RUNNING,
    })
    await s.pass()
    expect(s.focus().map((args) => args[0])).toEqual(["on"])
    writeFileSync(
      join(s.data, "roster.json"),
      JSON.stringify({ agents: [{ name: "worker-made-up-1", status: "ended", ticket: "MADE-1" }] }),
    )
    s.later(1)
    await s.pass()
    s.later(1)
    await s.pass()
    expect(s.focus().map((args) => args[0])).toEqual(["on", "off"])
    expect(s.titles()).toEqual(["MADE-1 firefight"])
  })

  test("a row that ends after the job's first beat, before its first pass inside the window, holds its ticket that day (#1160)", async () => {
    const config = { ...CONFIG, hours: "09:00-12:00" }
    const roster = (status: string) => ({ agents: [{ name: "a", status, ticket: "MADE-1" }] })
    const s = setup(line("MADE-1", "Medium", 1), { "roster.json": roster("working") })
    await s.pass(config)
    writeFileSync(join(s.data, "roster.json"), JSON.stringify(roster("ended")))
    s.later(30)
    await s.pass(config)
    s.later(30)
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(line("MADE-1", "Medium", 1), NOW.getTime() + 60 * MINUTE),
    )
    await s.pass(config)
    expect(s.spawns()).toEqual([])
  })

  test("a consultFrom outside the hours never applies, so a line at 08:00Z starts (#1160)", async () => {
    const s = setup(line("MADE-1", "High", 1))
    await s.pass({ ...CONFIG, consultFrom: "13:00", hours: "04:00-12:00" })
    expect(s.titles()).toEqual(["MADE-1 firefight"])
  })

  test("an Urgent whose start spawn.sh refuses still holds the Medium after it in that beat (#1160)", async () => {
    const s = setup(
      { ...line("MADE-1", "Urgent", 1), ...line("MADE-2", "Medium", 2) },
      {},
      {
        spawned: (argv) =>
          argv.includes("MADE-1 firefight")
            ? { code: 1, out: `spawn.sh refuses ${argv[2]}: the memory gate holds it\n` }
            : { code: 0, out: "" },
      },
    )
    await s.pass()
    expect(s.titles()).toEqual(["MADE-1 firefight"])
    expect(s.sent.some((t) => t.startsWith("Waiting on MADE-2 (Medium): focus stands for"))).toBe(
      true,
    )
  })

  test("a ticket read open again on day 2 and done on day 5 leaves the queue and starts nothing more (#1160)", async () => {
    const linear: Record<string, string> = {}
    const s = setup(
      line("MADE-1", "High", 1, { open: false }),
      { "ops/ops-firefighting-start.state.json": RUNNING },
      { linear },
    )
    let day = 0
    const at = (days: number) => {
      day += days
      s.later(days * 24 * 60)
      writeFileSync(
        join(s.data, "firefighting.json"),
        relayFile(
          line("MADE-1", "High", 1, { open: false }),
          NOW.getTime() + day * 24 * 60 * MINUTE,
        ),
      )
    }
    await s.pass()
    linear["MADE-1"] = "started"
    at(2)
    await s.pass()
    expect(s.titles()).toEqual(["MADE-1 firefight"])
    linear["MADE-1"] = "completed"
    writeFileSync(
      join(s.data, "roster.json"),
      JSON.stringify({ agents: [{ name: "worker-made-up-1", status: "ended", ticket: "MADE-1" }] }),
    )
    at(3)
    await s.pass()
    at(1)
    await s.pass()
    expect(s.titles()).toEqual(["MADE-1 firefight"])
    expect(s.state().reopened).toEqual({})
  })
})

// The date and window cases, one row each, keyed to the PR's Evidence table (F freshness, W window, C last stretch, E ended today). An outcome is a start, nothing, or a consult told to the dispatcher.
type Case = {
  at: string
  config?: Partial<StartConfig>
  ended?: string
  expect: "consult" | "none" | "start"
  id: string
  relay?: "fresh" | "mtime" | "missing" | number
  told?: string
}
const CASES: Case[] = [
  {
    at: "2026-11-07T03:59:59Z",
    config: { hours: "04:00-12:00" },
    expect: "none",
    id: "W2a",
    told: "Starting nothing: outside the start window (hours 04:00-12:00, days off none)",
  },
  { at: "2026-11-07T04:00:00Z", config: { hours: "04:00-12:00" }, expect: "start", id: "W2b" },
  { at: "2026-11-07T04:00:01Z", config: { hours: "04:00-12:00" }, expect: "start", id: "W2c" },
  { at: "2026-11-06T11:59:59Z", config: { hours: "04:00-12:00" }, expect: "start", id: "W2d" },
  { at: "2026-11-06T12:00:00Z", config: { hours: "04:00-12:00" }, expect: "none", id: "W2e" },
  { at: "2026-11-06T12:00:01Z", config: { hours: "04:00-12:00" }, expect: "none", id: "W2f" },
  { at: "2026-11-06T23:30:00Z", expect: "start", id: "W1" },
  {
    at: "2026-11-06T10:59:59Z",
    config: { consultFrom: "11:00", hours: "04:00-12:00" },
    expect: "start",
    id: "C3a",
  },
  {
    at: "2026-11-06T11:00:00Z",
    config: { consultFrom: "11:00", hours: "04:00-12:00" },
    expect: "consult",
    id: "C3b",
  },
  {
    at: "2026-11-06T11:00:01Z",
    config: { consultFrom: "11:00", hours: "04:00-12:00" },
    expect: "consult",
    id: "C3c",
  },
  {
    at: "2026-11-06T11:59:59Z",
    config: { consultFrom: "11:00", hours: "04:00-12:00" },
    expect: "consult",
    id: "C3d",
  },
  {
    at: "2026-11-06T11:30:00Z",
    config: { consultFrom: "13:00", hours: "04:00-12:00" },
    expect: "start",
    id: "C4",
  },
  { at: "2026-11-06T23:00:00Z", config: { consultFrom: "11:00" }, expect: "consult", id: "C2a" },
  { at: "2026-11-06T21:59:59Z", config: { hours: "22:00-06:00" }, expect: "none", id: "W3a" },
  { at: "2026-11-06T22:00:00Z", config: { hours: "22:00-06:00" }, expect: "start", id: "W3b" },
  { at: "2026-11-07T02:00:00Z", config: { hours: "22:00-06:00" }, expect: "start", id: "W3c" },
  { at: "2026-11-07T05:59:59Z", config: { hours: "22:00-06:00" }, expect: "start", id: "W3d" },
  { at: "2026-11-07T06:00:00Z", config: { hours: "22:00-06:00" }, expect: "none", id: "W3e" },
  {
    at: "2026-11-06T23:00:00Z",
    config: { consultFrom: "05:00", hours: "22:00-06:00" },
    expect: "start",
    id: "C5a",
  },
  {
    at: "2026-11-07T05:00:00Z",
    config: { consultFrom: "05:00", hours: "22:00-06:00" },
    expect: "consult",
    id: "C5b",
  },
  {
    at: "2026-11-07T08:00:00Z",
    config: { daysOff: ["2026-11-07"], hours: "04:00-12:00" },
    expect: "none",
    id: "W5a",
    told: "Starting nothing: outside the start window (hours 04:00-12:00, days off 2026-11-07)",
  },
  {
    at: "2026-11-08T08:00:00Z",
    config: { daysOff: ["2026-11-07"], hours: "04:00-12:00" },
    expect: "start",
    id: "W5b",
  },
  { at: "2026-11-07T23:59:59Z", config: { daysOff: ["2026-11-07"] }, expect: "none", id: "W5c" },
  { at: "2026-11-08T00:00:00Z", config: { daysOff: ["2026-11-07"] }, expect: "start", id: "W5d" },
  { at: "2026-11-06T09:00:00Z", expect: "start", id: "F4", relay: 10 * MINUTE },
  {
    at: "2026-11-06T09:00:00Z",
    expect: "none",
    id: "F1b",
    relay: 10 * MINUTE + 1000,
    told: "Starting nothing: firefighting.json's lines are stale since 2026-11-06T08:49:59.000Z",
  },
  { at: "2026-11-06T09:00:00Z", expect: "start", id: "F2", relay: "mtime" },
  {
    at: "2026-11-06T09:00:00Z",
    expect: "none",
    id: "F3",
    relay: "missing",
    told: "Starting nothing: firefighting.json's lines are stale since never written",
  },
  {
    at: "2026-11-06T09:00:00Z",
    ended: "2026-11-06",
    expect: "none",
    id: "E3",
    told: "Not starting MADE-1 again today: a, its session, ended today",
  },
  { at: "2026-11-06T09:00:00Z", ended: "2026-11-05", expect: "start", id: "E4" },
  { at: "2026-11-06T09:00:00Z", ended: "first beat", expect: "start", id: "E1" },
  { at: "2026-11-06T09:00:00Z", expect: "start", id: "F1a", relay: 5 * MINUTE },
  { at: "2026-11-06T10:59:59Z", config: { consultFrom: "11:00" }, expect: "start", id: "C2b" },
  { at: "2026-11-06T09:00:00Z", config: { hours: "09:00-09:00" }, expect: "none", id: "W4" },
  {
    at: "2026-11-06T23:00:00Z",
    config: { daysOff: ["2026-11-07"], hours: "22:00-06:00" },
    expect: "start",
    id: "W6a",
  },
  {
    at: "2026-11-07T02:00:00Z",
    config: { daysOff: ["2026-11-07"], hours: "22:00-06:00" },
    expect: "none",
    id: "W6b",
  },
  { at: "2026-11-06T11:30:00Z", config: { hours: "04:00-12:00" }, expect: "start", id: "C1" },
  {
    at: "2026-11-06T22:30:00Z",
    config: { consultFrom: "23:00", hours: "22:00-06:00" },
    expect: "start",
    id: "C6a",
  },
  {
    at: "2026-11-06T23:30:00Z",
    config: { consultFrom: "23:00", hours: "22:00-06:00" },
    expect: "consult",
    id: "C6b",
  },
  {
    at: "2026-11-07T01:00:00Z",
    config: { consultFrom: "23:00", hours: "22:00-06:00" },
    expect: "consult",
    id: "C6c",
  },
  {
    at: "2026-11-07T04:00:00Z",
    config: { consultFrom: "04:00", hours: "04:00-12:00" },
    expect: "consult",
    id: "C7",
  },
]

describe("ops-firefighting-start's date and window cases", () => {
  for (const c of CASES)
    test(`${c.id}: ${c.at}, ${JSON.stringify(c.config ?? {})}${c.ended ? `, a row ended ${c.ended}` : ""}${c.relay ? `, relay ${c.relay}` : ""}: ${c.expect}`, async () => {
      const at = Date.parse(c.at)
      const wrote = typeof c.relay === "number" ? at - c.relay : at - MINUTE
      const ended =
        c.ended === undefined
          ? {}
          : { "roster.json": { agents: [{ name: "a", status: "ended", ticket: "MADE-1" }] } }
      const state =
        c.ended === undefined || c.ended === "first beat"
          ? {}
          : { "ops/ops-firefighting-start.state.json": { ...RUNNING, ended: { a: c.ended } } }
      const s = setup(line("MADE-1", "High", 1), { ...ended, ...state }, { wrote })
      const relay = join(s.data, "firefighting.json")
      if (c.relay === "missing") rmSync(relay)
      if (c.relay === "mtime") {
        const { lastTry: _, ...rest } = JSON.parse(readFileSync(relay, "utf8"))
        writeFileSync(relay, JSON.stringify(rest))
        utimesSync(relay, new Date(at - MINUTE), new Date(at - MINUTE))
      }
      s.later((at - NOW.getTime()) / MINUTE)
      await s.pass({ ...CONFIG, ...c.config })
      if (c.expect === "start") expect(s.titles()).toEqual(["MADE-1 firefight"])
      else expect(s.spawns()).toEqual([])
      expect(s.sentTo.includes("dispatcher")).toBe(c.expect === "consult")
      if (c.told) expect(s.sent).toContain(c.told)
    })
})

describe("ops-firefighting-start's date and window flows", () => {
  const roster = (status: string) => ({ agents: [{ name: "a", status, ticket: "MADE-1" }] })
  const relayAt = (s: ReturnType<typeof setup>, minutes: number, extra: Partial<Line> = {}) =>
    writeFileSync(
      join(s.data, "firefighting.json"),
      relayFile(line("MADE-1", "High", 1, extra), NOW.getTime() + minutes * MINUTE),
    )

  test("W7: outside the window the start file goes, the line is told once across beats a minute apart, and a standing focus is left", async () => {
    const config = { ...CONFIG, hours: "04:00-07:00" }
    const s = setup(line("MADE-1", "High", 1), {
      [START_FILE]: { ids: ["MADE-1"], since: NOW.toISOString(), updatedAt: NOW.toISOString() },
      "focus.json": focusFile(`${REASON} MADE-9 open`, 60),
    })
    await s.pass(config)
    s.later(1)
    relayAt(s, 1)
    await s.pass(config)
    expect(s.startFile()).toBeUndefined()
    expect(s.focus()).toEqual([])
    expect(s.sent.filter((t) => t.includes("outside the start window"))).toHaveLength(1)
  })

  test("E5: a row seen ended at 23:59Z holds its ticket until 00:00Z, when it starts", async () => {
    const s = setup(line("MADE-1", "High", 1), {
      "ops/ops-firefighting-start.state.json": RUNNING,
      "roster.json": roster("working"),
    })
    s.later(15 * 60 + 58)
    relayAt(s, 15 * 60 + 58)
    await s.pass()
    writeFileSync(join(s.data, "roster.json"), JSON.stringify(roster("ended")))
    s.later(1)
    relayAt(s, 15 * 60 + 59)
    await s.pass()
    expect(s.spawns()).toEqual([])
    s.later(1)
    relayAt(s, 16 * 60)
    await s.pass()
    expect(s.titles()).toEqual(["MADE-1 firefight"])
  })

  test("E8: a beat with no roster file keeps the ended days, so the row still holds its ticket once the file is back", async () => {
    const s = setup(
      line("MADE-1", "High", 1),
      { "ops/ops-firefighting-start.state.json": { ...RUNNING, ended: { a: "2026-11-06" } } },
      { wrote: NOW.getTime() - 11 * MINUTE },
    )
    await s.pass()
    expect(s.state().ended).toEqual({ a: "2026-11-06" })
    writeFileSync(join(s.data, "roster.json"), JSON.stringify(roster("ended")))
    relayAt(s, 0)
    await s.pass()
    expect(s.spawns()).toEqual([])
  })

  test("E9: a row live again loses its stamp, and its next end stamps the new day", async () => {
    const s = setup(line("MADE-1", "High", 1), {
      "ops/ops-firefighting-start.state.json": { ...RUNNING, ended: { a: "2026-11-05" } },
      "roster.json": roster("working"),
    })
    await s.pass()
    expect(s.state().ended).toEqual({})
    writeFileSync(join(s.data, "roster.json"), JSON.stringify(roster("ended")))
    await s.pass()
    expect(s.state().ended).toEqual({ a: "2026-11-06" })
    expect(s.spawns()).toEqual([])
  })

  test("B2: an out-of-window first beat spends no first beat, so a line closed before the job ran is not asked", async () => {
    const config = { ...CONFIG, hours: "09:00-12:00" }
    const s = setup(
      line("MADE-1", "High", 1, { open: false }),
      {},
      { linear: { "MADE-1": "started" } },
    )
    await s.pass(config)
    s.later(60)
    relayAt(s, 60, { open: false })
    await s.pass(config)
    expect(s.asked).toEqual([])
    expect(s.spawns()).toEqual([])
  })

  test("R1: a line first seen closed exactly 3 days ago is still asked, and 6 minutes past, with the Linear throttle spent, is not", async () => {
    const s = setup(
      line("MADE-1", "High", 1, { open: false }),
      { "ops/ops-firefighting-start.state.json": RUNNING },
      { linear: { "MADE-1": "completed" } },
    )
    await s.pass()
    s.later(3 * 24 * 60)
    relayAt(s, 3 * 24 * 60, { open: false })
    await s.pass()
    s.later(6)
    relayAt(s, 3 * 24 * 60 + 6, { open: false })
    await s.pass()
    expect(s.asked).toEqual([["MADE-1"], ["MADE-1"]])
  })

  test("W8: the next day's close tells the window once more, after an open stretch clears it", async () => {
    const config = { ...CONFIG, hours: "04:00-12:00" }
    const s = setup(line("MADE-1", "High", 1, { busy: true }))
    let total = 0
    const at = async (minutes: number) => {
      s.later(minutes)
      relayAt(s, (total += minutes), { busy: true })
      await s.pass(config)
    }
    await at(4 * 60)
    await at(1)
    await at(20 * 60)
    await at(4 * 60)
    expect(s.sent.filter((t) => t.includes("outside the start window"))).toHaveLength(2)
  })

  test("F6: a beat both stale and outside the window tells the stale line alone", async () => {
    const s = setup(line("MADE-1", "High", 1), {}, { wrote: NOW.getTime() - 11 * MINUTE })
    await s.pass({ ...CONFIG, hours: "04:00-07:00" })
    expect(s.sent).toEqual([
      `Starting nothing: firefighting.json's lines are stale since ${new Date(NOW.getTime() - 11 * MINUTE).toISOString()}`,
    ])
  })

  test("U8: two Urgents started in one beat fill the cap, so the Medium after them waits on the cap, told once across beats", async () => {
    const s = setup({
      ...line("MADE-1", "Urgent", 1),
      ...line("MADE-2", "Urgent", 2),
      ...line("MADE-3", "Medium", 3),
    })
    await s.pass()
    s.later(1)
    relayAt(s, 1)
    writeFileSync(
      join(s.data, "roster.json"),
      JSON.stringify({
        agents: [
          { name: "worker-made-up-1", status: "working", ticket: "MADE-1" },
          { name: "worker-made-up-2", status: "working", ticket: "MADE-2" },
        ],
      }),
    )
    await s.pass()
    expect(s.titles()).toEqual(["MADE-1 firefight", "MADE-2 firefight"])
    expect(s.sent.filter((t) => t.startsWith("Waiting on MADE-3"))).toEqual([
      "Waiting on MADE-3 (Medium): the cap of 2 in progress is reached",
    ])
  })

  test("U9: the job's own focus is re-armed with under 10 minutes left, not at exactly 10", async () => {
    for (const [left, calls] of [
      [10, []],
      [9 + 59 / 60, ["on"]],
    ] as const) {
      const s = setup(line("MADE-1", "Urgent", 1), {
        "focus.json": focusFile(`${REASON} MADE-1 open`, left, "ff-first-worker"),
        "ops/ops-firefighting-start.state.json": FIRST,
        "roster.json": {
          agents: [{ name: "ff-first-worker", status: "working", ticket: "MADE-1" }],
        },
      })
      await s.pass()
      expect(s.focus().map((args) => args[0])).toEqual([...calls])
    }
  })

  test("F7: a relay file that does not parse reads as stale, told once, and starts nothing", async () => {
    const s = setup(line("MADE-1", "High", 1), {
      [START_FILE]: { ids: ["MADE-1"], since: NOW.toISOString(), updatedAt: NOW.toISOString() },
    })
    const relay = join(s.data, "firefighting.json")
    writeFileSync(relay, "{ half written")
    utimesSync(relay, new Date(NOW.getTime() - MINUTE), new Date(NOW.getTime() - MINUTE))
    await s.pass()
    await s.pass()
    expect(s.spawns()).toEqual([])
    expect(s.startFile()).toBeUndefined()
    expect(s.sent).toEqual(["Starting nothing: firefighting.json does not parse"])
  })

  test("U11: the job's own Urgent closes while an Urgent it did not start stays open, so one beat lowers its focus and the next starts the lower line", async () => {
    const lines = {
      ...line("MADE-1", "Urgent", 1, { open: false }),
      ...line("MADE-2", "Urgent", 2, { busy: true }),
      ...line("MADE-3", "Medium", 3),
    }
    const s = setup(lines, {
      "focus.json": focusFile(`${REASON} MADE-1 open`, 60, "ff-first-worker"),
      "ops/ops-firefighting-start.state.json": FIRST,
      "roster.json": {
        agents: [{ name: "ff-first-worker", status: "working", ticket: "MADE-1" }],
      },
    })
    await s.pass()
    expect(s.spawns()).toEqual([])
    expect(s.focus()).toEqual([["off"]])
    s.later(1)
    writeFileSync(join(s.data, "firefighting.json"), relayFile(lines, NOW.getTime() + MINUTE))
    await s.pass()
    expect(s.titles()).toEqual(["MADE-3 firefight"])
  })

  test("R2: Linear is asked at most every 5 minutes", async () => {
    const s = setup(
      line("MADE-1", "High", 1, { open: false }),
      { "ops/ops-firefighting-start.state.json": RUNNING },
      { linear: { "MADE-1": "completed" } },
    )
    await s.pass()
    s.later(4)
    relayAt(s, 4, { open: false })
    await s.pass()
    expect(s.asked).toHaveLength(1)
    s.later(1)
    relayAt(s, 5, { open: false })
    await s.pass()
    expect(s.asked).toHaveLength(2)
  })
})

// firefighting.json with a prepare map beside the lines: a registered ticket the digest does not list yet, written a minute before NOW unless `wrote` says.
const prepareFile = (
  lines: Record<string, Line>,
  prepare: Record<string, string>,
  {
    listed = Object.keys(lines),
    wrote = NOW.getTime() - MINUTE,
  }: { listed?: string[]; wrote?: number } = {},
) => ({
  ...JSON.parse(relayFile(lines, wrote, listed)),
  prepare: Object.fromEntries(Object.entries(prepare).map(([id, at]) => [id, { at }])),
})
const PREPARE: StartConfig = { ...CONFIG, prepareBrief: "brief-ff-prepare.md" }
const REGISTERED = new Date(NOW.getTime() - 2 * MINUTE).toISOString()

describe("prepare-only starts", () => {
  const prepared = (
    lines: Record<string, Line> = {},
    prepare: Record<string, string> = { "MADE-5": REGISTERED },
    extra: Record<string, unknown> = {},
    options: Parameters<typeof setup>[2] = {},
  ) => {
    const s = setup(lines, { "firefighting.json": prepareFile(lines, prepare), ...extra }, options)
    writeFileSync(join(s.data, "brief-ff-prepare.md"), "Prepare {TICKET} as {NAME}, locally.\n")
    const rosterSets = () =>
      s.runs
        .filter((argv) => argv.some((a) => a.endsWith("roster.ts")))
        .map((argv) => argv.slice(-3))
    const relay = (
      minutes: number,
      lines2: Record<string, Line>,
      prepare2: Record<string, string>,
      listed?: string[],
    ) =>
      writeFileSync(
        join(s.data, "firefighting.json"),
        JSON.stringify(
          prepareFile(lines2, prepare2, { listed, wrote: NOW.getTime() + minutes * MINUTE }),
        ),
      )
    return { ...s, relay, rosterSets }
  }

  test("P1: a ticket the prepare map holds starts a prepare-only worker from prepareBrief, titled <id> prepare, its row mode=prepare", async () => {
    const s = prepared()
    await s.pass(PREPARE)
    expect(s.titles()).toEqual(["MADE-5 prepare"])
    expect(await Bun.file(join(s.data, "brief-worker-made-up-1.md")).text()).toBe(
      "Prepare MADE-5 as worker-made-up-1, locally.\n",
    )
    expect(s.rosterSets()).toEqual([["worker-made-up-1", "ticket=MADE-5", "mode=prepare"]])
    expect(s.sent).toEqual([
      "Started worker-made-up-1 for MADE-5 (no urgency) with --firefighting, prepare-only, from brief-ff-prepare.md",
    ])
    expect([s.state().prepared, s.startFile()?.ids]).toEqual([
      { "MADE-5": "worker-made-up-1" },
      ["MADE-5"],
    ])
  })

  test("P2: with no prepareBrief the prepare map starts nothing", async () => {
    const s = prepared()
    await s.pass()
    expect([s.spawns(), s.sent, s.startFile()]).toEqual([[], [], undefined])
  })

  test("P3: once the digest lists it, the same session is told to claim it now and its mode drops, with no second start", async () => {
    const s = prepared()
    await s.pass(PREPARE)
    s.later(1)
    s.relay(1, line("MADE-5", "Medium", 1), {})
    await s.pass(PREPARE)
    expect(s.titles()).toEqual(["MADE-5 prepare"])
    expect(s.sentTo.at(-2)).toBe("worker-made-up-1")
    expect(s.sent.slice(-2)).toEqual([
      "claim MADE-5 now: the digest lists it, so take it and go on to the PR",
      "Claimed MADE-5: worker-made-up-1, its prepare-only worker, takes it now",
    ])
    expect(s.rosterSets().at(-1)).toEqual(["set", "worker-made-up-1", "mode="])
    expect([s.state().prepared, s.state().started]).toEqual([{}, { "MADE-5": "worker-made-up-1" }])
    s.later(1)
    s.relay(2, line("MADE-5", "Medium", 1), {})
    await s.pass(PREPARE)
    expect([s.titles(), s.sent.length]).toEqual([["MADE-5 prepare"], 3])
  })

  test("P4: a ticket that leaves the prepare map with no clock entry stops its session with its branch local, outside the window too", async () => {
    const s = prepared()
    await s.pass(PREPARE)
    s.later(1)
    s.relay(1, {}, {})
    await s.pass({ ...PREPARE, hours: "04:00-07:00" })
    expect(s.sentTo.slice(1, 3)).toEqual(["worker-made-up-1", "builder"])
    expect(s.sent.slice(1, 3)).toEqual([
      "stop MADE-5: it left the prepare list with no digest entry, so it is not ours to take; keep its branch local, push nothing, and end",
      "Stopped worker-made-up-1, the prepare-only worker for MADE-5: it left the prepare list with no digest entry",
    ])
    expect([s.state().prepared, s.state().started]).toEqual([{}, {}])
  })

  test("P5: in the last stretch a prepare-only worker still starts, while a listed line consults; a prepared ticket listed then consults too, with no claim", async () => {
    const config = { ...PREPARE, consultFrom: "07:30", hours: "04:00-12:00" }
    const s = prepared(line("MADE-1", "Medium", 1))
    await s.pass(config)
    expect(s.titles()).toEqual(["MADE-5 prepare"])
    expect(s.sentTo.filter((to) => to === "dispatcher")).toHaveLength(1)
    s.later(1)
    s.relay(1, { ...line("MADE-1", "Medium", 1), ...line("MADE-5", "High", 2) }, {})
    await s.pass(config)
    expect(s.sent.at(-1)).toBe(
      "consult MADE-5 (High): it was listed after 07:30Z, the start window's last stretch, so the owner decides whether to take it; a yes goes to the Builder, who tells worker-made-up-1, its prepare-only worker, to claim it",
    )
    expect([s.sent.some((t) => t.startsWith("claim ")), s.state().prepared]).toEqual([
      false,
      { "MADE-5": "worker-made-up-1" },
    ])
  })

  test("P6: outside the window and on a day off the prepare map starts nothing", async () => {
    for (const config of [
      { ...PREPARE, hours: "09:00-12:00" },
      { ...PREPARE, daysOff: [NOW.toISOString().slice(0, 10)] },
    ]) {
      const s = prepared()
      await s.pass(config)
      expect(s.spawns()).toEqual([])
    }
  })

  test("P7: the cap of 2 in progress holds a prepare-only start, and an ID the digest already lists starts as a claim, never a prepare", async () => {
    const lines = { ...line("MADE-1", "High", 1), ...line("MADE-2", "High", 2) }
    const s = prepared(lines, { "MADE-5": REGISTERED, "MADE-2": REGISTERED })
    await s.pass(PREPARE)
    expect(s.titles()).toEqual(["MADE-1 firefight", "MADE-2 firefight"])
    expect(s.sent.at(-1)).toBe(
      "Waiting on MADE-5 (no urgency): the cap of 2 in progress is reached",
    )
  })

  test("P8: a prepared ticket listed with its line taken by someone else stops its session, with no claim", async () => {
    const s = prepared()
    await s.pass(PREPARE)
    s.later(1)
    s.relay(1, line("MADE-5", "Medium", 1, { theirs: true }), {})
    await s.pass(PREPARE)
    expect(s.sent.slice(1)).toEqual([
      "Skipped MADE-5: someone else took it",
      "stop MADE-5: someone else took it before you claimed it; keep its branch local, push nothing, and end",
      "Stopped worker-made-up-1, the prepare-only worker for MADE-5: someone else took it",
    ])
  })

  // The roster a session's row reads after a pass, which the fake's roster sets never write.
  const row = (s: { data: string }, fields: Record<string, string>) =>
    writeFileSync(
      join(s.data, "roster.json"),
      JSON.stringify({
        agents: [{ name: "worker-made-up-1", status: "working", ticket: "MADE-5", ...fields }],
      }),
    )

  test("P9: a prepare-only start refused before its ticket is listed leaves no prepare brief, so the full start under the same name takes the full one", async () => {
    let refuse = true
    const s = prepared(undefined, undefined, undefined, {
      spawned: (argv) =>
        refuse
          ? { code: 1, out: `spawn.sh refuses ${argv[2]}: the load gate holds it\n` }
          : { code: 0, out: "" },
    })
    await s.pass(PREPARE)
    refuse = false
    s.later(1)
    s.relay(1, line("MADE-5", "Medium", 1), {})
    await s.pass(PREPARE)
    expect(s.titles()).toEqual(["MADE-5 prepare", "MADE-5 firefight"])
    expect(await Bun.file(join(s.data, "brief-worker-made-up-1.md")).text()).toBe(
      "Work MADE-5 as worker-made-up-1.\n",
    )
    expect(s.rosterSets()).toEqual([["set", "worker-made-up-1", "ticket=MADE-5"]])
  })

  test("P10: a prepare-only worker that stopped and ended holds nothing off: its ticket listed the same day starts a full worker", async () => {
    const s = prepared()
    await s.pass(PREPARE)
    s.later(1)
    s.relay(1, {}, {})
    await s.pass(PREPARE)
    s.later(1)
    row(s, { mode: "prepare", status: "ended" })
    s.relay(2, line("MADE-5", "Medium", 1), {})
    await s.pass(PREPARE)
    expect(s.titles()).toEqual(["MADE-5 prepare", "MADE-5 firefight"])
    expect(s.sent.at(-1)).toBe(
      "Started worker-made-up-2 for MADE-5 (Medium) with --firefighting, from brief-ff.md",
    )
  })

  test("P11: a claim whose mode= did not land is set again on the next fresh beat, and once more on none after it reads clear", async () => {
    const s = prepared()
    await s.pass(PREPARE)
    s.later(1)
    s.relay(1, line("MADE-5", "Medium", 1), {})
    await s.pass(PREPARE)
    row(s, { mode: "prepare" })
    s.later(1)
    s.relay(2, line("MADE-5", "Medium", 1), {})
    await s.pass(PREPARE)
    expect(s.rosterSets().slice(1)).toEqual([
      ["set", "worker-made-up-1", "mode="],
      ["set", "worker-made-up-1", "mode="],
    ])
    row(s, {})
    s.later(1)
    s.relay(3, line("MADE-5", "Medium", 1), {})
    await s.pass(PREPARE)
    expect(s.rosterSets()).toHaveLength(3)
  })

  test("P12: a prepare-only start whose mode=prepare did not land is set again on the next fresh beat", async () => {
    const s = prepared()
    await s.pass(PREPARE)
    row(s, {})
    s.later(1)
    s.relay(1, {}, { "MADE-5": REGISTERED }, [])
    await s.pass(PREPARE)
    expect(s.rosterSets()).toEqual([
      ["worker-made-up-1", "ticket=MADE-5", "mode=prepare"],
      ["set", "worker-made-up-1", "mode=prepare"],
    ])
  })

  test("P14: a prepare-only worker that ends while its ticket stays in the prepare map unlisted starts no second one that day", async () => {
    const s = prepared()
    await s.pass(PREPARE)
    s.later(1)
    row(s, { mode: "prepare", status: "ended" })
    s.relay(1, {}, { "MADE-5": REGISTERED }, [])
    await s.pass(PREPARE)
    s.later(1)
    s.relay(2, {}, { "MADE-5": REGISTERED }, [])
    await s.pass(PREPARE)
    expect(s.titles()).toEqual(["MADE-5 prepare"])
    expect(s.sent.at(-1)).toBe(
      "Not starting MADE-5 again today: worker-made-up-1, its session, ended today",
    )
  })

  test("P15: a High, Medium or Low claim waits while a focus stands, its session still prepare-only, and claims on the beat after the focus goes", async () => {
    const s = prepared()
    await s.pass(PREPARE)
    writeFileSync(
      join(s.data, "focus.json"),
      JSON.stringify(focusFile("the owner's demo", 30, "ff-other")),
    )
    s.later(1)
    s.relay(1, line("MADE-5", "Medium", 1), {})
    await s.pass(PREPARE)
    expect(s.sent.at(-1)).toBe("Waiting on MADE-5 (Medium): focus stands for ff-other")
    expect([s.sent.some((t) => t.startsWith("claim ")), s.state().prepared]).toEqual([
      false,
      { "MADE-5": "worker-made-up-1" },
    ])
    rmSync(join(s.data, "focus.json"))
    s.later(1)
    s.relay(2, line("MADE-5", "Medium", 1), {})
    await s.pass(PREPARE)
    expect(s.sent.slice(-2)).toEqual([
      "claim MADE-5 now: the digest lists it, so take it and go on to the PR",
      "Claimed MADE-5: worker-made-up-1, its prepare-only worker, takes it now",
    ])
    expect(s.state().prepared).toEqual({})
  })

  test("P13: a line someone else took while its ticket waits in the prepare map stops its prepare-only worker", async () => {
    const s = prepared()
    await s.pass(PREPARE)
    s.later(1)
    s.relay(1, line("MADE-5", "Medium", 1, { theirs: true }), { "MADE-5": REGISTERED }, [])
    await s.pass(PREPARE)
    expect(s.sentTo.slice(1, 3)).toEqual(["worker-made-up-1", "builder"])
    expect(s.sent.slice(1, 3)).toEqual([
      "stop MADE-5: someone else took it, so it is not ours to take; keep its branch local, push nothing, and end",
      "Stopped worker-made-up-1, the prepare-only worker for MADE-5: someone else took it",
    ])
    expect([s.state().prepared, s.titles()]).toEqual([{}, ["MADE-5 prepare"]])
  })
})
