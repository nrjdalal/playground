import { appendFile, rename } from "node:fs/promises"
import { join } from "node:path"

import { chatLabel } from "../../../../web/next/src/lib/agent-label"
import { type Browser, dispatchersOf, type Result, type Target, type Viewport } from "./checks"

// Where a sent message's row sits in its stream's scroll box, in pixels from the box's top: its own top, and the bottom of the row before it (null when it is the first). Null when the row is not on the page.
export type Placement = { previousBottom: number | null; top: number } | null

// How far a row may sit from where it should and still be there: a pixel for rounding.
const AT_TOP = 1
// Where an anchored row's content rests, in pixels below the stream's top: the scroller's 12px margin, for his message as for a reply's first line.
const ANCHOR = 12

// Pure: a send holds the top as langsdk's does when its row rests at the anchor and nothing of the row before it shows above it.
export const sendTopResult = (check: string, placement: Placement): Result => {
  if (!placement) return { check, detail: "the sent message is not in the stream", ok: false }
  const { previousBottom, top } = placement
  if (Math.abs(top - ANCHOR) > AT_TOP) {
    return {
      check,
      detail: `the sent message sits ${top}px from the top, not ${ANCHOR}px`,
      ok: false,
    }
  }
  if (previousBottom !== null && previousBottom > 0) {
    return {
      check,
      detail: `${previousBottom}px of the step before it shows above the sent message`,
      ok: false,
    }
  }
  return { check, detail: "the sent message holds the top, nothing above it", ok: true }
}

// Pure: after his own scroll away from a sent message, the stream leaves the view where he put it, so a row that settles (Sending to Delivered) never pulls it back.
export const scrolledResult = (check: string, before: Placement, after: Placement): Result => {
  if (!before || !after)
    return { check, detail: "the sent message is not in the stream", ok: false }
  if (Math.abs(after.top - before.top) > AT_TOP) {
    return {
      check,
      detail: `the view moved by itself after his scroll: the message went from ${before.top}px to ${after.top}px`,
      ok: false,
    }
  }
  if (Math.abs(after.top - ANCHOR) <= AT_TOP) {
    return { check, detail: "his scroll did not move the view off the message", ok: false }
  }
  return { check, detail: `the view stayed where he scrolled it (${after.top}px)`, ok: true }
}

// langsdk's room under its last line (its pb-9, the stream's ROOM_UNDER): once a turn outgrows the screen, this much blank shows below its last row, no more and no less.
const ROOM = 36

// The space under a stream's last row, in pixels, and whether the turn from his message to that row is taller than the screen.
export type Blank = { blank: number; past: boolean } | null

// Pure: a turn that has grown past the screen, step by step, leaves only langsdk's room below its last row, so the view never scrolls into blank space while it streams. Null when the stream or his message is not on the page.
export const blankResult = (check: string, measured: Blank): Result => {
  if (!measured)
    return { check, detail: "the stream or the sent message is not on the page", ok: false }
  const { blank, past } = measured
  if (!past) return { check, detail: "the turn never grew past the screen", ok: false }
  if (Math.abs(blank - ROOM) > AT_TOP) {
    return {
      check,
      detail: `${blank}px of space under the last row, not ${ROOM}px`,
      ok: false,
    }
  }
  return { check, detail: `${blank}px under the last row, langsdk's room`, ok: true }
}

// Pure: his wheel down after his send, then a row landing, leaves the view where he put it: the view's place (viewAtScript) never drops, so the view is never pulled up against his scroll. Null when the stream is not on the page.
export const heldResult = (check: string, before: number | null, after: number | null): Result => {
  if (before === null || after === null)
    return { check, detail: "the stream is not on the page", ok: false }
  if (after < before - AT_TOP) {
    return {
      check,
      detail: `the view was pulled up ${before - after}px after his scroll`,
      ok: false,
    }
  }
  return { check, detail: "the view held where his scroll left it", ok: true }
}

// Pure: once his Reading send rests at the top, it stays there frame by frame until the turn ends, a peer message and tool rows landing included, so nothing goes off the screen and comes back. tops is his row's top per animation frame, null before it lands.
export const frameResult = (check: string, tops: (number | null)[]): Result => {
  const rest = tops.findIndex((top) => top !== null && Math.abs(top - ANCHOR) <= AT_TOP + 1)
  if (rest < 0) return { check, detail: "the sent message never rested at the top", ok: false }
  for (let i = rest + 1; i < tops.length; i += 1) {
    const before = tops[i - 1]
    const after = tops[i]
    if (before === null || before === undefined || after === null || after === undefined) continue
    if (Math.abs(after - before) > 2) {
      return {
        check,
        detail: `the sent message moved ${after - before}px in one frame, ${i - rest} frames after it rested`,
        ok: false,
      }
    }
  }
  return {
    check,
    detail: `the sent message held its rest over ${tops.length - rest} frames`,
    ok: true,
  }
}

// Pure: while a turn grows with no hand on the view, the view's place never drops more than 2px in a frame, so nothing pulls the view up and back. tops is the view's place past his message (viewAtScript) per animation frame.
export const steadyResult = (check: string, tops: number[]): Result => {
  if (tops.length < 2) {
    return { check, detail: `${tops.length} frames logged, too few to judge`, ok: false }
  }
  for (let i = 1; i < tops.length; i += 1) {
    const before = tops[i - 1]
    const after = tops[i]
    if (before === undefined || after === undefined) continue
    if (after < before - 2) {
      return { check, detail: `the view moved up ${before - after}px in one frame`, ok: false }
    }
  }
  return { check, detail: `the view held or moved down over ${tops.length} frames`, ok: true }
}

// Pure: a send whose message stays on screen shows Scroll to end in no frame. frames holds, per animation frame, whether the button showed; null or empty when the log never ran.
export const noFlashResult = (check: string, frames: boolean[] | null): Result => {
  if (!frames?.length) return { check, detail: "the frame log never ran", ok: false }
  const shown = frames.filter(Boolean).length
  return shown === 0
    ? { check, detail: `Scroll to end showed in none of ${frames.length} frames`, ok: true }
    : { check, detail: `Scroll to end showed in ${shown} of ${frames.length} frames`, ok: false }
}

// Pure: while Watching, the view ends at the stream's end once it has caught up. gap is the space left below the view (scrollHeight less the view's bottom); null when the stream is not on the page.
export const atEndResult = (check: string, gap: number | null): Result => {
  if (gap === null) return { check, detail: "the stream is not on the page", ok: false }
  if (gap > 2) return { check, detail: `the view sits ${gap}px above the end`, ok: false }
  return { check, detail: "the view followed the end", ok: true }
}

// Pure: after his scroll up just after a send, nothing moves the view down on its own. before and after are the view's place past his message (viewAtScript), which grows as the view moves down.
export const notDownResult = (
  check: string,
  before: number | null,
  after: number | null,
): Result => {
  if (before === null || after === null)
    return { check, detail: "the sent message is not in the stream", ok: false }
  if (after > before + AT_TOP) {
    return {
      check,
      detail: `the view moved down ${after - before}px after his scroll up`,
      ok: false,
    }
  }
  return { check, detail: "the view stayed where his scroll up left it", ok: true }
}

// Pure: the stream's scroll box starts at the page's very top edge, so steps scroll off it with no padding or border above. Its top is in pixels from the window's top, null when the box is not on the page.
export const edgeResult = (check: string, top: number | null): Result => {
  if (top === null) return { check, detail: "the stream is not on the page", ok: false }
  if (Math.abs(top) > AT_TOP) {
    return { check, detail: `the stream starts ${top}px below the top edge`, ok: false }
  }
  return { check, detail: "the stream starts at the top edge", ok: true }
}

