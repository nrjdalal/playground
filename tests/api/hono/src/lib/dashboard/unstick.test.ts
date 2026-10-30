import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  blockedSessions,
  type Blocked,
  type Held,
  parseUnstick,
  readUnstick,
  UNSTICK_STALE_MS,
  unstickPath,
  usageLimitOf,
} from "../../../../../../api/hono/src/lib/dashboard/unstick"
import {
  withBlocked,
  type Live,
  type Worker,
} from "../../../../../../api/hono/src/lib/dashboard/workers"
import type { Usage } from "../../../../../../api/hono/src/lib/usage/window"
import { liveReads } from "../../../../../live-reads"

// These drive the live paths against the test's own scratch files.
liveReads()

const NOW = Date.parse("2026-10-07T22:00:00.000Z")
const ENTRY = {
  kind: "usage-limit",
  line: "You've hit your limit",
  name: "worker-greed",
  since: "2026-10-07T21:50:00.000Z",
  surface: "5F000000-0000-4000-8000-000000000002",
  workspace: "workspace:3",
}
const state = (fields: Record<string, unknown>) =>
  JSON.stringify({
    blocked: [ENTRY],
    unreadable: [],
    writtenAt: "2026-10-07T21:59:00.000Z",
    ...fields,
  })

describe("parseUnstick", () => {
  test("a fresh file's entries are read whole", () => {
    expect(parseUnstick(state({}), NOW)).toEqual([ENTRY])
  })

  // ops-unstick writes every 2 minutes, so a file this old is a job that has stopped, and what it says is no longer known.
  test("a file whose writtenAt is over 3 minutes old, missing or not a time is ignored whole", () => {
    const old = new Date(NOW - UNSTICK_STALE_MS - 1000).toISOString()
    expect(parseUnstick(state({ writtenAt: old }), NOW)).toEqual([])
    expect(parseUnstick(state({ writtenAt: undefined }), NOW)).toEqual([])
    expect(parseUnstick(state({ writtenAt: "soon" }), NOW)).toEqual([])
    const edge = new Date(NOW - UNSTICK_STALE_MS).toISOString()
    expect(parseUnstick(state({ writtenAt: edge }), NOW)).toEqual([ENTRY])
  })

  test("text that is not a JSON object, or no blocked list, reads as nothing blocked", () => {
    for (const raw of [
      "",
      "{",
      "[]",
      "null",
      JSON.stringify({ writtenAt: "2026-10-07T21:59:00Z" }),
    ])
      expect(parseUnstick(raw, NOW)).toEqual([])
  })

  // ops-unstick owns the shape, so a field that does not read costs only itself, and an entry naming no session costs only itself.
  test("each field is read on its own, and an entry with neither a surface nor a name is dropped", () => {
    const blocked = [
      { ...ENTRY, kind: 7, line: null, since: ["x"] },
      { kind: "picker", workspace: "workspace:1" },
      "worker-envy",
      null,
      { name: "worker-envy", surface: "" },
    ]
    expect(parseUnstick(state({ blocked }), NOW)).toEqual([
      { ...ENTRY, kind: null, line: null, since: null },
      { kind: null, line: null, name: "worker-envy", since: null, surface: null, workspace: null },
    ])
  })
})

describe("readUnstick", () => {
  test("reads the file in the data folder, and a missing file is nothing blocked", async () => {
    const before = process.env.PLAYGROUND_DATA_DIR
    const dir = mkdtempSync(join(tmpdir(), "unstick-"))
    process.env.PLAYGROUND_DATA_DIR = join(dir, "playground")
    try {
      expect(unstickPath()).toBe(join(dir, "playground", "ops", "unstick", "state.json"))
      expect(await readUnstick(NOW)).toEqual([])
      mkdirSync(join(dir, "playground", "ops", "unstick"), { recursive: true })
      writeFileSync(unstickPath(), state({}))
      expect(await readUnstick(NOW)).toEqual([ENTRY])
    } finally {
      if (before === undefined) delete process.env.PLAYGROUND_DATA_DIR
      else process.env.PLAYGROUND_DATA_DIR = before
      rmSync(dir, { force: true, recursive: true })
    }
  })
})

const worker = (name: string, sessionId: string, light: Worker["light"] = "working") =>
  ({ light, name, sessionId }) as Worker

const keys = (blocked: Map<string, Blocked[]>) => new Set(blocked.keys())

const blocks = (...ids: string[]) => new Map(ids.map((id) => [id, [ENTRY]]))

