import { appendFile } from "node:fs/promises"
import { join } from "node:path"

import type { Browser, Result, Target } from "./checks"

// The page's own work on a key past this reads as lag: RAIL's budget for handling input, 50ms, so the response is visible within 100ms (web.dev/articles/rail), estimated, since no one measured his own threshold.
export const LAG_LIMIT_MS = 50
// What a live board sends while he types, which once made typing lag: a workers frame a second, the hub's REFRESH_GAP_MS cap, over 20 sessions, measured as the live registry's count on 19 Oct, and about 10 transcript lines a second across them, measured over the live transcripts.
const FRAME_GAP_MS = 1000
const SESSIONS = 20
const LINE_GAP_MS = 100
// Playground works while he types to it, a step a second, estimated: its stream sits past the 400-entry cap, as the live one always does, so each step redraws a long stream.
const OWN_STEP_MS = 1000
const KEYS = "the quick brown fox jumps over the lazy dog"
// A fast typist's pace, about 120 words a minute, estimated: keys pressed back to back would queue behind each other and time the queue rather than a key.
const KEY_GAP_MS = 100
// The Event Timing API reports no event shorter than this, its floor (w3c.github.io/event-timing), so a key it leaves out painted within it.
const TIMED_FROM_MS = 16

// Pure: the median and 95th percentile of each key's figure, each key Event Timing left out counted at its floor.
const spread = (keys: number, figures: number[]) => {
  const all = [...figures, ...Array<number>(Math.max(0, keys - figures.length)).fill(TIMED_FROM_MS)]
  const sorted = all.sort((a, b) => a - b)
  const rank = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!
  return { median: rank(0.5), p95: rank(0.95) }
}

// Pure: the keys were handled fast enough when the 95th percentile of the page's own work on each is within the limit; the whole keydown to paint is reported beside it and judges nothing, since on a loaded machine most of it is the browser waiting to schedule the frame (2 to 12ms of main-thread work against 6 to 147ms to the next frame, measured). Fewer than 90% of the keys reaching the box is a run that measured nothing.
export const typingLagResult = (
  check: string,
  { keys, pages, wholes }: { keys: number; pages: number[]; wholes: number[] },
  typed: number,
): Result => {
  if (keys < typed * 0.9)
    return { check, detail: `only ${keys} of ${typed} keys reached the box`, ok: false }
  const page = spread(keys, pages)
  const whole = spread(keys, wholes)
  return {
    check,
    detail: `page's own work over ${keys} keys while board frames stream: median ${page.median}ms, p95 ${page.p95}ms (limit ${LAG_LIMIT_MS}ms, RAIL, estimated); keydown to paint median ${whole.median}ms, p95 ${whole.p95}ms (not judged)`,
    ok: page.p95 <= LAG_LIMIT_MS,
  }
}