// Where its content starts: the box's top plus any padding or border of its own, which would inset the steps just the same.
const EDGE = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); if (!box) return null; const style = getComputedStyle(box); return Math.round(box.getBoundingClientRect().top + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth)) })()`

const placementScript = (text: string): string =>
  `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); if (!box) return null; const rows = [...box.querySelectorAll("[data-slot=message-scroller-item]")]; const at = rows.findLastIndex((row) => row.textContent.includes(${JSON.stringify(text)})); if (at < 0) return null; const top = box.getBoundingClientRect().top; const previous = at > 0 ? rows[at - 1].getBoundingClientRect().bottom - top : null; return { previousBottom: previous === null ? null : Math.round(previous), top: Math.round((rows[at].firstElementChild ?? rows[at]).getBoundingClientRect().top - top) } })()`

// The scrollable space under the stream's last row, how far past it the view can scroll, and whether the turn from the row holding text to the last row is taller than the box.
const blankScript = (text: string): string =>
  `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); if (!box) return null; const rows = [...box.querySelectorAll("[data-slot=message-scroller-item]")]; const sent = rows.findLast((row) => row.textContent.includes(${JSON.stringify(text)})); const last = rows.at(-1); if (!sent || !last) return null; const bottom = last.getBoundingClientRect().bottom; return { blank: Math.round(box.scrollHeight - (bottom - box.getBoundingClientRect().top + box.scrollTop)), past: bottom - sent.getBoundingClientRect().top > box.clientHeight } })()`

// A per-frame log of the top of his row holding text, its content as placementScript reads it, kept on the page until FRAME_LOG_STOP reads it.
const frameLogStart = (text: string): string =>
  `(() => { const log = []; window.__sendTopFrames = log; window.__sendTopStop = false; const tick = () => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); if (box) { const row = [...box.querySelectorAll("[data-slot=message-scroller-item]")].findLast((row) => row.textContent.includes(${JSON.stringify(text)})); log.push(row ? Math.round((row.firstElementChild ?? row).getBoundingClientRect().top - box.getBoundingClientRect().top) : null) } if (!window.__sendTopStop) requestAnimationFrame(tick) }; requestAnimationFrame(tick); return true })()`
const FRAME_LOG_STOP = `(() => { window.__sendTopStop = true; return window.__sendTopFrames ?? null })()`

const shownScript = (text: string): string =>
  `[...document.querySelectorAll("[data-slot=message-scroller-item]")].some((row) => row.textContent.includes(${JSON.stringify(text)}))`

// The tool row whose call reads text: open clicks it open and says whether it was found; read says whether it is open now.
const toolToggleScript = (text: string, act: "open" | "read"): string =>
  `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); const row = box ? [...box.querySelectorAll("[data-slot=trace-collapsible]")].findLast((r) => r.textContent.includes(${JSON.stringify(text)})) : null; const button = row?.querySelector("button[aria-expanded]"); if (!button) return false; if (${JSON.stringify(act)} === "open" && button.getAttribute("aria-expanded") !== "true") button.click(); return ${JSON.stringify(act)} === "open" || button.getAttribute("aria-expanded") === "true" })()`

const deliveredScript = (text: string): string =>
  `(() => { const rows = [...document.querySelectorAll("[data-slot=message-scroller-item]")].filter((row) => row.textContent.includes(${JSON.stringify(text)})); return rows.some((row) => row.textContent.includes("Delivered")) })()`

// Load older, the stream's one way back through the steps the 400-entry window dropped: a click fetches the database's page before the oldest step shown.
const LOAD_OLDER = `(() => { const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Load older")); if (!button || button.disabled) return false; button.click(); return true })()`

// Load older reads the database, not the transcript file: one plain ingest fills this worktree's own database from the fixture's scratch copy first.
const ingestFixture = (): boolean =>
  Bun.spawnSync(["bun", "run", "ingest"], {
    cwd: join(import.meta.dir, "../../../.."),
    stderr: "ignore",
    stdout: "ignore",
  }).exitCode === 0

const DELIVERY_WAIT_MS = 10_000
const POLL_MS = 250
// Long enough for the scroller's re-anchoring on a resize to have run, had it wanted to move the view.
const SETTLE_MS = 1500
// The stream has settled once its height and row count hold this long, so no row still landing races a scroll.
const STILL_MS = 1000
const STREAM_SIZE = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); return box ? \`\${box.scrollHeight}:\${box.querySelectorAll("[data-slot=message-scroller-item]").length}\` : null })()`
// A mode check after his scroll to the end reads no sooner than SETTLE_MS, so a late flip back to Reading still shows, and once the view has held still this long, longer than any gap between its frames, so a view still moving is never read as one that stopped short.
const VIEW_TOP = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); return box ? String(Math.round(box.scrollTop)) : null })()`
const REST_MS = 500
// The session starts answering before his message reads Delivered, as a busy one does.
const BUSY_MS = 1500
// A send's glide to the top runs on the frames after its row lands; langsdk's smooth one takes about 450ms, so this leaves room under load.
const JUMP_MS = 800
// Long enough for the scroll his wheel made to have landed before it is read, a smooth one included.
const WHEEL_MS = 600
// The reply arrives as langsdk's stream does, a step at a time, each long enough to wrap, so it overflows the screen.
const REPLY_STEPS = 6
const REPLY_STEP_MS = 400
const REPLY_TEXT =
  "A step of the fixture's reply, long enough to wrap onto a second line at a phone's width and to push the reply past the bottom of the screen once a few of them have landed."

// His wheel, as the page gets it: the wheel event the scroller reads as his intent, then the scroll it makes. agent-browser's own mouse wheel reaches no element in a headless browser. Each of his scrolls here is instant, since a page's scroll-smooth glides a script's scroll but never his hand's.
const SCROLL_UP = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); box.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -200 })); box.scrollBy({ behavior: "instant", top: -200 }); return box.scrollTop })()`

// A fixture session's transcript: the file under the fixture's projects folder that holds the line his message was typed as, waited for up to TRANSCRIPT_WAIT_MS, since a send reads Delivered before its line may reach the fixture's copy.
const TRANSCRIPT_WAIT_MS = 5000
const transcriptOf = async (
  fixture: string,
  text: string,
): Promise<{ cwd: string; path: string; sessionId: string } | null> => {
  const until = Date.now() + TRANSCRIPT_WAIT_MS
  for (;;) {
    for await (const name of new Bun.Glob("claude/projects/*/*.jsonl").scan(fixture)) {
      const path = join(fixture, name)
      const line = (await Bun.file(path).text()).split("\n").findLast((l) => l.includes(text))
      if (!line) continue
      const { cwd, sessionId } = JSON.parse(line) as { cwd: string; sessionId: string }
      return { cwd, path, sessionId }
    }
    if (Date.now() > until) return null
    await Bun.sleep(200)
  }
}

// The session answers, as Claude Code records it: one assistant line per step, appended to its transcript in the fixture's scratch copy.
const reply = async (browser: Browser, fixture: string, text: string): Promise<boolean> => {
  const transcript = await transcriptOf(fixture, text)
  if (!transcript) return false
  for (let step = 0; step < REPLY_STEPS; step += 1) {
    const line = {
      cwd: transcript.cwd,
      message: {
        content: [{ text: REPLY_TEXT, type: "text" }],
        model: "claude-opus-5-5",
        role: "assistant",
      },
      sessionId: transcript.sessionId,
      timestamp: new Date().toISOString(),
      type: "assistant",
      uuid: crypto.randomUUID(),
    }
    await appendFile(transcript.path, `${JSON.stringify(line)}\n`)
    await browser.run("wait", String(REPLY_STEP_MS))
  }
  return true
}

