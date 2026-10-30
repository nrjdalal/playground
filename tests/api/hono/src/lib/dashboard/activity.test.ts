import { describe, expect, test } from "bun:test"

import {
  ActivityWatch,
  parseActivity,
  parseWatchMessage,
  sameActivity,
  seconds,
  tokenCount,
  type ActivityFrame,
} from "../../../../../../api/hono/src/lib/dashboard/activity"
import { DashboardHub } from "../../../../../../api/hono/src/lib/dashboard/hub"
import type { Live, Worker } from "../../../../../../api/hono/src/lib/dashboard/workers"

// A working session's screen as read-screen gives it: the transcript, the spinner line, its tip, then the input box between two rules.
const screen = (spinner: string | null) =>
  [
    "⏺ Read(api/hono/src/lib/dashboard/hub.ts)",
    "  ⎿  Read 412 lines",
    "",
    ...(spinner === null ? [] : [spinner]),
    "  ⎿  Tip: Use /btw to ask a quick side question without interrupting Claude's current work",
    "",
    "────────────────────────────────────────",
    "❯ ",
    "────────────────────────────────────────",
    "  ⏵⏵ bypass permissions on (shift+tab to cycle)",
  ].join("\n")

describe("parseActivity", () => {
  test("reads the spinner line's verb, elapsed time, tokens and thinking time", () => {
    expect(parseActivity(screen("✻ Whisking… (1m 11s · ↓ 2.1k tokens · thought for 4s)"))).toEqual({
      elapsed: 71,
      thought: 4,
      tokens: 2100,
      verb: "Whisking",
    })
  })

  test("reads every glyph the spinner cycles through", () => {
    for (const glyph of ["✻", "✽", "✶", "✳", "✢", "·"]) {
      expect(parseActivity(screen(`${glyph} Formulating… (3s · ↑ 120 tokens)`))).toEqual({
        elapsed: 3,
        thought: null,
        tokens: 120,
        verb: "Formulating",
      })
    }
  })

  test("a missing optional part reads as null, and an unknown part is ignored", () => {
    expect(parseActivity(screen("✶ Pondering… (42s)"))).toEqual({
      elapsed: 42,
      thought: null,
      tokens: null,
      verb: "Pondering",
    })
    expect(
      parseActivity(screen("✶ Pondering… (2m 5s · esc to interrupt · ↓ 1.4M tokens · new thing)")),
    ).toEqual({ elapsed: 125, thought: null, tokens: 1_400_000, verb: "Pondering" })
  })

  test("an idle screen, with no spinner line, is no activity", () => {
    expect(parseActivity(screen(null))).toBeNull()
    expect(parseActivity("")).toBeNull()
  })

  test("a finished step's summary line is not activity", () => {
    expect(parseActivity(screen("✻ Cooked for 1m 2s"))).toBeNull()
  })

  test("the verb carries letters alone, so no other screen text can leave in it", () => {
    expect(parseActivity(screen("✻ rm -rf /… (3s)"))).toBeNull()
    expect(parseActivity(screen("✻ Token sk-ant-abc123… (3s)"))).toBeNull()
    expect(parseActivity(screen("✻ Secret hunter… (3s)"))).toBeNull()
    const activity = parseActivity(
      screen("✻ Whisking… (1m 11s · ↓ 2.1k tokens · password=hunter2)"),
    )
    expect(activity).toEqual({ elapsed: 71, thought: null, tokens: 2100, verb: "Whisking" })
    expect(Object.keys(activity ?? {}).sort()).toEqual(["elapsed", "thought", "tokens", "verb"])
    expect(JSON.stringify(activity)).not.toContain("hunter2")
  })

  test("reads Claude Code's own verbs with accents, hyphens and a trailing apostrophe", () => {
    for (const verb of [
      "Flambéing",
      "Sautéing",
      "Topsy-turvying",
      "Fiddle-faddling",
      "Razzle-dazzling",
      "Beboppin'",
    ]) {
      expect(parseActivity(screen(`✻ ${verb}… (2s)`))?.verb).toBe(verb)
    }
    expect(parseActivity(screen("✻ rm-rf-3… (2s)"))).toBeNull()
    expect(parseActivity(screen("✻ Two words… (2s)"))).toBeNull()
  })

  test("the lowest spinner line wins over one quoted higher up the transcript", () => {
    const text = `✻ Quoted… (9s)\n${screen("✢ Brewing… (5s)")}`
    expect(parseActivity(text)?.verb).toBe("Brewing")
  })
})