// Runs before the page's own scripts: keeps the dashboard's socket and its newest real workers frame, replays that frame once a second widened to SESSIONS sessions with its working ones moved, as a live board sends it, and times each key typed into the composer by the browser's Event Timing (the measure INP takes) and Long Animation Frames; a task posted after the next animation frame read 155 to 590ms where Event Timing read 24 to 152ms on the same keys (measured), since it waits behind React's queued work too.
export const TYPING_LAG_SCRIPT = `(() => {
  const Native = window.WebSocket
  const sockets = []
  let frame = null
  let replaying = false
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args)
      if (!String(args[0]).includes("/dashboard/ws")) return
      sockets.push(this)
      // Registered before the page's own listeners, so each real workers frame reaches the page widened too: a board that flipped between its own sessions and the widened ones would read as sessions coming and going on every frame, which a live board does not do.
      this.addEventListener("message", (event) => {
        if (replaying) return
        try {
          const data = JSON.parse(String(event.data))
          if (data.type !== "workers") return
          frame = data
          event.stopImmediatePropagation()
          dispatch(this)
        } catch {}
      })
    }
  }
  let timer = null
  let keys = 0
  let timed = []
  let frames = []
  let typing = false
  const widened = () => {
    const workers = frame.workers ?? []
    const copies = workers.filter((w) => w.role !== "dispatcher")
    const extra = []
    for (let i = 0; workers.length + extra.length < ${SESSIONS} && copies.length; i++) {
      const w = copies[i % copies.length]
      extra.push({ ...w, name: w.name + "-copy" + i, sessionId: w.sessionId + "-copy" + i })
    }
    // every working session moves on each frame, as a busy live board's do, so a frame is never the one before it again
    const at = new Date().toISOString()
    const moved = [...workers, ...extra].map((w) => (w.light === "working" ? { ...w, lastActiveAt: at } : w))
    return JSON.stringify({ ...frame, workers: moved })
  }
  const dispatch = (socket) => {
    replaying = true
    try {
      socket.dispatchEvent(new MessageEvent("message", { data: widened() }))
    } finally {
      replaying = false
    }
  }
  const replay = () => {
    if (!frame) return
    for (const socket of sockets) if (socket.readyState === 1) dispatch(socket)
  }
  window.addEventListener(
    "keydown",
    (event) => {
      if (typing && event.target?.id === "composer") keys++
    },
    true,
  )
  new PerformanceObserver((list) => {
    if (!typing) return
    for (const entry of list.getEntries())
      if (entry.name === "keydown" && entry.target?.id === "composer") timed.push(entry)
  }).observe({ durationThreshold: ${TIMED_FROM_MS}, type: "event" })
  new PerformanceObserver((list) => {
    if (typing) frames.push(...list.getEntries())
  }).observe({ type: "long-animation-frame" })
  // The page's own work on a key: the wait for the main thread before its handlers run, the handlers, then the main thread's render of the frame that paints it, which Long Animation Frames reports only for a frame over 50ms, so a shorter one counts as none.
  const pageWork = (key) => {
    const end = key.startTime + key.duration
    const frame = frames.find((f) => f.renderStart >= key.processingEnd && f.renderStart <= end)
    return key.processingEnd - key.startTime + (frame ? frame.startTime + frame.duration - frame.renderStart : 0)
  }
  window.__typingLag = {
    board: () => ({
      names: frame?.dispatchers ?? [],
      sessions: (frame?.workers ?? []).map(({ name, role, sessionId }) => ({ name, role, sessionId })),
    }),
    start: () => {
      keys = 0
      timed = []
      frames = []
      typing = true
      timer = setInterval(replay, ${FRAME_GAP_MS})
      return Boolean(frame)
    },
    stop: () => {
      typing = false
      clearInterval(timer)
      return { keys, pages: timed.map((key) => Math.round(pageWork(key))), wholes: timed.map((key) => Math.round(key.duration)) }
    },
  }
})()`

// One long turn past the stream's 400-entry cap, each tool call answered, as a live session's are: an unanswered call spins, and hundreds of spinners would time the fixture rather than the dashboard.
const PAST_CALLS = 400

const finishedTurn = (tag: string, base: number, of: { cwd: string; sessionId: string }) => {
  const line = (at: number, type: string, message: object, origin?: object) =>
    JSON.stringify({
      cwd: of.cwd,
      message,
      ...(origin ? { origin } : {}),
      sessionId: of.sessionId,
      timestamp: new Date(at).toISOString(),
      type,
      uuid: crypto.randomUUID(),
    })
  return [
    line(base, "user", { content: "An earlier question.", role: "user" }, { kind: "human" }),
    ...Array.from({ length: PAST_CALLS }, (_, n) => {
      const id = `toolu_typing_${tag}_${n}`
      return [
        line(base + 1 + 2 * n, "assistant", {
          content: [{ id, input: { command: `echo ${tag} ${n}` }, name: "Bash", type: "tool_use" }],
          model: "claude-opus-5-5",
          role: "assistant",
        }),
        line(base + 2 + 2 * n, "user", {
          content: [{ content: `${tag} ${n}`, tool_use_id: id, type: "tool_result" }],
          role: "user",
        }),
      ]
    }).flat(),
  ]
}

type Session = { name: string; role: string; sessionId: string }
type Board = { names: string[]; sessions: Session[] }

// A session's transcript in the fixture's scratch copy, so its lines reach every board as entries frames, as a working session's do: Playground's own, or a peer's.
const transcriptOf = async (fixture: string, ids: Set<string>): Promise<string | null> => {
  for await (const name of new Bun.Glob("claude/projects/*/*.jsonl").scan(fixture)) {
    if (
      ids.has(
        name
          .split("/")
          .pop()!
          .replace(/\.jsonl$/, ""),
      )
    )
      return join(fixture, name)
  }
  return null
}