// The stream keeps a session's newest 400 entries (ENTRY_LIMIT in web/next/src/lib/dashboard.ts), and Playground's own session is always past it, so each new step drops an entry above the view, shrinking or removing the rows there; the checks run past it from his first send on.
const PAST_LIMIT = 420

// One of the earlier turn's tool calls, tagged with this run's own tag, so a later viewport's run never takes the last run's for its own.
const earlierStep = (tag: string, n: number): string => `echo earlier step ${tag} ${n}`

// The lines of the earlier exchange, pure so the test can hold them: one question a person asked (a human origin, so the parser shows it as a prompt) and one turn of tool calls long enough to take its stream past the limit, each line stamped its own millisecond from base, so their order never rests on the sort being stable.
export const earlierTurnLines = (
  tag: string,
  base: number,
  of: { cwd: string; sessionId: string },
): string[] => {
  const line = (at: number, message: object, type: string, origin: object | null = null) =>
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
    line(base, { content: "An earlier question.", role: "user" }, "user", { kind: "human" }),
    ...Array.from({ length: PAST_LIMIT }, (_, n) =>
      line(
        base + 1 + n,
        {
          content: [
            {
              id: `toolu_earlier_${crypto.randomUUID()}`,
              input: { command: earlierStep(tag, n) },
              name: "Bash",
              type: "tool_use",
            },
          ],
          model: "claude-opus-5-5",
          role: "assistant",
        },
        "assistant",
      ),
    ),
  ]
}

// An earlier exchange in the session, written at once, so the row at the stream's top is part of a turn, redrawn one step shorter at each new step rather than dropped whole, as on Playground's own long turns.
const pastLimit = async (fixture: string, text: string, tag: string): Promise<boolean> => {
  const transcript = await transcriptOf(fixture, text)
  if (!transcript) return false
  await appendFile(transcript.path, `${earlierTurnLines(tag, Date.now(), transcript).join("\n")}\n`)
  return true
}

// A turn that grows by tool rows rather than words, as a session at work does: one tool call a line, each on its own row in the turn.
const TOOL_STEPS = 30

const toolRows = async (
  browser: Browser,
  fixture: string,
  text: string,
  steps: number,
): Promise<boolean> => {
  const transcript = await transcriptOf(fixture, text)
  if (!transcript) return false
  for (let step = 0; step < steps; step += 1) {
    const id = `toolu_verify_${crypto.randomUUID()}`
    const line = {
      cwd: transcript.cwd,
      message: {
        content: [{ id, input: { command: `echo step ${step}` }, name: "Bash", type: "tool_use" }],
        model: "claude-opus-5-5",
        role: "assistant",
      },
      sessionId: transcript.sessionId,
      timestamp: new Date().toISOString(),
      type: "assistant",
      uuid: crypto.randomUUID(),
    }
    await appendFile(transcript.path, `${JSON.stringify(line)}\n`)
    await browser.run("wait", String(REPLY_STEP_MS))
  }
  return true
}

const GAP_BELOW = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); return box ? Math.round(box.scrollHeight - box.scrollTop - box.clientHeight) : null })()`
// Scroll to end on the chat's Checkpoint bar shows while its slot is not inert.
const LATEST_SHOWN = `(() => { const button = document.querySelector("[data-slot=chat-checkpoint] [aria-label='Scroll to end']"); return Boolean(button && !button.closest("[inert]")) })`
// A click on Scroll to end, only while it shows.
const TO_LATEST = `(() => { if (!${LATEST_SHOWN}()) return false; document.querySelector("[data-slot=chat-checkpoint] [aria-label='Scroll to end']").click(); return true })()`
// A per-frame log of whether Scroll to end shows, kept on the page until LATEST_LOG_STOP reads it.
const LATEST_LOG_START = `(() => { const shown = ${LATEST_SHOWN}; const log = []; window.__sendTopLatest = log; window.__sendTopLatestStop = false; const tick = () => { log.push(shown()); if (!window.__sendTopLatestStop) requestAnimationFrame(tick) }; requestAnimationFrame(tick); return true })()`
const LATEST_LOG_STOP = `(() => { window.__sendTopLatestStop = true; return window.__sendTopLatest ?? null })()`

// How far the view has scrolled past the row holding text: that row's distance above the stream's top, which grows as the view moves down. Unlike scrollTop, rows dropped above it (the stream keeps its newest entries) do not change it, since the view keeps its place among the rows it shows.
const viewAtScript = (text: string): string =>
  `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); if (!box) return null; const row = [...box.querySelectorAll("[data-slot=message-scroller-item]")].findLast((row) => row.textContent.includes(${JSON.stringify(text)})); return row ? Math.round(box.getBoundingClientRect().top - row.getBoundingClientRect().top) : null })()`

// A drag of the scrollbar upward, longer than his hand's window: a press on the viewport itself (where its scrollbar is), a scroll with no wheel, then after YANK_DRAG_MS a second one; DRAG_END lets go. The scroller reads no wheel, touch or key from a drag.
const DRAG_START = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); box.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); box.scrollBy({ behavior: "instant", top: -100 }); return box.scrollTop })()`
const DRAG_MORE = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); box.scrollBy({ behavior: "instant", top: -100 }); return box.scrollTop })()`
const DRAG_END = `(() => { window.dispatchEvent(new PointerEvent("pointerup")); return true })()`
const YANK_DRAG_MS = 700
// His scroll up comes this soon after the send, inside the send's own glide; then the view is watched this long.
const YANK_AFTER_MS = 150
const YANK_WATCH_MS = 3000

// His wheel down to the very end, as he scrolls back to the latest.
const TO_THE_END = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); box.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 5000 })); box.scrollBy({ behavior: "instant", top: box.scrollHeight }); return box.scrollTop })()`

// A per-frame log of the view's place past the row holding text (viewAtScript), kept on the page until SCROLL_LOG_STOP reads it.
const scrollLogStart = (text: string): string =>
  `(() => { const log = []; window.__sendTopScrolls = log; window.__sendTopScrollStop = false; const tick = () => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); const row = box ? [...box.querySelectorAll("[data-slot=message-scroller-item]")].findLast((row) => row.textContent.includes(${JSON.stringify(text)})) : null; if (box && row) log.push(Math.round(box.getBoundingClientRect().top - row.getBoundingClientRect().top)); if (!window.__sendTopScrollStop) requestAnimationFrame(tick) }; requestAnimationFrame(tick); return true })()`
const SCROLL_LOG_STOP = `(() => { window.__sendTopScrollStop = true; return window.__sendTopScrolls ?? null })()`

// His wheel downward while a turn streams: the intent the scroller reads, then the scroll it makes.
const SCROLL_DOWN = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); box.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 120 })); box.scrollBy({ behavior: "instant", top: 120 }); return box.scrollTop })()`

const PEER_BODY =
  "A report from another session, which lands in the chat as a step, not as his send."

// Another session's message landing in the chat, as Claude Code records a cross-session message: a user line whose origin names its sender.
const peerLine = async (fixture: string, text: string): Promise<boolean> => {
  const transcript = await transcriptOf(fixture, text)
  if (!transcript) return false
  const body = PEER_BODY
  const line = {
    cwd: transcript.cwd,
    message: {
      content: `<cross-session-message from="uds:/fixture/sockets/builder.sock" from-name="builder">\n${body}\n</cross-session-message>`,
      role: "user",
    },
    origin: { body, from: "uds:/fixture/sockets/builder.sock", kind: "peer", name: "builder" },
    sessionId: transcript.sessionId,
    timestamp: new Date().toISOString(),
    type: "user",
    uuid: crypto.randomUUID(),
  }
  await appendFile(transcript.path, `${JSON.stringify(line)}\n`)
  return true
}

// How far the status line's middle sits below the middle of the stream's view, null when it is not on the page.
const STATUS_FROM_MIDDLE = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); const line = box?.querySelector("[data-slot=activity-line]"); if (!line) return null; const view = box.getBoundingClientRect(); const at = line.getBoundingClientRect(); return Math.round(at.top + at.height / 2 - (view.top + view.height / 2)) })()`