describe("its parts", () => {
  test("seconds reads hours, minutes and seconds, and nothing else", () => {
    expect(seconds("1m 11s")).toBe(71)
    expect(seconds("2h 3m")).toBe(7380)
    expect(seconds("4s")).toBe(4)
    expect(seconds("")).toBeNull()
    expect(seconds("soon")).toBeNull()
  })

  test("tokenCount reads a count with its arrow and scale", () => {
    expect(tokenCount("↓ 2.1k tokens")).toBe(2100)
    expect(tokenCount("↑ 980 tokens")).toBe(980)
    expect(tokenCount("1 token")).toBe(1)
    expect(tokenCount("tokens")).toBeNull()
  })

  test("sameActivity compares every field", () => {
    const a = { elapsed: 3, thought: null, tokens: 120, verb: "Formulating" }
    expect(sameActivity(a, { ...a })).toBe(true)
    expect(sameActivity(a, { ...a, elapsed: 4 })).toBe(false)
    expect(sameActivity(null, null)).toBe(true)
    expect(sameActivity(a, null)).toBe(false)
  })
})

// A watcher on a manual clock: tick() fires every running interval once, as one second passing would.
function setup(screens: Record<string, string> = {}) {
  const reads: string[] = []
  const timers = new Set<() => void>()
  const clock = { now: 0 }
  const watch = new ActivityWatch({
    now: () => clock.now,
    every: (_ms, tick) => {
      timers.add(tick)
      return () => timers.delete(tick)
    },
    read: async (surface) => {
      reads.push(surface)
      return screens[surface] ?? ""
    },
  })
  const tick = async () => {
    clock.now += 1_000
    for (const fire of Array.from(timers)) fire()
    await Bun.sleep(0)
  }
  return { clock, reads, screens, tick, timers, watch }
}

const WORKING = "✻ Whisking… (5s · ↓ 300 tokens)"

