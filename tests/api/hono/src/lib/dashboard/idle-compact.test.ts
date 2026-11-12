import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  compactIdle,
  IDLE_COMPACT,
  type LastTurn,
  lastTurn,
  pickIdle,
} from "../../../../../../api/hono/src/lib/dashboard/idle-compact"
import type { Live, Worker } from "../../../../../../api/hono/src/lib/dashboard/workers"

const NOW = Date.parse("2026-11-07T20:00:00Z")
const ago = (minutes: number) => NOW - minutes * 60_000
const iso = (ms: number) => new Date(ms).toISOString()

// A stand-in session: an idle herdr worker whose transcript went still with its last turn, unless a field says otherwise.
const session = (name: string, fields: Partial<Worker> = {}): Worker =>
  ({
    failed: false,
    feed: [],
    herdr: true,
    light: "idle",
    name,
    questions: [],
    role: "worker",
    sessionId: `id-${name}`,
    ...fields,
  }) as Worker

// Each case: the session, its newest turn's minutes ago and context, and whether the pass picks it.
const CASES: [Worker, number, number, boolean][] = [
  [session("aaaaaa-worker"), 55, 250_000, true],
  [session("bbbbbb-runner", { role: "runner" }), 50, 200_000, true],
  [session("cccccc-reviewer"), 58, 400_000, true],
  [session("dispatcher", { role: "dispatcher" }), 55, 300_000, false],
  [session("builder", { role: "manager" }), 55, 300_000, false],
  [
    session("dddddd-worker", { feed: [{} as Worker["feed"][number]], light: "needs-you" }),
    55,
    300_000,
    false,
  ],
  [
    session("eeeeee-worker", { questions: [{ multiSelect: false, options: ["a"], prompt: "?" }] }),
    55,
    300_000,
    false,
  ],
  [session("ffffff-worker", { light: "working" }), 55, 300_000, false],
  [session("gggggg-worker"), 49, 300_000, false],
  [session("hhhhhh-worker"), 59, 300_000, false],
  [session("iiiiii-worker"), 55, 199_999, false],
  [session("jjjjjj-worker", { herdr: undefined }), 55, 300_000, false],
  [session("kkkkkk-worker", { usageLimit: {} as Worker["usageLimit"] }), 55, 300_000, false],
  [session("llllll-worker", { role: "other" }), 55, 300_000, false],
]
const PICKED = CASES.filter(([, , , picked]) => picked).map(([w]) => w.name)

const live = (workers: Worker[], lastActive?: (w: Worker) => string): Live => ({
  surfaces: new Map(workers.map((w) => [w.sessionId, `herdr:playground:${w.name}`])),
  transcripts: new Map(workers.map((w) => [w.sessionId, `/transcripts/${w.sessionId}.jsonl`])),
  workers: workers.map((w) => ({ ...w, lastActiveAt: lastActive?.(w) ?? null })),
})
const turns = new Map<string, LastTurn>(
  CASES.map(([w, minutes, context]) => [w.sessionId, { at: ago(minutes), context }]),
)

describe("pickIdle", () => {
  test("picks each worker, runner or checker idle 50 to 58 minutes at 200k+ tokens, and no dispatcher, lead, open prompt or other", () => {
    const read = live(CASES.map(([w]) => w))
    expect(pickIdle(read.workers, read, turns, NOW).map((p) => p.name)).toEqual(PICKED)
  })

  test("the window and the size are the trial's", () => {
    expect(IDLE_COMPACT).toEqual({ contextTokens: 200_000, fromMinutes: 50, toMinutes: 58 })
  })

  test("a transcript that moved after the last turn starts the wait again", () => {
    const read = live(
      CASES.map(([w]) => w),
      () => iso(ago(5)),
    )
    expect(pickIdle(read.workers, read, turns, NOW)).toEqual([])
  })

  test("a session with no surface or no known turn is left alone", () => {
    const read = live([session("mmmmmm-worker")])
    read.surfaces.clear()
    expect(
      pickIdle(
        read.workers,
        read,
        new Map([["id-mmmmmm-worker", { at: ago(55), context: 300_000 }]]),
        NOW,
      ),
    ).toEqual([])
    expect(pickIdle(read.workers, live([session("mmmmmm-worker")]), new Map(), NOW)).toEqual([])
  })
})

// A Claude Code screen's last lines as herdr's screen read gives them: the input box between the rule carrying the session's name and a plain rule, then the status line.
const screen = (box: string) =>
  [`${"─".repeat(30)} aaaaaa-worker ─`, box, "─".repeat(40), "  ⏵⏵ bypass permissions on"].join(
    "\n",
  )