// Long enough for the board to read the session's new light and the stream to redraw.
const LIGHT_MS = 3000

// The session's light, as cmux reports it, set in the fixture's scratch copy, which the dashboard reads on every refresh.
const setLifecycle = async (fixture: string, text: string, lifecycle: string): Promise<boolean> => {
  const transcript = await transcriptOf(fixture, text)
  if (!transcript) return false
  const path = join(fixture, "cmux.json")
  const state = (await Bun.file(path).json()) as {
    sessions?: { agent_lifecycle?: string; session_id?: string }[]
  }
  const session = state.sessions?.find((s) => s.session_id === transcript.sessionId)
  if (!session) return false
  session.agent_lifecycle = lifecycle
  await Bun.write(`${path}.tmp`, JSON.stringify(state, null, 2))
  await rename(`${path}.tmp`, path)
  return true
}

// Focus on the first button in view in the stream (a tool row's header he clicked, one he can see), without scrolling to it, so the next key is pressed there rather than on the stream.
const FOCUS_ROW_BUTTON = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); const top = box.getBoundingClientRect().top; const button = [...box.querySelectorAll("[data-slot=message-scroller-item] button")].find((b) => b.getBoundingClientRect().top >= top); if (!button) return false; button.focus({ preventScroll: true }); return document.activeElement === button })()`

const place = (browser: Browser, text: string) => browser.eval<Placement>(placementScript(text))
// The top of his row holding text, for settled to wait on: a glide can start late on a slow frame, so a fixed wait can read it mid-way.
const topScript = (text: string): string =>
  `(() => { const at = ${placementScript(text)}; return at ? String(at.top) : null })()`

// The chat's mode on its Checkpoint bar: "watching" or "reading", null while the bar is not on the page; a click on its toggle; and the words of its face in view, which say how far Watching is behind or what Reading has below.
const MODE = `(() => document.querySelector("[data-slot=chat-mode]")?.dataset.mode ?? null)()`
// Where the view sits and the room held under the last row past the content's own ROOM, for a mode check's failure.
const VIEW_AT = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); const content = box?.querySelector("[data-slot=message-scroller-content]"); if (!box || !content) return null; const padding = Number.parseFloat(content.style.paddingBottom); const held = Number.isNaN(padding) ? 0 : Math.round(padding - ${ROOM}); return "scrollTop " + Math.round(box.scrollTop) + " of scrollHeight " + box.scrollHeight + ", clientHeight " + box.clientHeight + ", " + held + "px held" })()`
// What happened between his scroll to the end and a mode check's read, for its failure: each wheel and scroll with where the view sat, and each height change of the view, its direct children and its last row, each by ms since the trace began.
const END_TRACE_START = `(() => { const box = document.querySelector("[data-slot=message-scroller-viewport]"); if (!box) return false; const t0 = performance.now(); const ms = () => Math.round(performance.now() - t0); const mode = () => document.querySelector("[data-slot=chat-mode]")?.dataset.mode ?? "none"; const log = []; const onScroll = () => log.push(ms() + "ms scroll " + Math.round(box.scrollTop) + "+" + box.clientHeight + " of " + box.scrollHeight + " " + mode()); const onWheel = (e) => log.push(ms() + "ms wheel " + e.deltaY + " " + mode()); box.addEventListener("scroll", onScroll); box.addEventListener("wheel", onWheel); const content = box.querySelector("[data-slot=message-scroller-content]"); const watched = [box, ...box.children, content?.lastElementChild].filter(Boolean); const heights = new Map(); const sizes = new ResizeObserver((entries) => { for (const entry of entries) { const height = Math.round(entry.target.getBoundingClientRect().height); const was = heights.get(entry.target); heights.set(entry.target, height); if (was !== undefined && was !== height) log.push(ms() + "ms " + (entry.target === box ? "view" : entry.target.dataset.slot || entry.target.tagName.toLowerCase()) + " " + was + "->" + height) } }); watched.forEach((el) => sizes.observe(el)); window.__endTrace = () => { box.removeEventListener("scroll", onScroll); box.removeEventListener("wheel", onWheel); sizes.disconnect(); return log.join("; ") || "no scroll or resize" }; return true })()`
const END_TRACE_STOP = `(() => window.__endTrace?.() ?? null)()`
const MODE_CLICK = `(() => { const toggle = document.querySelector("[data-slot=chat-mode]"); if (!toggle) return false; toggle.click(); return true })()`
const MODE_WORDS = `(() => { const face = document.querySelector("[data-slot=chat-mode] [data-shown=true]"); return face ? face.textContent.replace(/\\s+/g, " ").trim() : null })()`

// A mode read is fair only once the view came to rest; one that never did fails, whatever the mode read.
export const atRest = (rested: boolean, result: Result): Result =>
  rested
    ? result
    : { ...result, detail: `the view never came to rest; ${result.detail}`, ok: false }

// Pure: the chat reads the mode it should; view, where the view sat at the read (VIEW_AT), goes with a failure so it names its own cause.
export const modeResult = (
  check: string,
  mode: string | null,
  want: "reading" | "watching",
  view?: string | null,
): Result =>
  mode === want
    ? { check, detail: `the chat reads ${want}`, ok: true }
    : {
        check,
        detail:
          mode === null
            ? "the chat's Checkpoint bar is not on the page"
            : `the chat reads ${mode}${view ? `, ${view}` : ""}`,
        ok: false,
      }

// Pure: Watching at reading speed says it fell behind during a long turn, then catches up to read Watching alone. words is each change of the toggle's words.
export const behindResult = (check: string, words: (string | null)[]): Result => {
  const behind = words.findIndex((w) => w?.includes("behind"))
  if (behind < 0) return { check, detail: "it never read behind during the long turn", ok: false }
  return words.slice(behind).includes("Watching")
    ? { check, detail: `it read ${JSON.stringify(words[behind])}, then Watching`, ok: true }
    : { check, detail: `it read ${JSON.stringify(words.at(-1))} and never caught up`, ok: false }
}

// Pure: Reading counts what landed below him, as "Reading · 3 new".
export const countResult = (check: string, words: string | null): Result =>
  words && /^Reading\s*·\s*\d+/.test(words)
    ? { check, detail: `it reads ${JSON.stringify(words)}`, ok: true }
    : { check, detail: `it reads ${JSON.stringify(words)}, with no count`, ok: false }

// Waits until what script reads, by default the stream's height and row count, holds for holdMs, up to DELIVERY_WAIT_MS; false when it never does.
const settled = async (
  browser: Browser,
  script = STREAM_SIZE,
  holdMs = STILL_MS,
): Promise<boolean> => {
  let last: string | null = null
  let still = 0
  for (let waited = 0; waited < DELIVERY_WAIT_MS; waited += POLL_MS) {
    const size = await browser.eval<string | null>(script)
    still = size !== null && size === last ? still + POLL_MS : 0
    if (still >= holdMs) return true
    last = size
    await browser.run("wait", String(POLL_MS))
  }
  return false
}

// Puts the chat in a mode by its toggle.
const toMode = async (browser: Browser, mode: "reading" | "watching"): Promise<void> => {
  if ((await browser.eval<string | null>(MODE)) !== mode) await browser.eval<boolean>(MODE_CLICK)
  await browser.run("wait", String(WHEEL_MS))
}