describe("ActivityWatch", () => {
  test("zero viewers means zero reads, whatever is working", async () => {
    const { reads, tick, watch } = setup({ "surface:1": screen(WORKING) })
    watch.update(new Map([["s1", "surface:1"]]))
    for (let i = 0; i < 5; i++) await tick()
    expect(reads).toEqual([])
    expect(watch.reading).toBe(0)
  })

  test("one viewer on a working session: one read at once, then at most one a second", async () => {
    const { reads, tick, watch } = setup({ "surface:1": screen(WORKING) })
    watch.update(
      new Map([
        ["s1", "surface:1"],
        ["s2", "surface:2"],
      ]),
    )
    const frames: unknown[] = []
    watch.watch("s1", (frame) => frames.push(frame))
    await Bun.sleep(0)
    expect(reads).toEqual(["surface:1"])
    expect(frames).toEqual([
      {
        activity: { elapsed: 5, thought: null, tokens: 300, verb: "Whisking" },
        sessionId: "s1",
        type: "activity",
      },
    ])
    for (let i = 0; i < 3; i++) await tick()
    expect(reads).toEqual(["surface:1", "surface:1", "surface:1", "surface:1"])
    expect(frames).toHaveLength(1)
  })

  test("an idle session with viewers is never read", async () => {
    const { reads, tick, watch } = setup()
    watch.update(new Map())
    watch.watch("s1", () => undefined)
    for (let i = 0; i < 3; i++) await tick()
    expect(reads).toEqual([])
  })

  test("a frame goes only when the reading changes, and only to that session's viewers", async () => {
    const { screens, tick, watch } = setup({ "surface:1": screen(WORKING) })
    watch.update(
      new Map([
        ["s1", "surface:1"],
        ["s2", "surface:2"],
      ]),
    )
    const mine: unknown[] = []
    const other: unknown[] = []
    watch.watch("s1", (frame) => mine.push(frame))
    watch.watch("s2", (frame) => other.push(frame))
    await tick()
    screens["surface:1"] = screen("✻ Whisking… (6s · ↓ 310 tokens)")
    await tick()
    expect(mine).toHaveLength(2)
    expect(other).toEqual([])
  })

  test("going idle stops the reads and sends one clearing frame", async () => {
    const { reads, tick, watch } = setup({ "surface:1": screen(WORKING) })
    watch.update(new Map([["s1", "surface:1"]]))
    const frames: ActivityFrame[] = []
    watch.watch("s1", (frame) => frames.push(frame))
    await tick()
    watch.update(new Map())
    const before = reads.length
    for (let i = 0; i < 3; i++) await tick()
    expect(reads).toHaveLength(before)
    expect(frames.at(-1)).toEqual({ activity: null, sessionId: "s1", type: "activity" })
    expect(frames.filter((frame) => frame.activity === null)).toHaveLength(1)
  })

  test("the last viewer leaving stops the reads", async () => {
    const { reads, tick, timers, watch } = setup({ "surface:1": screen(WORKING) })
    watch.update(new Map([["s1", "surface:1"]]))
    const close = watch.watch("s1", () => undefined)
    await tick()
    close()
    const before = reads.length
    for (let i = 0; i < 3; i++) await tick()
    expect(reads).toHaveLength(before)
    expect(timers.size).toBe(0)
    expect(watch.reading).toBe(0)
  })

  test("a watch sent again and again within the second reads once, and each new viewer gets the reading", async () => {
    const { reads, watch } = setup({ "surface:1": screen(WORKING) })
    watch.update(new Map([["s1", "surface:1"]]))
    const frames: unknown[] = []
    for (let i = 0; i < 21; i++) {
      const close = watch.watch("s1", (frame) => frames.push(frame))
      await Bun.sleep(0)
      close()
    }
    expect(reads).toEqual(["surface:1"])
    expect(frames).toHaveLength(21)
  })

  test("a closer that outlived its watch leaves a newer watch on the same session alone", async () => {
    const { reads, tick, watch } = setup({ "surface:1": screen(WORKING) })
    watch.update(new Map([["s1", "surface:1"]]))
    const stale = watch.watch("s1", () => undefined)
    watch.close()
    watch.watch("s1", () => undefined)
    stale()
    await tick()
    expect(watch.reading).toBe(1)
    expect(reads.length).toBeGreaterThan(0)
  })

  test("a frame carries the parsed fields alone, never the screen's text", async () => {
    const secret = `${screen("✻ Whisking… (5s · ↓ 300 tokens · api_key=sk-live-123)")}\nsk-live-123`
    const { watch } = setup({ "surface:1": secret })
    watch.update(new Map([["s1", "surface:1"]]))
    const frames: unknown[] = []
    watch.watch("s1", (frame) => frames.push(frame))
    await Bun.sleep(0)
    expect(JSON.stringify(frames)).not.toContain("sk-live")
    expect(frames).toEqual([
      {
        activity: { elapsed: 5, thought: null, tokens: 300, verb: "Whisking" },
        sessionId: "s1",
        type: "activity",
      },
    ])
  })
})