describe("blockedSessions", () => {
  const sessions: Held[] = [
    { name: "worker-greed", sessionId: "s-greed", surface: "5F000000-0000-4000-8000-000000000002" },
    { name: "worker-envy", sessionId: "s-envy", surface: "5F000000-0000-4000-8000-000000000003" },
  ]
  const entry = (fields: Partial<Blocked>): Blocked => ({ ...ENTRY, ...fields })
  const marked = (entries: Blocked[], held = sessions) =>
    keys(blockedSessions(entries, held).sessions)

  test("an entry matches its session by surface", () => {
    expect(marked([entry({})])).toEqual(new Set(["s-greed"]))
  })

  // an entry naming dispatcher on another worker's surface put a wrong Waiting on you on Playground's row and held his messages, so a missed block is the lesser harm
  test("an entry whose surface and name point at two live sessions marks neither, and names the conflict", () => {
    const { conflicts, sessions: hit } = blockedSessions([entry({ name: "worker-envy" })], sessions)
    expect(hit.size).toBe(0)
    expect(conflicts).toEqual([
      "ops-unstick lists worker-envy as blocked (usage-limit) on surface 5F000000-0000-4000-8000-000000000002, which worker-greed holds, so neither is marked",
    ])
  })

  // deliver() reads one workspace's sessions alone, so the last whole board's sessions, listed after its own, tell it the surface or the name is another session's
  test("a session off this board, by surface or by name, still stops the match", () => {
    const gate = {
      name: "worker-gate",
      sessionId: "s-gate",
      surface: "5F000000-0000-4000-8000-000000000009",
    }
    const onGates = entry({ name: "worker-greed", surface: gate.surface })
    expect(marked([onGates], [sessions[0]!, gate])).toEqual(new Set())
    const namesGate = entry({ name: "worker-gate" })
    expect(marked([namesGate], [sessions[0]!, gate])).toEqual(new Set())
  })

  test("this board's holder of a surface outranks an older board's", () => {
    const stale = { name: "worker-old", sessionId: "s-old", surface: sessions[0]!.surface }
    const { conflicts, sessions: hit } = blockedSessions([entry({})], [...sessions, stale])
    expect(conflicts).toEqual([])
    expect(keys(hit)).toEqual(new Set(["s-greed"]))
  })

  test("an entry whose surface no live session holds, or that names none, matches by name", () => {
    expect(marked([entry({ surface: "gone" })])).toEqual(new Set(["s-greed"]))
    expect(marked([entry({ name: "worker-envy", surface: null })])).toEqual(new Set(["s-envy"]))
    expect(marked([entry({ surface: "surface:24" })])).toEqual(new Set(["s-greed"]))
  })

  test("an entry that matches no live session marks nothing and names no conflict", () => {
    const { conflicts, sessions: hit } = blockedSessions(
      [entry({ name: "worker-sloth", surface: "gone" })],
      sessions,
    )
    expect(conflicts).toEqual([])
    expect(hit.size).toBe(0)
  })

  test("each session keeps every entry that names it, for its kinds", () => {
    const permission = entry({ kind: "permission", line: "Do you want to proceed?" })
    expect(blockedSessions([ENTRY, permission], sessions).sessions.get("s-greed")).toEqual([
      ENTRY,
      permission,
    ])
  })
})