// Playground's own session is the primary dispatcher, the first the board names, whose chat /dashboard opens; a peer is any session that is not a dispatcher.
const idsOf = ({ names, sessions }: Board, own: boolean) =>
  new Set(
    sessions
      .filter((s) => (own ? s.name === names[0] : s.role !== "dispatcher"))
      .map((s) => s.sessionId),
  )

const sessionOf = (path: string) =>
  path
    .split("/")
    .pop()!
    .replace(/\.jsonl$/, "")

// An assistant line in the session's transcript; one that ends its turn carries stop_reason end_turn, as Claude Code records a turn's last step.
const step = (path: string, text: string, ends = false) =>
  appendFile(
    path,
    `${JSON.stringify({
      cwd: "/fixture/dispatcher",
      message: {
        content: [{ text, type: "text" }],
        model: "claude-opus-5-5",
        role: "assistant",
        ...(ends ? { stop_reason: "end_turn" } : {}),
      },
      sessionId: sessionOf(path),
      timestamp: new Date().toISOString(),
      type: "assistant",
      uuid: crypto.randomUUID(),
    })}\n`,
  )

// At 1280x800 on /dashboard: with Playground's stream past its cap and growing a step a second, board frames replayed a second apart and a peer's transcript growing ten lines a second, it types KEYS into Playground's box one key at a time and times each, then empties the box, sending nothing, and ends both sessions' turns, so neither reads as working after it; the long turn's lines stay in the fixture's scratch copy until the stack restarts.
export const typingLag = async (
  browser: Browser,
  { web }: Target,
  fixture: string,
): Promise<Result> => {
  const check = "typing-lag"
  await browser.viewport({ height: 800, width: 1280 })
  await browser.visit(`${web}/dashboard`)
  await browser.run("wait", "#composer")
  const board = await browser.eval<Board>("window.__typingLag.board()")
  const own = await transcriptOf(fixture, idsOf(board, true))
  const peer = await transcriptOf(fixture, idsOf(board, false))
  if (!own || !peer)
    return { check, detail: "no dispatcher and peer transcripts in the fixture", ok: false }
  const tag = crypto.randomUUID().slice(0, 8)
  await appendFile(
    own,
    `${finishedTurn(tag, Date.now(), { cwd: "/fixture/dispatcher", sessionId: sessionOf(own) }).join("\n")}\n`,
  )
  let n = 0
  const writing = new Set<Promise<void>>()
  const write = (path: string) => {
    const done = step(path, `verify typing-lag: step ${n++}`)
    writing.add(done)
    const settle = () => writing.delete(done)
    void done.then(settle, settle)
  }
  const lines = setInterval(() => write(peer), LINE_GAP_MS)
  const steps = setInterval(() => write(own), OWN_STEP_MS)
  try {
    await browser.run("click", "#composer")
    if (!(await browser.eval<boolean>("window.__typingLag.start()")))
      return { check, detail: "the page never received a workers frame to replay", ok: false }
    await browser.run("wait", "3000")
    // press, not keyboard type: agent-browser's type lands the text with no keydown, so nothing would be timed.
    for (const key of KEYS) {
      await browser.run("press", key === " " ? "Space" : key)
      await browser.run("wait", String(KEY_GAP_MS))
    }
    // Event Timing reports a key once its paint lands, so the last keys' entries arrive after their frames
    await browser.run("wait", "1000")
    return typingLagResult(
      check,
      await browser.eval<{ keys: number; pages: number[]; wholes: number[] }>(
        "window.__typingLag.stop()",
      ),
      KEYS.length,
    )
  } finally {
    clearInterval(lines)
    clearInterval(steps)
    // each cleanup runs whatever another throws, and every step still being written lands before the end lines, so each is its transcript's last
    await Promise.allSettled([
      browser.run("fill", "#composer", ""),
      Promise.allSettled(writing).then(() =>
        Promise.all([
          step(own, "That is the whole reply.", true),
          step(peer, "That is the whole reply.", true),
        ]),
      ),
    ])
  }
}