describe("parseWatchMessage", () => {
  test("reads the watch message, a session or null", () => {
    expect(parseWatchMessage(JSON.stringify({ sessionId: "s1", type: "watch" }))).toEqual({
      sessionId: "s1",
    })
    expect(parseWatchMessage(JSON.stringify({ sessionId: null, type: "watch" }))).toEqual({
      sessionId: null,
    })
  })

  test("ignores any malformed or other message", () => {
    for (const data of [
      "not json",
      JSON.stringify({ type: "watch" }),
      JSON.stringify({ sessionId: 5, type: "watch" }),
      JSON.stringify({ sessionId: "", type: "watch" }),
      JSON.stringify({ sessionId: "s1", type: "send", text: "hi" }),
      JSON.stringify({ extra: true, sessionId: "s1", type: "watch" }),
      new ArrayBuffer(4),
    ]) {
      expect(parseWatchMessage(data)).toBeNull()
    }
  })
})

const hubWorker = (sessionId: string, light: Worker["light"]): Worker => ({
  cwd: "/repo",
  effort: null,
  eta: null,
  failed: false,
  feed: [],
  lastActiveAt: null,
  lifecycle: "running",
  light,
  model: null,
  name: sessionId,
  questions: [],
  role: "worker",
  sessionId,
  startedAt: null,
  task: null,
  tasks: [],
  title: null,
  updatedAt: null,
  workspace: null,
})

// A hub whose live list is fixed and whose screen reads are counted.
async function hubWith(workers: Worker[]) {
  const reads: string[] = []
  const live: Live = {
    surfaces: new Map(workers.map((w) => [w.sessionId, `surface:${w.sessionId}`])),
    transcripts: new Map(),
    workers,
  }
  const hub = new DashboardHub({
    events: false,
    listLive: async () => live,
    readScreen: async (surface) => {
      reads.push(surface)
      return screen(WORKING)
    },
  })
  const leave = hub.subscribe(() => undefined)
  await Bun.sleep(400)
  return { hub, leave, reads }
}

describe("the hub's activity line", () => {
  test("never reads or answers a session it does not list", async () => {
    const { hub, leave, reads } = await hubWith([hubWorker("s1", "working")])
    const frames: unknown[] = []
    const close = hub.watch("s-unknown", (frame) => frames.push(frame))
    await Bun.sleep(1_200)
    expect(reads).toEqual([])
    expect(frames).toEqual([])
    close()
    leave()
  })

  test("a watch sent the moment the socket opens, before the first list, still gets the activity", async () => {
    const reads: string[] = []
    const live: Live = {
      surfaces: new Map([["s1", "surface:s1"]]),
      transcripts: new Map(),
      workers: [hubWorker("s1", "working")],
    }
    const hub = new DashboardHub({
      events: false,
      listLive: async () => live,
      readScreen: async (surface) => {
        reads.push(surface)
        return screen(WORKING)
      },
    })
    const frames: unknown[] = []
    const leave = hub.subscribe(() => undefined)
    const close = hub.watch("s1", (frame) => frames.push(frame))
    await Bun.sleep(600)
    expect(reads).toEqual(["surface:s1"])
    expect(frames).toHaveLength(1)
    close()
    leave()
  })

  test("reads nothing while no client watches, though a session works", async () => {
    const { leave, reads } = await hubWith([hubWorker("s1", "working")])
    await Bun.sleep(1_200)
    expect(reads).toEqual([])
    leave()
  })

  test("a watched working session is read at once and sends its activity to that client alone", async () => {
    const { hub, leave, reads } = await hubWith([hubWorker("s1", "working")])
    const frames: unknown[] = []
    const close = hub.watch("s1", (frame) => frames.push(frame))
    await Bun.sleep(50)
    expect(reads).toEqual(["surface:s1"])
    expect(frames).toEqual([
      {
        activity: { elapsed: 5, thought: null, tokens: 300, verb: "Whisking" },
        sessionId: "s1",
        type: "activity",
      },
    ])
    close()
    leave()
  })

  test("a watched idle session is never read", async () => {
    const { hub, leave, reads } = await hubWith([hubWorker("s1", "idle")])
    const close = hub.watch("s1", () => undefined)
    await Bun.sleep(1_200)
    expect(reads).toEqual([])
    close()
    leave()
  })
})