// Not every wait is an emergency: a session the usage limit alone holds waits on the reset, not on a person.
describe("usageLimitOf", () => {
  const limit = (line: string | null): Blocked => ({ ...ENTRY, line })
  const usage = (five: number | null, week: number | null): Usage => ({
    fiveHour: five === null ? null : { resetsAt: "2026-10-07T23:00:00.000Z", usedPercent: five },
    sevenDay: week === null ? null : { resetsAt: "2026-10-09T00:00:00.000Z", usedPercent: week },
    stale: false,
    writtenAt: "2026-10-07T21:59:00.000Z",
  })

  test("the dialog's own reset is used when its line names one: its time and zone alone", () => {
    expect(
      usageLimitOf([limit("You've hit your session limit · resets 3am (Asia/Calcutta)")], null),
    ).toEqual({ resets: "3am (Asia/Calcutta)", resetsAt: null })
    // ops-unstick appends why it left the dialog, and a boxed line keeps its border
    for (const tail of [
      " (no room: someone@example.com: 5h 100%, 7d 40%)",
      "                         │",
    ])
      expect(
        usageLimitOf(
          [limit(`You've hit your session limit · resets 3am (Asia/Calcutta)${tail}`)],
          null,
        ),
      ).toEqual({ resets: "3am (Asia/Calcutta)", resetsAt: null })
    for (const line of [
      "Usage limit reached · resets at 10:30pm",
      "Usage limit reached · resets at 10:30pm (no room: someone@example.com: 5h 100%, 7d 40%)",
    ])
      expect(usageLimitOf([limit(line)], null)).toEqual({ resets: "10:30pm", resetsAt: null })
    for (const zone of ["UTC", "Etc/GMT+5", "America/Argentina/Buenos_Aires"])
      expect(usageLimitOf([limit(`You've hit your limit · resets 3am (${zone})`)], null)).toEqual({
        resets: `3am (${zone})`,
        resetsAt: null,
      })
  })

  test("else the reset of the window that is full, else the soonest one", () => {
    expect(usageLimitOf([limit("You've hit your limit")], usage(40, 100))).toEqual({
      resets: null,
      resetsAt: "2026-10-09T00:00:00.000Z",
    })
    expect(usageLimitOf([limit(null)], usage(80, 60))).toEqual({
      resets: null,
      resetsAt: "2026-10-07T23:00:00.000Z",
    })
    expect(usageLimitOf([limit(null)], null)).toEqual({ resets: null, resetsAt: null })
    // both full: it is held until the later of the two resets
    expect(usageLimitOf([limit(null)], usage(100, 100))).toEqual({
      resets: null,
      resetsAt: "2026-10-09T00:00:00.000Z",
    })
  })

  test("any block that needs a person, or a limit still showing past its reset, is not a usage pause", () => {
    expect(usageLimitOf([ENTRY, { ...ENTRY, kind: "permission" }], null)).toBeNull()
    expect(usageLimitOf([{ ...ENTRY, kind: "login" }], null)).toBeNull()
    expect(usageLimitOf([{ ...ENTRY, kind: "usage-limit-stuck" }], null)).toBeNull()
    // ops-unstick found room and its Escape failed, so the limit is not what holds it: it needs a nudge
    expect(
      usageLimitOf(
        [limit("You've hit your limit · resets 3am (UTC) (Escape did not clear it)")],
        null,
      ),
    ).toBeNull()
    expect(usageLimitOf([], null)).toBeNull()
  })
})

describe("withBlocked", () => {
  test("a blocked session waits on you, and the rest keep their light", () => {
    const live: Live = {
      surfaces: new Map(),
      transcripts: new Map(),
      workers: [worker("worker-greed", "s-greed", "idle"), worker("worker-envy", "s-envy", "idle")],
    }
    expect(withBlocked(live, blocks("s-greed")).workers.map((w) => w.light)).toEqual([
      "needs-you",
      "idle",
    ])
    expect(withBlocked(live, new Map())).toBe(live)
  })

  test("a session ops-unstick finds on a /login prompt waits, and carries loginExpired for its Add account card", () => {
    const live: Live = {
      surfaces: new Map(),
      transcripts: new Map(),
      workers: [worker("worker-greed", "s-greed", "idle"), worker("worker-envy", "s-envy", "idle")],
    }
    const login = new Map([["s-greed", [{ ...ENTRY, kind: "login", line: "Please run /login" }]]])
    const [greed, envy] = withBlocked(live, login).workers
    expect(greed).toMatchObject({ light: "needs-you", loginExpired: true })
    expect(greed?.usageLimit).toBeUndefined()
    expect(envy?.loginExpired).toBeUndefined()
    expect(withBlocked(live, blocks("s-greed")).workers[0]?.loginExpired).toBeUndefined()
  })

  test("a session the usage limit alone holds still waits, so nothing is typed into it, and carries its reset", () => {
    const live: Live = {
      surfaces: new Map(),
      transcripts: new Map(),
      workers: [worker("worker-greed", "s-greed", "idle")],
    }
    const paused = withBlocked(live, blocks("s-greed")).workers[0]
    expect(paused?.light).toBe("needs-you")
    expect(paused?.usageLimit).toEqual({ resets: null, resetsAt: null })
    const permission = new Map([["s-greed", [{ ...ENTRY, kind: "permission" }]]])
    expect(withBlocked(live, permission).workers[0]?.usageLimit).toBeUndefined()
  })

  test("a session already at a prompt of its own is not paused, since a person must answer it", () => {
    const live: Live = {
      surfaces: new Map(),
      transcripts: new Map(),
      workers: [worker("worker-greed", "s-greed", "needs-you")],
    }
    expect(withBlocked(live, blocks("s-greed")).workers[0]?.usageLimit).toBeUndefined()
  })

  // A probe's dialogs are its spawner's to clear, as its pickers are, so it never lights an alarm.
  test("a blocked probe keeps its light", () => {
    const probe = { ...worker("probe-paste", "s-probe", "idle"), role: "other" } as Worker
    const live: Live = { surfaces: new Map(), transcripts: new Map(), workers: [probe] }
    expect(withBlocked(live, blocks("s-probe")).workers[0]?.light).toBe("idle")
  })
})