// Pure: while Reading, rows landing leave the view where it was, so the stream does not follow its end. gap is the space left below the view.
export const heldOffResult = (check: string, gap: number | null): Result => {
  if (gap === null) return { check, detail: "the stream is not on the page", ok: false }
  if (gap <= 2) return { check, detail: "the view followed the end while Reading", ok: false }
  return { check, detail: `the view held, ${gap}px above the end`, ok: true }
}

const send = async (browser: Browser, text: string, box = "#composer"): Promise<void> => {
  await browser.run("fill", box, text)
  await browser.run("press", "Enter")
}

const delivered = async (browser: Browser, text: string): Promise<boolean> => {
  for (let waited = 0; waited < DELIVERY_WAIT_MS; waited += POLL_MS) {
    if (await browser.eval<boolean>(deliveredScript(text))) return true
    await browser.run("wait", String(POLL_MS))
  }
  return false
}

// The second dispatcher's own box on its view, where #composer is Playground's in the aside (composerId's id for it, which composer.test.ts holds)
export const secondBox = (name: string) => `#composer-${name}`

// The second dispatcher's chat, as a click on its row opens it (#i520): its composer reads Message and the chat's heading, its label (chatLabel: Bravo) and never its session name, and a send there is Delivered as one from the primary's is. Skipped where the stack runs no second dispatcher.
const secondDispatcher = async (
  browser: Browser,
  target: Target,
  at: string,
  tag: string,
): Promise<Result[]> => {
  const check = `send-top ${at} second dispatcher`
  const dispatchers = await dispatchersOf(browser, target)
  const second = dispatchers?.live.find((w) => w.name === dispatchers.names[1])
  if (!second) return []
  await browser.visit(`${target.web}/dashboard?worker=${encodeURIComponent(second.sessionId)}`)
  const box = secondBox(second.name)
  await browser.run("wait", box)
  const named = await browser.eval<{ heading: string | null; placeholder: string | null }>(
    `({ heading: document.querySelector("[data-dashboard-page] h1")?.textContent.trim() ?? null, placeholder: document.querySelector(${JSON.stringify(box)})?.getAttribute("placeholder") ?? null })`,
  )
  if (!named.heading || named.placeholder !== `Message ${named.heading}`) {
    return [
      {
        check,
        detail: `its composer reads ${JSON.stringify(named.placeholder)} under the heading ${JSON.stringify(named.heading)}`,
        ok: false,
      },
    ]
  }
  const expected = chatLabel(second, dispatchers?.names[0] ?? null)
  if (
    named.heading !== expected ||
    named.heading.toLowerCase().includes(second.name.toLowerCase())
  ) {
    return [
      {
        check,
        detail: `its heading reads ${JSON.stringify(named.heading)}, not ${JSON.stringify(expected)}, its label`,
        ok: false,
      },
    ]
  }
  const text = `send-top second ${tag}`
  await send(browser, text, box)
  return [
    (await delivered(browser, text))
      ? { check, detail: `${named.placeholder}, Delivered`, ok: true }
      : { check, detail: "never read Delivered", ok: false },
  ]
}

// His jump to his previous message on the chat's Checkpoint bar: a click on ↑, only while it is enabled.
const JUMP_UP = `(() => { const button = document.querySelector("[data-slot=chat-checkpoint] [aria-label='Previous message of yours']"); if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") return false; button.click(); return true })()`

// A log of the toggle's words each time they change, kept on the page until WORDS_LOG_STOP reads it.
const WORDS_LOG_START = `(() => { const log = []; window.__sendTopWords = log; window.__sendTopWordsStop = false; const tick = () => { const words = ${MODE_WORDS}; if (log.at(-1) !== words) log.push(words); if (!window.__sendTopWordsStop) requestAnimationFrame(tick) }; requestAnimationFrame(tick); return true })()`
const WORDS_LOG_STOP = `(() => { window.__sendTopWordsStop = true; return window.__sendTopWords ?? [] })()`
const WORDS_NOW = `(() => window.__sendTopWords?.at(-1) ?? null)()`
// How long Watching is given to catch up with a reply and TOOL_STEPS rows at reading speed: about 70s of words, ramped to over 2x, and room under load.
const CATCH_UP_WAIT_MS = 90_000

// His send, then his scroll up 150ms on (a wheel, or a drag of the scrollbar), then the turn going on for 3s: the view must stay where his hand left it, and the chat read Reading.
const yanked = async (
  browser: Browser,
  fixture: string | null,
  text: string,
  check: string,
  by: "drag" | "wheel",
): Promise<Result[]> => {
  await send(browser, text)
  await browser.run("wait", String(YANK_AFTER_MS))
  if (by === "wheel") await browser.eval(SCROLL_UP)
  else {
    await browser.eval(DRAG_START)
    await browser.run("wait", String(YANK_DRAG_MS))
    await browser.eval(DRAG_MORE)
    await browser.eval(DRAG_END)
  }
  await browser.run("wait", String(WHEEL_MS))
  const before = await browser.eval<number | null>(viewAtScript(text))
  const until = Date.now() + YANK_WATCH_MS
  if (fixture) await toolRows(browser, fixture, text, 5)
  await browser.run("wait", String(Math.max(0, until - Date.now())))
  return [
    notDownResult(check, before, await browser.eval<number | null>(viewAtScript(text))),
    modeResult(`${check}, Reading`, await browser.eval<string | null>(MODE), "reading"),
  ]
}

// Both of his scrolls up just after a send: by wheel, and by a 700ms drag of the scrollbar, which sends the scroller no wheel, touch or key.
const yanks = async (
  browser: Browser,
  fixture: string | null,
  at: string,
  tag: string,
): Promise<Result[]> => [
  ...(await yanked(
    browser,
    fixture,
    `send-top yank ${tag}`,
    `send-top ${at} his scroll up just after a send holds`,
    "wheel",
  )),
  ...(await yanked(
    browser,
    fixture,
    `send-top drag ${tag}`,
    `send-top ${at} his drag of the scrollbar up just after a send holds`,
    "drag",
  )),
]