describe("compactIdle", () => {
  const deps = (sent: [string, string][], fail?: string, drafts: string[] = []) => ({
    live: async () => live(CASES.map(([w]) => w)),
    now: () => NOW,
    screen: async (surface: string) =>
      screen(drafts.some((name) => surface.endsWith(name)) ? "❯ half a thought" : "❯"),
    send: async (surface: string, text: string) => {
      if (surface.endsWith(fail ?? "\0")) throw new Error("herdr refused: agent_blocked")
      sent.push([surface, text])
    },
    turn: async (path: string) => turns.get(path.replace(/^\/transcripts\/|\.jsonl$/g, "")) ?? null,
  })

  test("sends /compact through prompt to each picked pane alone, and says one line a session", async () => {
    const sent: [string, string][] = []
    const said = await compactIdle(deps(sent))
    expect(sent).toEqual(PICKED.map((name) => [`herdr:playground:${name}`, "/compact"]))
    expect(said).toEqual([
      "compacted aaaaaa-worker: 250k tokens, idle 55 min",
      "compacted bbbbbb-runner: 200k tokens, idle 50 min",
      "compacted cccccc-reviewer: 400k tokens, idle 58 min",
    ])
  })

  test("a dry pass sends nothing, and a refused send is named while the rest go on", async () => {
    const none: [string, string][] = []
    expect(await compactIdle({ ...deps(none), dry: true })).toEqual([
      "would compact aaaaaa-worker: 250k tokens, idle 55 min",
      "would compact bbbbbb-runner: 200k tokens, idle 50 min",
      "would compact cccccc-reviewer: 400k tokens, idle 58 min",
    ])
    expect(none).toEqual([])
    const sent: [string, string][] = []
    const said = await compactIdle(deps(sent, "bbbbbb-runner"))
    expect(sent.map(([surface]) => surface)).toEqual([
      "herdr:playground:aaaaaa-worker",
      "herdr:playground:cccccc-reviewer",
    ])
    expect(said[1]).toBe(
      "could not compact bbbbbb-runner: 200k tokens, idle 50 min: herdr refused: agent_blocked",
    )
  })

  test("a pane whose input box holds a draft gets no /compact, since the draft would go out with it", async () => {
    const sent: [string, string][] = []
    const said = await compactIdle(deps(sent, undefined, ["aaaaaa-worker"]))
    expect(sent.map(([surface]) => surface)).toEqual([
      "herdr:playground:bbbbbb-runner",
      "herdr:playground:cccccc-reviewer",
    ])
    expect(said[0]).toBe(
      "skipped aaaaaa-worker: 250k tokens, idle 55 min: its input box is not empty",
    )
  })
})

describe("lastTurn", () => {
  let dir = ""
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "idle-compact-"))
  })
  afterAll(async () => {
    await rm(dir, { force: true, recursive: true })
  })

  test("reads the newest main-thread request's time and context, past a sidechain and a user line", async () => {
    const path = join(dir, "s.jsonl")
    const usage = (input: number, read: number, write: number) => ({
      cache_creation_input_tokens: write,
      cache_read_input_tokens: read,
      input_tokens: input,
      output_tokens: 9,
    })
    await Bun.write(
      path,
      [
        { message: { usage: usage(1, 100, 10) }, timestamp: iso(ago(90)), type: "assistant" },
        {
          message: { usage: usage(2, 240_000, 5_000) },
          timestamp: iso(ago(55)),
          type: "assistant",
        },
        {
          isSidechain: true,
          message: { usage: usage(3, 9, 9) },
          timestamp: iso(ago(54)),
          type: "assistant",
        },
        { message: { content: "hi" }, timestamp: iso(ago(53)), type: "user" },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    )
    expect(await lastTurn(path)).toEqual({ at: ago(55), context: 245_002 })
    expect(await lastTurn(join(dir, "missing.jsonl"))).toBeNull()
  })

  test("a compaction after the last turn reads as no turn, so a compacted session waits for its next one", async () => {
    const path = join(dir, "compacted.jsonl")
    const turn = {
      message: { usage: { cache_read_input_tokens: 300_000, input_tokens: 1 } },
      timestamp: iso(ago(110)),
      type: "assistant",
    }
    const rows = [
      turn,
      { subtype: "compact_boundary", timestamp: iso(ago(55)), type: "system" },
      {
        isCompactSummary: true,
        message: { content: "summary" },
        timestamp: iso(ago(55)),
        type: "user",
      },
    ]
    await Bun.write(path, rows.map((row) => JSON.stringify(row)).join("\n"))
    expect(await lastTurn(path)).toBeNull()
    const next = { ...turn, message: { usage: { input_tokens: 9_000 } }, timestamp: iso(ago(1)) }
    await Bun.write(path, [...rows, next].map((row) => JSON.stringify(row)).join("\n"))
    expect(await lastTurn(path)).toEqual({ at: ago(1), context: 9_000 })
  })
})