// A send from Playground's chat at one viewport, in each of the chat's two modes. Reading: to an idle session, held until it is Delivered; two in a row, so the second waits Queued behind the first and is the one that takes the top; ↑ to his previous message; one he scrolls away from at once, which the view must not pull back, its reply included; one he pages up from with a row's button focused, which must hold the same way; and, given the stack's fixture folder, with the session first taken past the stream's 400-entry limit, his send keeping the top through a reply, another session's message and the turn's end, Scroll to end staying Reading with a count, and the rest that `bun run verify --help` lists under send-top. Watching: a send lands at the end, a long turn reads behind and then Watching with the view at the end, his scroll up turns Reading, his own scroll to the end turns Watching, and Scroll to end jumps to live. It types into the fixture's dispatcher, so it runs only on a fixture stack, where the message and the reply land in the fixture's scratch copy.
export const sendTop = async (
  browser: Browser,
  target: Target,
  viewport: Viewport,
  fixture: string | null,
): Promise<Result[]> => {
  const { web } = target
  const at = `${viewport.width}x${viewport.height}`
  const tag = `${process.pid}-${viewport.width}`
  await browser.viewport(viewport)
  const second = await secondDispatcher(browser, target, at, tag)
  await browser.visit(`${web}/dashboard`)
  await browser.run("wait", "#composer")
  const results: Result[] = [
    ...second,
    edgeResult(`send-top ${at} top edge`, await browser.eval<number | null>(EDGE)),
  ]

  // Reading: the view moves only by his hand, and his send takes the top
  await toMode(browser, "reading")
  results.push(
    modeResult(
      `send-top ${at} a click turns Reading`,
      await browser.eval<string | null>(MODE),
      "reading",
    ),
  )
  const idle = `send-top idle ${tag}`
  await browser.eval(LATEST_LOG_START)
  await send(browser, idle)
  const sentIdle = await delivered(browser, idle)
  await browser.run("wait", String(SETTLE_MS))
  const latestFrames = await browser.eval<boolean[] | null>(LATEST_LOG_STOP)
  results.push(
    sentIdle
      ? sendTopResult(`send-top ${at} idle delivered`, await place(browser, idle))
      : { check: `send-top ${at} idle delivered`, detail: "never read Delivered", ok: false },
    noFlashResult(`send-top ${at} the send shows Scroll to end in no frame`, latestFrames),
  )
  // past the stream's limit, as Playground's live session always is, so every check below runs with rows dropping above the view
  if (fixture && !(await pastLimit(fixture, idle, tag))) {
    results.push({
      check: `send-top ${at} past the limit`,
      detail: "found no transcript holding the message",
      ok: false,
    })
    return results
  }
  // the next send waits until the stream shows the last of them and has settled, so their rows never race its glide
  const lastAnswer = earlierStep(tag, PAST_LIMIT - 1)
  let shown = !fixture
  for (let waited = 0; !shown && waited < DELIVERY_WAIT_MS; waited += POLL_MS) {
    shown = await browser.eval<boolean>(shownScript(lastAnswer))
    if (!shown) await browser.run("wait", String(POLL_MS))
  }
  if (!shown || !(await settled(browser))) {
    results.push({
      check: `send-top ${at} past the limit`,
      detail: shown
        ? "the stream never settled after the earlier turn"
        : "the stream never showed the earlier turn",
      ok: false,
    })
    return results
  }
  // and he scrolls down to the latest of them, as he would before his next send, which turns Watching; he turns Reading again
  await browser.eval<boolean>(END_TRACE_START)
  await browser.eval(TO_THE_END)
  await browser.run("wait", String(SETTLE_MS))
  const restedAtEnd = await settled(browser, VIEW_TOP, REST_MS)
  if (fixture) {
    const mode = await browser.eval<string | null>(MODE)
    const view = await browser.eval<string | null>(VIEW_AT)
    const trace = await browser.eval<string | null>(END_TRACE_STOP)
    results.push(
      atRest(
        restedAtEnd,
        modeResult(
          `send-top ${at} his own scroll to the end turns Watching`,
          mode,
          "watching",
          `${view}; ${trace}`,
        ),
      ),
    )
  }
  await toMode(browser, "reading")

  // he opens the newest of them, then its turn goes on, each step dropping its oldest one: the row he opened stays open, since the turn keeps its name and is not drawn anew
  if (fixture) {
    const openCheck = `send-top ${at} a tool row he opened stays open as its turn loses its oldest steps`
    const lastStep = earlierStep(tag, PAST_LIMIT - 1)
    await browser.eval<boolean>(toolToggleScript(lastStep, "open"))
    await browser.run("wait", String(WHEEL_MS))
    const opened = await browser.eval<boolean>(toolToggleScript(lastStep, "read"))
    const grown = opened && (await toolRows(browser, fixture, idle, 5))
    await browser.run("wait", String(SETTLE_MS))
    const stillOpen = grown && (await browser.eval<boolean>(toolToggleScript(lastStep, "read")))
    results.push(
      !grown
        ? {
            check: openCheck,
            detail: "the tool row never opened, or the new steps never showed",
            ok: false,
          }
        : stillOpen
          ? { check: openCheck, detail: "the row stayed open", ok: true }
          : { check: openCheck, detail: "the row closed as the turn was drawn anew", ok: false },
    )

    // the question that opened the turn sits below the window the stream keeps: Load older pages the database back until it shows, and the row he opened in that turn still is
    const olderCheck = `send-top ${at} Load older reaches the long turn's prompt, the row he opened still open`
    if (!ingestFixture()) {
      results.push({
        check: olderCheck,
        detail: "bun run ingest never filled this worktree's database",
        ok: false,
      })
    } else {
      let asked = false
      for (let clicks = 0; !asked && clicks < 12; clicks += 1) {
        asked = await browser.eval<boolean>(shownScript("An earlier question."))
        if (!asked && !(await browser.eval<boolean>(LOAD_OLDER))) break
        if (!asked) await browser.run("wait", String(POLL_MS * 4))
      }
      const open = asked && (await browser.eval<boolean>(toolToggleScript(lastStep, "read")))
      results.push(
        !asked
          ? {
              check: olderCheck,
              detail: "Load older never showed the long turn's prompt",
              ok: false,
            }
          : open
            ? {
                check: olderCheck,
                detail: "the prompt shows and the row he opened still is",
                ok: true,
              }
            : {
                check: olderCheck,
                detail: "the row he opened closed as older steps loaded",
                ok: false,
              },
      )
    }
  }

  const first = `send-top first ${tag}`
  const queued = `send-top queued ${tag}`
  await send(browser, first)
  await send(browser, queued)
  await browser.run("wait", String(JUMP_MS))
  const queuedRested = await settled(browser, topScript(queued), REST_MS)
  results.push(
    atRest(queuedRested, sendTopResult(`send-top ${at} busy queued`, await place(browser, queued))),
  )
  const sentQueued = await delivered(browser, queued)
  await browser.run("wait", String(SETTLE_MS))
  results.push(
    sentQueued
      ? sendTopResult(`send-top ${at} queued then delivered`, await place(browser, queued))
      : {
          check: `send-top ${at} queued then delivered`,
          detail: "never read Delivered",
          ok: false,
        },
  )
  // ↑ takes him to his message before it, resting at the same 12px
  const jumpCheck = `send-top ${at} ↑ rests his previous message at the top`
  if (await browser.eval<boolean>(JUMP_UP)) {
    await browser.run("wait", String(JUMP_MS))
    const jumpRested = await settled(browser, topScript(first), REST_MS)
    results.push(atRest(jumpRested, sendTopResult(jumpCheck, await place(browser, first))))
  } else results.push({ check: jumpCheck, detail: "↑ is disabled or not on the bar", ok: false })

  // his send while the session works: it waits queued behind the one before, and the turn's rows land above it meanwhile, as on his live dashboard (his report, 22:22:08Z: 24px, not 12px); his row keeps the top
  if (fixture) {
    const busyFirst = `send-top busy first ${tag}`
    const busyNext = `send-top busy next ${tag}`
    await send(browser, busyFirst)
    await send(browser, busyNext)
    const landing = await toolRows(browser, fixture, busyFirst, 3)
    await browser.run("wait", String(SETTLE_MS))
    results.push(
      landing
        ? sendTopResult(
            `send-top ${at} rows landing above his queued send`,
            await place(browser, busyNext),
          )
        : {
            check: `send-top ${at} rows landing above his queued send`,
            detail: "found no transcript holding the message",
            ok: false,
          },
    )
    await delivered(browser, busyNext)
    await browser.run("wait", String(SETTLE_MS))
  }

  const scrolled = `send-top scrolled ${tag}`
  const scrolledCheck = `send-top ${at} his scroll`
  await send(browser, scrolled)
  await browser.run("wait", String(JUMP_MS))
  await browser.eval(SCROLL_UP)
  await browser.run("wait", String(WHEEL_MS))
  const before = await place(browser, scrolled)
  if (!(await delivered(browser, scrolled))) {
    results.push({ check: scrolledCheck, detail: "never read Delivered", ok: false })
    return results
  }
  await browser.run("wait", String(SETTLE_MS))
  results.push(scrolledResult(scrolledCheck, before, await place(browser, scrolled)))

  if (!fixture) {
    // his scroll up just after a send, by wheel and by a long drag of the scrollbar: the view never moves down after it
    results.push(...(await yanks(browser, fixture, at, tag)))
    results.push({
      check: `send-top ${at} reply`,
      detail:
        "skipped: the reply checks write this checkout's own fixture, so run them with no --web and --api",
      ok: true,
    })
    return results
  }
  const replyCheck = `send-top ${at} his scroll, then the reply`
  results.push(
    (await reply(browser, fixture, scrolled))
      ? scrolledResult(replyCheck, before, await place(browser, scrolled))
      : { check: replyCheck, detail: "found no transcript holding the message", ok: false },
  )

  // his scroll up just after a send, by wheel and by a long drag of the scrollbar: the view never moves down after it
  results.push(...(await yanks(browser, fixture, at, tag)))

  const paged = `send-top paged ${tag}`
  const pagedCheck = `send-top ${at} PageUp on a row's button, then the reply`
  await send(browser, paged)
  if (!(await delivered(browser, paged))) {
    results.push({ check: pagedCheck, detail: "never read Delivered", ok: false })
    return results
  }
  await browser.run("wait", String(SETTLE_MS))
  if (!(await browser.eval<boolean>(FOCUS_ROW_BUTTON))) {
    results.push({ check: pagedCheck, detail: "found no button in the stream to focus", ok: false })
    return results
  }
  await browser.run("press", "PageUp")
  await browser.run("wait", String(WHEEL_MS))
  const paging = await place(browser, paged)
  results.push(
    (await reply(browser, fixture, paged))
      ? scrolledResult(pagedCheck, paging, await place(browser, paged))
      : { check: pagedCheck, detail: "found no transcript holding the message", ok: false },
  )

  // the reply runs past the screen below his send, which keeps the top (Reading has no reply lead)
  const answered = `send-top answered ${tag}`
  const answeredCheck = `send-top ${at} his send keeps the top through the reply`
  await send(browser, answered)
  if (!(await delivered(browser, answered)) || !(await reply(browser, fixture, answered))) {
    results.push({
      check: answeredCheck,
      detail: "the message or its reply never landed",
      ok: false,
    })
    return results
  }
  await browser.run("wait", String(SETTLE_MS))
  results.push(sendTopResult(answeredCheck, await place(browser, answered)))

  // another session's message leads the turn after his send, then a reply runs past the screen: his row holds its rest every frame and at the end (Reading has no peer lead)
  const peerLong = `send-top peer long ${tag}`
  const peerLongCheck = `send-top ${at} his send holds the top through a peer message and a reply past the screen`
  await send(browser, peerLong)
  if (!(await delivered(browser, peerLong)) || !(await peerLine(fixture, peerLong))) {
    results.push({
      check: peerLongCheck,
      detail: "the message or the peer message never landed",
      ok: false,
    })
    return results
  }
  await browser.run("wait", String(SETTLE_MS))
  await browser.eval(frameLogStart(peerLong))
  const longReply =
    (await reply(browser, fixture, peerLong)) &&
    (await toolRows(browser, fixture, peerLong, TOOL_STEPS))
  await browser.run("wait", String(SETTLE_MS))
  const peerTops = (await browser.eval<(number | null)[]>(FRAME_LOG_STOP)) ?? []
  const peerPast = (await browser.eval<Blank>(blankScript(peerLong)))?.past ?? false
  if (!longReply || !peerPast) {
    results.push({ check: peerLongCheck, detail: "the reply never ran past the screen", ok: false })
    return results
  }
  results.push(frameResult(peerLongCheck, peerTops))
  results.push(sendTopResult(`${peerLongCheck}, at rest`, await place(browser, peerLong)))

  // he scrolls up after his send, then another session's message and rows land: the view stays where he put it, following nothing on its own
  const upped = `send-top upped ${tag}`
  const uppedCheck = `send-top ${at} his scroll up, then a peer message and rows`
  await send(browser, upped)
  await browser.run("wait", String(BUSY_MS))
  if (!(await reply(browser, fixture, upped))) {
    results.push({
      check: uppedCheck,
      detail: "found no transcript holding the message",
      ok: false,
    })
    return results
  }
  await browser.run("wait", String(SETTLE_MS))
  await browser.eval(SCROLL_UP)
  await browser.run("wait", String(WHEEL_MS))
  const uppedBefore = await place(browser, upped)
  const peeredRows =
    (await peerLine(fixture, upped)) && (await toolRows(browser, fixture, upped, TOOL_STEPS))
  await browser.run("wait", String(SETTLE_MS))
  results.push(
    peeredRows
      ? scrolledResult(uppedCheck, uppedBefore, await place(browser, upped))
      : { check: uppedCheck, detail: "the peer message or its rows never landed", ok: false },
  )

  // the turn grows past the view and he clicks Scroll to end: it glides to the end and stays Reading, so rows landing after it leave the view where it was and the toggle counts them
  const latest = `send-top latest ${tag}`
  const latestCheck = `send-top ${at} Scroll to end stays Reading`
  await send(browser, latest)
  await browser.run("wait", String(BUSY_MS))
  const grownPast = await toolRows(browser, fixture, latest, TOOL_STEPS)
  await browser.run("wait", String(SETTLE_MS))
  const clicked = grownPast && (await browser.eval<boolean>(TO_LATEST))
  await browser.run("wait", String(SETTLE_MS))
  if (!clicked || !(await toolRows(browser, fixture, latest, 5))) {
    results.push({
      check: latestCheck,
      detail: "the turn or the Scroll to end button never showed",
      ok: false,
    })
    return results
  }
  await browser.run("wait", String(SETTLE_MS))
  results.push(
    modeResult(latestCheck, await browser.eval<string | null>(MODE), "reading"),
    heldOffResult(`${latestCheck}, as rows land`, await browser.eval<number | null>(GAP_BELOW)),
    countResult(
      `send-top ${at} Reading counts the rows that landed below`,
      await browser.eval<string | null>(MODE_WORDS),
    ),
  )

  // a short turn whose status line comes and goes, as a busy session's does between turns: his row holds its rest every frame
  const hop = `send-top hop ${tag}`
  const hopCheck = `send-top ${at} his send holds its rest every frame as the status line comes and goes`
  await browser.eval(frameLogStart(hop))
  await send(browser, hop)
  await browser.run("wait", String(BUSY_MS))
  const landed = await toolRows(browser, fixture, hop, 2)
  await browser.run("wait", String(SETTLE_MS))
  let flipped = false
  if (landed && (await setLifecycle(fixture, hop, "idle"))) {
    await browser.run("wait", String(LIGHT_MS))
    flipped = await setLifecycle(fixture, hop, "running")
  }
  await browser.run("wait", String(LIGHT_MS))
  const tops = (await browser.eval<(number | null)[]>(FRAME_LOG_STOP)) ?? []
  results.push(
    flipped
      ? frameResult(hopCheck, tops)
      : {
          check: hopCheck,
          detail: "found no transcript or session holding the message",
          ok: false,
        },
  )

  // the turn grows a row at a time until it runs past the screen, then ends and its status line leaves: his send keeps the top
  const ended = `send-top ended ${tag}`
  const endedCheck = `send-top ${at} a turn that ends past the screen keeps his send at the top`
  await send(browser, ended)
  let past = (await delivered(browser, ended)) && (await setLifecycle(fixture, ended, "running"))
  if (past) {
    await browser.run("wait", String(LIGHT_MS))
    past = false
    for (let step = 0; step < TOOL_STEPS && !past; step += 1) {
      if (!(await toolRows(browser, fixture, ended, 1))) break
      past = (await browser.eval<Blank>(blankScript(ended)))?.past ?? false
    }
  }
  if (!past || !(await setLifecycle(fixture, ended, "idle"))) {
    results.push({ check: endedCheck, detail: "the reply never ran past the screen", ok: false })
    return results
  }
  await browser.run("wait", String(LIGHT_MS))
  results.push(sendTopResult(endedCheck, await place(browser, ended)))
  await setLifecycle(fixture, ended, "running")
  await browser.run("wait", String(LIGHT_MS))

  // a short turn whose status line sits at the middle of the view (the window sized to put it there), then the turn ends and the line leaves: his send keeps its rest
  const middle = `send-top middle ${tag}`
  const middleCheck = `send-top ${at} a turn that ends with its status line mid-screen keeps his send at the top`
  await send(browser, middle)
  const going =
    (await delivered(browser, middle)) &&
    (await setLifecycle(fixture, middle, "running")) &&
    (await toolRows(browser, fixture, middle, 2))
  await browser.run("wait", String(LIGHT_MS))
  const offset = going ? await browser.eval<number | null>(STATUS_FROM_MIDDLE) : null
  if (offset === null) {
    results.push({ check: middleCheck, detail: "the status line never showed", ok: false })
    return results
  }
  await browser.viewport({ height: viewport.height + 2 * offset, width: viewport.width })
  await browser.run("wait", String(SETTLE_MS))
  await setLifecycle(fixture, middle, "idle")
  await browser.run("wait", String(LIGHT_MS))
  results.push(sendTopResult(middleCheck, await place(browser, middle)))
  await browser.viewport(viewport)
  await setLifecycle(fixture, middle, "running")
  await browser.run("wait", String(LIGHT_MS))

  const leading = `send-top leading ${tag}`
  const leadingCheck = `send-top ${at} his wheel down after his send, then a row`
  await send(browser, leading)
  if (!(await delivered(browser, leading)) || !(await reply(browser, fixture, leading))) {
    results.push({
      check: leadingCheck,
      detail: "the message or its reply never landed",
      ok: false,
    })
    return results
  }
  await browser.run("wait", String(SETTLE_MS))
  await browser.eval(SCROLL_DOWN)
  await browser.run("wait", String(WHEEL_MS))
  const leadingBefore = await browser.eval<number | null>(viewAtScript(leading))
  await toolRows(browser, fixture, leading, 2)
  await browser.run("wait", String(SETTLE_MS))
  results.push(
    heldResult(
      leadingCheck,
      leadingBefore,
      await browser.eval<number | null>(viewAtScript(leading)),
    ),
  )

  const grown = `send-top grown ${tag}`
  const grownCheck = `send-top ${at} a turn grown by tool rows leaves no blank below`
  await send(browser, grown)
  if (!(await delivered(browser, grown))) {
    results.push({ check: grownCheck, detail: "never read Delivered", ok: false })
    return results
  }
  // the owner tries to scroll while it streams, a third of the way in
  const early = Math.round(TOOL_STEPS / 3)
  const streamed = await toolRows(browser, fixture, grown, early)
  await browser.eval(SCROLL_DOWN)
  if (!streamed || !(await toolRows(browser, fixture, grown, TOOL_STEPS - early))) {
    results.push({
      check: grownCheck,
      detail: "found no transcript holding the message",
      ok: false,
    })
    return results
  }
  await browser.run("wait", String(SETTLE_MS))
  results.push(blankResult(grownCheck, await browser.eval<Blank>(blankScript(grown))))

  // Watching: a send lands at the end, and a long turn plays at reading speed, falling behind and catching up, the view never moving up on its own
  await toMode(browser, "watching")
  results.push(
    modeResult(
      `send-top ${at} a click turns Watching`,
      await browser.eval<string | null>(MODE),
      "watching",
    ),
  )
  const watched = `send-top watched ${tag}`
  const landsCheck = `send-top ${at} a send while Watching lands at the end`
  await send(browser, watched)
  if (!(await delivered(browser, watched))) {
    results.push({ check: landsCheck, detail: "never read Delivered", ok: false })
    return results
  }
  await browser.run("wait", String(SETTLE_MS))
  results.push(atEndResult(landsCheck, await browser.eval<number | null>(GAP_BELOW)))

  const caughtCheck = `send-top ${at} a long turn reads behind, then Watching`
  const steadyCheck = `send-top ${at} the view never moves up on its own while Watching plays a turn`
  await browser.eval(WORDS_LOG_START)
  await browser.eval(scrollLogStart(watched))
  // a reply's words, then tool rows that take it past the screen: about 70s of reading at 250 words a minute, so it falls behind and ramps up to catch up
  const played =
    (await reply(browser, fixture, watched)) &&
    (await toolRows(browser, fixture, watched, TOOL_STEPS))
  if (!played) {
    await browser.eval(WORDS_LOG_STOP)
    await browser.eval(SCROLL_LOG_STOP)
    results.push({
      check: caughtCheck,
      detail: "found no transcript holding the message",
      ok: false,
    })
    return results
  }
  for (let waited = 0; waited < CATCH_UP_WAIT_MS; waited += POLL_MS * 4) {
    if ((await browser.eval<string | null>(WORDS_NOW)) === "Watching") break
    await browser.run("wait", String(POLL_MS * 4))
  }
  await browser.run("wait", String(WHEEL_MS))
  results.push(
    behindResult(caughtCheck, (await browser.eval<(string | null)[]>(WORDS_LOG_STOP)) ?? []),
    atEndResult(
      `${caughtCheck}, the view at the end`,
      await browser.eval<number | null>(GAP_BELOW),
    ),
    steadyResult(steadyCheck, (await browser.eval<number[]>(SCROLL_LOG_STOP)) ?? []),
  )

  // his scroll up just after a send while Watching turns Reading, and nothing moves the view down after it
  results.push(
    ...(await yanked(
      browser,
      fixture,
      `send-top watched yank ${tag}`,
      `send-top ${at} his scroll up just after a send while Watching holds`,
      "wheel",
    )),
  )
  await toMode(browser, "watching")
  await browser.eval(TO_THE_END)
  await browser.run("wait", String(WHEEL_MS))

  // his scroll up turns Reading at once, and his own scroll back to the end turns Watching
  await browser.eval(SCROLL_UP)
  await browser.run("wait", String(WHEEL_MS))
  results.push(
    modeResult(
      `send-top ${at} his scroll up turns Reading`,
      await browser.eval<string | null>(MODE),
      "reading",
    ),
  )
  await browser.eval(TO_THE_END)
  await browser.run("wait", String(SETTLE_MS))
  const restedBack = await settled(browser, VIEW_TOP, REST_MS)
  results.push(
    atRest(
      restedBack,
      modeResult(
        `send-top ${at} his own scroll back to the end turns Watching`,
        await browser.eval<string | null>(MODE),
        "watching",
        await browser.eval<string | null>(VIEW_AT),
      ),
    ),
  )

  // a turn lands faster than reading speed, and Scroll to end jumps to live, staying Watching
  const liveCheck = `send-top ${at} Scroll to end while Watching jumps to live`
  await reply(browser, fixture, watched)
  await toolRows(browser, fixture, watched, TOOL_STEPS)
  const behindNow = await browser.eval<boolean>(`${LATEST_SHOWN}()`)
  if (!behindNow || !(await browser.eval<boolean>(TO_LATEST))) {
    results.push({ check: liveCheck, detail: "Scroll to end never showed while behind", ok: false })
    return results
  }
  await browser.run("wait", String(SETTLE_MS))
  results.push(
    atEndResult(liveCheck, await browser.eval<number | null>(GAP_BELOW)),
    modeResult(`${liveCheck}, still Watching`, await browser.eval<string | null>(MODE), "watching"),
  )
  return results
}
