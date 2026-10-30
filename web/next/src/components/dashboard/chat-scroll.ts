import type { OutboxMessage } from "@/lib/outbox"

type Sent = Pick<OutboxMessage, "at" | "entryId" | "id">

// The newest message sent since this view opened, keyed by rowKey; a message sent before the view opened is none, so opening a session never jumps. A send made while Reading takes the top with it (sendLeads); one made while Watching lands at the bottom.
export function sendAnchor(records: Sent[], openedAt: string): string | null {
  const last = records.at(-1)
  if (!last) return null
  const at = Date.parse(last.at)
  return Number.isNaN(at) || at < Date.parse(openedAt) ? null : last.id
}

// How long after his wheel, touch or key a scroll is still his, a smooth key scroll's whole glide included.
export const HAND_MS = 500

// Which way his own hand last pointed the view: a scroll inside HAND_MS of it counts as his only in that way, so the view put back down as a row at the end shrinks, or his send's glide running on, is never his return to the end after a wheel up, and rows dropped above the view are never his scroll up after a wheel down. A touch, or a press on the scrollbar, points either way.
export type HandWay = "down" | "either" | "up"

export const wheelWay = (deltaY: number): HandWay =>
  deltaY > 0 ? "down" : deltaY < 0 ? "up" : "either"

export const keyWay = (key: string, shiftKey: boolean): HandWay => {
  if (key === " ") return shiftKey ? "up" : "down"
  if (key === "ArrowDown" || key === "End" || key === "PageDown") return "down"
  if (key === "ArrowUp" || key === "Home" || key === "PageUp") return "up"
  return "either"
}

// Whether a scroll carries his gesture on: his way, inside HAND_MS of his hand or of the last scroll that carried it, so a smooth scroll (a key's, or any while his send leads and the stream scrolls smoothly) that runs longer than HAND_MS stays his to its end.
export const carriesHand = (delta: number, sinceHand: number, way: HandWay): boolean =>
  sinceHand <= HAND_MS &&
  (way === "down" ? delta > 0.5 : way === "up" ? delta < -0.5 : Math.abs(delta) > 0.5)

// Whether a scroll moved the view up by his own hand: up and off the end, within HAND_MS of his wheel, touch, key or a press on the scrollbar; the browser's own moves (a row shrinking at the end, rows dropped above) come with none, and its clamp to a new end just after his wheel reached the old one leaves the view at the end.
export const handUp = (delta: number, sinceHand: number, atEnd: boolean, way: HandWay): boolean =>
  delta < -0.5 && sinceHand <= HAND_MS && !atEnd && way !== "down"

// Whether a scroll moved the view down by his own hand, within HAND_MS of his wheel, touch, key or a press on the scrollbar: while Watching, the glide yields to it.
export const handDown = (delta: number, sinceHand: number, way: HandWay): boolean =>
  delta > 0.5 && sinceHand <= HAND_MS && way !== "up"

// Each chat's one mode: Watching glides down at reading speed through every new row, Reading moves only by his hand.
export type ChatMode = "reading" | "watching"

// A chat with no mode stored starts Watching, the live tail he asked for.
export const DEFAULT_MODE: ChatMode = "watching"

// What he did that can change the mode: his scroll up, his own scroll to the very end, a click on the toggle, or a jump to his previous message; a jump down and Scroll to end are none, so each keeps the mode, since neither is his own scroll.
export type ModeAct = "click" | "end" | "jump-up" | "up"

// The mode after what he did: his scroll up and a jump up stop to read, his own scroll to the end watches, and a click flips it.
export const modeAfter = (mode: ChatMode, act: ModeAct): ChatMode =>
  act === "up" || act === "jump-up"
    ? "reading"
    : act === "end"
      ? "watching"
      : mode === "watching"
        ? "reading"
        : "watching"

// The send this view made and whether it takes the top: only one made while Reading, and only until the mode changes, so a switch never brings back a send that has rested.
export type SentIn = { id: string; leads: boolean }

// Whether what he did ends a Reading send's hold on the top: his scroll up or jump up always does, even with the mode already Reading, and so does any change of mode.
export const dropsLead = (act: ModeAct, before: ChatMode, after: ChatMode): boolean =>
  act === "up" || act === "jump-up" || before !== after

// Whether the newest send takes the top: it was made while Reading, and the mode has not changed since.
export const sendLeads = (sentKey: string | null, sentIn: SentIn | null): boolean =>
  sentKey !== null && sentIn?.id === sentKey && sentIn.leads

// Reading speed: words a minute at 1x.
export const READING_WPM = 250
// A tool row, thinking or a subagent run, closed to one line, reads as this many words, so it passes in under a second.
export const ROW_WORDS = 3
// Past this many seconds of reading behind, the glide speeds up smoothly, up to MAX_SPEED_UP.
export const CATCH_UP_S = 30
export const MAX_SPEED_UP = 4
// Past this many seconds behind, it jumps to CATCH_UP_S behind the end.
export const MAX_BEHIND_S = 120
// The rest at each new message that reaches the top ("it should give time to switch to reading").
export const MESSAGE_REST_MS = 1500
// How long after he lets go of the stream, or clears his selection in it, the glide goes on.
export const TOUCH_RESUME_MS = 1000
// How long after his own scroll down the glide goes on from where he left it.
export const HAND_RESUME_MS = 2000

// The words in a message's text, for the pace.
export const wordsIn = (text: string): number => text.split(/\s+/).filter(Boolean).length

// How many seconds of reading a number of words is, at a pace (1 is READING_WPM).
export const secondsOf = (words: number, pace = 1): number => (words / (READING_WPM * pace)) * 60

// How much faster than reading speed the glide goes: 1x up to CATCH_UP_S behind, rising smoothly to MAX_SPEED_UP at MAX_BEHIND_S.
export const speedUp = (seconds: number): number =>
  seconds <= CATCH_UP_S
    ? 1
    : Math.min(
        MAX_SPEED_UP,
        1 + ((MAX_SPEED_UP - 1) * (seconds - CATCH_UP_S)) / (MAX_BEHIND_S - CATCH_UP_S),
      )

// The glide's pace from what is still below the view: pixels a second, the seconds of reading behind, and whether it is so far behind that it jumps. Pixels with no words under them (the room under the last row) pass at once.
export function paceOf({
  pace = 1,
  pixels,
  words,
}: {
  pace?: number
  pixels: number
  words: number
}): { jump: boolean; pxPerS: number; seconds: number } {
  const seconds = secondsOf(words, pace)
  if (pixels <= 0) return { jump: false, pxPerS: 0, seconds: 0 }
  if (seconds <= 0) return { jump: false, pxPerS: Number.POSITIVE_INFINITY, seconds: 0 }
  return {
    jump: seconds > MAX_BEHIND_S,
    pxPerS: (pixels / seconds) * speedUp(seconds),
    seconds,
  }
}

// A row of the stream as the glide sees it, in the content's own pixels: where it starts, how tall it is, its words, and whether the glide rests when it reaches the top (a person's message, a peer's, a card; a turn rests at its words instead, through spansOf).
export type RowSpan = { height: number; key: string; rests: boolean; top: number; words: number }

// The rows the glide reads from their places and facts: a row that rests as a whole (his message, a peer's, a card) rests at its top, and a turn at the top of each of its reply's words (rests, its text steps' tops), never at a tool row.
export const spansOf = (
  places: { height: number; id: string; rests: number[]; top: number }[],
  facts: ReadonlyMap<string, { rests: boolean; words: number }>,
): RowSpan[] =>
  places.flatMap(({ rests, ...place }) => {
    const fact = facts.get(place.id)
    const row = { ...place, key: place.id, rests: fact?.rests ?? false, words: fact?.words ?? 0 }
    if (row.rests) return [row]
    return [
      row,
      ...rests.map((top, i) => ({
        height: 0,
        key: `${place.id}@${i}`,
        rests: true,
        top,
        words: 0,
      })),
    ]
  })

// What is still below a line in the content (the view's bottom): its pixels to the last row's end, and its words, a row cut by the line counting the share below it.
export function behind(rows: RowSpan[], line: number): { pixels: number; words: number } {
  const last = rows.at(-1)
  if (!last) return { pixels: 0, words: 0 }
  let words = 0
  for (const row of rows) {
    const bottom = row.top + row.height
    if (bottom <= line) continue
    const share = row.height > 0 ? (bottom - Math.max(row.top, line)) / row.height : 1
    words += row.words * Math.min(1, share)
  }
  return { pixels: Math.max(0, last.top + last.height - line), words }
}

// The line in the content with this many words below it, for the jump to CATCH_UP_S behind.
export function lineFor(rows: RowSpan[], words: number): number {
  let left = words
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!
    if (row.words >= left) {
      return row.top + row.height - (row.words > 0 ? (left / row.words) * row.height : 0)
    }
    left -= row.words
  }
  return rows[0]?.top ?? 0
}

// One step of the glide from a view top: where it goes by this many pixels, held at the first resting row it would carry past the top (resting margin pixels below the top, as a send does), with that row's key.
export function glideTo({
  by,
  from,
  margin,
  max,
  rows,
}: {
  by: number
  from: number
  margin: number
  max: number
  rows: RowSpan[]
}): { restAt: string | null; to: number } {
  const to = Math.min(max, from + by)
  const rest = rows.find(
    (row) => row.rests && row.top - margin > from + 0.5 && row.top - margin <= to,
  )
  return rest ? { restAt: rest.key, to: rest.top - margin } : { restAt: null, to }
}

// Under reduced motion the glide steps row by row at the same pace: the view top it shows for where the glide has reached, the top of the last row it has reached, else the end once it gets there.
export function stepTo({
  at,
  margin,
  max,
  rows,
}: {
  at: number
  margin: number
  max: number
  rows: RowSpan[]
}): number {
  if (at >= max - 0.5) return max
  const reached = rows.findLast((row) => row.top - margin <= at + 0.5)
  return reached ? Math.min(max, Math.max(0, reached.top - margin)) : at
}

// What the glide does now: paused while he holds the stream or has text selected in it and for TOUCH_RESUME_MS after, yielded for HAND_RESUME_MS after his own scroll down, resting at a message for MESSAGE_REST_MS, else moving; until is when it goes on, null while he holds.
export function glideState({
  downAt,
  now,
  pressed,
  releasedAt,
  restUntil,
}: {
  downAt: number | null
  now: number
  pressed: boolean
  releasedAt: number | null
  restUntil: number | null
}): { state: "moving" | "paused" | "resting" | "yielded"; until: number | null } {
  if (pressed) return { state: "paused", until: null }
  if (releasedAt !== null && now - releasedAt < TOUCH_RESUME_MS) {
    return { state: "paused", until: releasedAt + TOUCH_RESUME_MS }
  }
  if (downAt !== null && now - downAt < HAND_RESUME_MS) {
    return { state: "yielded", until: downAt + HAND_RESUME_MS }
  }
  if (restUntil !== null && now < restUntil) return { state: "resting", until: restUntil }
  return { state: "moving", until: null }
}

// How long a click's smooth scroll to the end holds the glide back at least, at most while it still moves the view, and how long the view must sit still past the first before the hold ends, so one stalled frame mid-scroll never ends it.
export const LIVE_GLIDE_MS = 600
export const LIVE_MAX_MS = 2000
export const LIVE_STILL_MS = 100

// When a jump to live starts holding the glide back: only a smooth scroll has a glide of its own to wait out, and under reduced motion the jump is instant.
export const liveStart = ({
  now,
  reduced,
  smooth,
}: {
  now: number
  reduced: boolean
  smooth: boolean
}): number | null => (smooth && !reduced ? now : null)

// Whether a jump to live, clicked at liveAt, still holds the glide back, and when the view last moved: the browser's smooth scroll can outrun LIVE_GLIDE_MS, and a glide write mid-way cancels it, so the hold lasts until the view has been still for LIVE_STILL_MS. The view moved when its top sits off where the last frame left it (wrote), so the glide's own writes never count.
export function liveHolds({
  liveAt,
  movedAt,
  now,
  top,
  wrote,
}: {
  liveAt: number | null
  movedAt: number | null
  now: number
  top: number
  wrote: number | null
}): { holds: boolean; movedAt: number | null } {
  const moved = wrote !== null && Math.abs(top - wrote) > 0.5
  const last = moved ? now : movedAt
  const holds =
    liveAt !== null &&
    now - liveAt < LIVE_MAX_MS &&
    (now - liveAt < LIVE_GLIDE_MS || (last !== null && now - last < LIVE_STILL_MS))
  return { holds, movedAt: holds ? last : null }
}

// Watching's words: "Watching" once caught up, else how far behind, rounded to 5s; band says which, for the screen reader, which hears only a change of band.
export function behindLabel(seconds: number): {
  band: "behind" | "caught-up"
  text: string | null
} {
  const rounded = Math.round(seconds / 5) * 5
  return rounded <= 0
    ? { band: "caught-up", text: null }
    : { band: "behind", text: `${rounded}s behind` }
}

// Whether the label takes a new reading: at most once a second while the glide moves, held through a rest or a pause so it never flickers, and at once when he catches up.
export const labelDue = ({
  caughtUp,
  sinceLast,
  state,
}: {
  caughtUp: boolean
  sinceLast: number
  state: ReturnType<typeof glideState>["state"]
}): boolean => caughtUp || (state === "moving" && sinceLast >= 1000)

// A chat's learned pace: each scroll down while behind raises it by PACE_STEP, up to PACE_MAX, and a week with no change puts it back to 1.
export const PACE_STEP = 1.25
export const PACE_MAX = 2
export const PACE_RESET_MS = 7 * 24 * 60 * 60 * 1000
export type Pace = { at: number; pace: number }

// The pace a chat runs at now.
export const paceNow = (stored: Pace | null, now: number): number =>
  stored && now - stored.at < PACE_RESET_MS ? stored.pace : 1

// The pace after his scroll down while behind.
export const paceAfterScrollDown = (stored: Pace | null, now: number): Pace => ({
  at: now,
  pace: Math.min(PACE_MAX, paceNow(stored, now) * PACE_STEP),
})

// Whether a scroll down starts a new one of his, so the pace rises once per scroll, not on each of its frames: none came within HAND_RESUME_MS before it.
export const startsScrollDown = (lastDownAt: number | null, now: number): boolean =>
  lastDownAt === null || now - lastDownAt > HAND_RESUME_MS

// How far, in px, a row may sit from the resting line and still be the one he is on: a reply's room growing by a pixel leaves the view that far past a message's rest.
const ROW_SLACK_PX = 2

// The jump to his previous or next message from where the view sits: the nearest of his rows above the resting line (the view's top plus the margin a send rests at), or below it, by index, null at either end. Read once, on the press.
export function jumpTarget(
  tops: number[],
  viewTop: number,
  margin: number,
  dir: "down" | "up",
): number | null {
  if (dir === "up") {
    const i = tops.findLastIndex((top) => top - margin < viewTop - ROW_SLACK_PX)
    return i < 0 ? null : i
  }
  const i = tops.findIndex((top) => top - margin > viewTop + ROW_SLACK_PX)
  return i < 0 ? null : i
}

// Whether any row of his is loaded, and whether ↑ and ↓ have somewhere to go, from his first and last rows alone: up while his first sits above the resting line, down while his last sits below it and the view is not at the end.
export const jumpEnds = ({
  atEnd,
  first,
  last,
  margin,
  viewTop,
}: {
  atEnd: boolean
  first: number | null
  last: number | null
  margin: number
  viewTop: number
}): { mine: boolean; next: boolean; prev: boolean } => ({
  mine: first !== null,
  next: last !== null && !atEnd && last - margin > viewTop + ROW_SLACK_PX,
  prev: first !== null && first - margin < viewTop - ROW_SLACK_PX,
})

// Whether focus sits where Option+Arrow moves a caret, so the jump's shortcut leaves it alone.
export const typingIn = (
  target: { isContentEditable?: boolean; tagName?: string } | null,
): boolean =>
  Boolean(
    target &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT"),
  )

// Whether the chat shows: not laid out away nor invisible, as under Pages or an app, which keep it mounted with visibility hidden.
export const chatShown = (
  box: { checkVisibility: (options?: { visibilityProperty?: boolean }) => boolean } | null,
): boolean => box?.checkVisibility({ visibilityProperty: true }) ?? false

// The jump a key asks for: Alt+↑ or Alt+↓ alone, outside a text field, while the chat shows (not under Pages or an app).
export const jumpKey = (event: {
  altKey: boolean
  ctrlKey: boolean
  key: string
  metaKey: boolean
  shiftKey: boolean
  shown: boolean
  target: { isContentEditable?: boolean; tagName?: string } | null
}): "down" | "up" | null => {
  if (!event.shown || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null
  if (typingIn(event.target)) return null
  return event.key === "ArrowUp" ? "up" : event.key === "ArrowDown" ? "down" : null
}

// Reading's count: the rows that arrived below the last one there when it went to Reading (before) that the observer has reported below the view and never in it, so older rows loaded above never count, nor a step landing in view before the observer reports it.
export const newCount = (
  rows: string[],
  before: ReadonlySet<string>,
  marks: ReadonlyMap<string, StepMark>,
): number =>
  rows
    .slice(rows.findLastIndex((key) => before.has(key)) + 1)
    .filter((key) => !before.has(key) && marks.get(key) === "below").length

// The parts the stream draws a row for, each under its own step's key.
const DRAWN_PARTS = new Set(["dynamic-tool", "reasoning", "text"])

// A turn's part's key: the step it came from, so the steps that stay keep their rows as a long turn's oldest are dropped.
export const partKey = (
  message: { id: string; metadata?: { steps?: string[] } },
  i: number,
): string => message.metadata?.steps?.[i] ?? `${message.id}:${i}`

// What Reading counts: each step of a session's turn as the stream draws it (its words, its thinking, each tool call), so a step landing in a turn already in view counts; any other row counts once, under its row's key.
export const countKeys = (
  key: string,
  message: {
    id: string
    metadata?: { kind?: string; steps?: string[] }
    parts: { type: string }[]
  } | null,
): string[] =>
  message?.metadata?.kind === "assistant"
    ? message.parts.flatMap((part, i) => (DRAWN_PARTS.has(part.type) ? [partKey(message, i)] : []))
    : [key]

// The observer behind the count: the view grown up without end, so a step above it is seen, whether Scroll to end passed it or Load older put it there, and a threshold just over 0, so a step reports as some of its height comes into view.
export const SEEN_OBSERVER = { rootMargin: "1000000px 0px 0px 0px", threshold: [0, 1e-6] }

// Where the observer last put a step: below the view, or seen once some of its height has been at or above the view's bottom (never by touching its edge), which it stays.
export type StepMark = "below" | "seen"
export const markSteps = (
  was: ReadonlyMap<string, StepMark>,
  entries: { height: number; key: string | undefined }[],
): ReadonlyMap<string, StepMark> => {
  let next: Map<string, StepMark> | null = null
  for (const { height, key } of entries) {
    const mark = height > 0 ? "seen" : "below"
    const now = key ? (next ?? was).get(key) : undefined
    if (!key || now === "seen" || now === mark) continue
    next ??= new Map(was)
    next.set(key, mark)
  }
  return next ?? was
}

// The count as the toggle shows it, capped.
export const countLabel = (count: number): string => (count > 99 ? "99+" : String(count))

// The keys that can scroll the stream, the ones shadcn's MessageScroller reads as his intent.
export const SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  " ",
])

// Whether a key he pressed moved the view: a scroll key after which the stream's scrollTop changed. Where focus sits does not say: a Space in a card's text field or an arrow on its options bubbles to the stream and scrolls nothing, while PageUp on a tool row's button scrolls it.
export const keyMovedView = (key: string, before: number, after: number): boolean =>
  SCROLL_KEYS.has(key) && Math.abs(after - before) > 0.5

// How many frames a scroll key's move is waited for: a key scrolls smoothly, starting a frame or two late and done in about 10 (PageUp at 390px wide had moved nothing by the second frame), and a move that starts later is not the key's.
export const KEY_SCROLL_FRAMES = 12

// Watches the view after a key he pressed, and calls moved the first frame it shows the key moved it.
export function watchKeyScroll(
  key: string,
  read: () => number,
  moved: () => void,
  nextFrame: (run: () => void) => void = requestAnimationFrame,
): void {
  if (!SCROLL_KEYS.has(key)) return
  const before = read()
  let frames = 0
  const check = () => {
    if (keyMovedView(key, before, read())) moved()
    else if (++frames < KEY_SCROLL_FRAMES) nextFrame(check)
  }
  nextFrame(check)
}

// The scroller's settings for a stream, over shadcn's MessageScroller: an anchor, his message or a reply's first line, rests 12px below the top, with none of the step before it peeking above (its stock 64px left the last lines of the previous reply in view, cut mid-line), and every row is laid out at its real height, since the stock item's content-visibility guess (10rem a row) put the anchor and its spacer at the wrong place.
export const STREAM_SCROLL = { scrollMargin: 12, scrollPreviousItemPeek: 0 } as const
export const STREAM_ROW = "[content-visibility:visible] [contain-intrinsic-size:none]"

// A row's key in the stream: a delivered entry takes the id of the message that sent it, so the pending bubble's element carries on as the entry and the scroller keeps its anchor.
export const rowKey = (entryId: string, sent: Sent | null): string => sent?.id ?? entryId

// The room under the stream's last row while an anchor leads, as langsdk's min-height on its newest turn keeps it: enough that the anchor can rest at the top, given back pixel for pixel as the turn grows, so the stream's height holds still and a turn past the screen leaves only the content's own room under its last row, whether or not his wheel has let go of the anchor. Offsets are the content's own: where the anchor's row starts and where the last row ends, with the box's height and the scroller's margin above the anchor.
export const turnRoom = ({
  anchorTop,
  height,
  lastBottom,
  margin,
}: {
  anchorTop: number
  height: number
  lastBottom: number
  margin: number
}): number => Math.max(0, Math.ceil(anchorTop - margin + height - lastBottom))

// The room the stream holds: what the anchor needs, but never so little that the stream ends above the view's own bottom edge, where the browser would pull the view up against his scroll. So the room only shrinks as the turn grows, pixel for pixel, as langsdk's min-height does, never when an anchor changes or he frees the view. viewBottom and lastBottom (the last row's end with the content's own room under it) are in the content's own pixels. While the view follows the end, held is the room held now, which it never grows past: the view's bottom moves with the room it measures, so a sub-pixel there would round it up a pixel at a time.
export const heldRoom = ({
  held,
  lastBottom,
  need,
  viewBottom,
}: {
  held?: number
  lastBottom: number
  need: number
  viewBottom: number
}): number => {
  const room = Math.max(need, Math.ceil(viewBottom - lastBottom), 0)
  return held === undefined ? room : Math.min(room, held)
}

type ScrollBox = { clientHeight: number; scrollHeight: number; scrollTop: number }

// While Reading, Scroll to end shows only for rows that stay below the view: more than about a row of them past the view's bottom, the room held under the last row aside (turnRoom), for TO_LATEST_HOLD_MS with the view still.
export const TO_LATEST_PAST = 48
export const TO_LATEST_HOLD_MS = 300

// Whether Scroll to end shows: rows have stayed past the bottom, the view still, for the whole hold.
export const showsToLatest = (since: number | null, now: number): boolean =>
  since !== null && now - since >= TO_LATEST_HOLD_MS

// When rows last began to stay past the view's bottom, else null: a scroll (a send's glide, his own) starts the hold again while it runs, and once it has run the button stays while rows stay past, so his own scroll never blinks it. past is how far the last row's end sits below the view's bottom.
export const pastSince = ({
  moved,
  now,
  past,
  since,
}: {
  moved: boolean
  now: number
  past: number
  since: number | null
}): number | null =>
  past <= TO_LATEST_PAST
    ? null
    : since === null || (moved && !showsToLatest(since, now))
      ? now
      : since

// Whether the view sits at the very end of the stream, to within a pixel.
export const endOf = (box: ScrollBox): boolean =>
  box.scrollTop + box.clientHeight >= box.scrollHeight - 1

// How near the end a Watching view reads what sits in it: a row shrinking at the end by more than the gap below the view pulls it up, and the status line, the usual shrink, is well under this.
export const READS_NEAR = 120

// Whether a scroll reads what sits at the middle of the view: always while Reading, and while Watching only within READS_NEAR of the end, where a row shrinking can pull the view up, so the glide's frames further back read no layout.
export const readsView = (mode: ChatMode, box: ScrollBox): boolean =>
  mode === "reading" || box.scrollHeight - box.scrollTop - box.clientHeight < READS_NEAR

// Whether the browser pulled the view up on its own: it sits above where it was, and what sat at the middle of the view moved down the screen by rowShift (viewShift), as it does when the content under the view shrank and the scroll position was cut to the new end, or when the room under the view is held and the browser's scroll anchoring followed a row below it that shrank. Rows dropped above the view also lower the scroll position, but leave what is in view where it sat (rowShift 0), and once that has been dropped too (null), where the view sat says nothing, so nothing is put back.
export const pulledUp = (box: ScrollBox, before: number, rowShift: number | null): boolean =>
  box.scrollTop < before - 0.5 && rowShift !== null && rowShift > 0.5

// Whether the view's move since it was last seen (shift) is his own scroll, which its scroll event reads: his hand moves, and what sat in view moved on screen with the view (rowShift the move's opposite), where the browser's anchoring after rows dropped above moves the scroll position and holds the rows (rowShift 0).
export const handShift = (handMoves: boolean, shift: number, rowShift: number | null): boolean =>
  handMoves && rowShift !== null && Math.abs(shift) > 0.5 && Math.abs(rowShift + shift) <= 1

// How far the view's content moved down the screen since it was last seen, from where an element at the middle of the view and the row holding it sat then (at, row) and sit now, null for one that has gone: the element's own move, else its row's when the element has gone (the status line leaving as a turn ends), else unknown.
export const viewShift = (
  seen: { at: number; row: number },
  now: { at: number | null; row: number | null },
): number | null =>
  now.at !== null ? now.at - seen.at : now.row !== null ? now.row - seen.row : null

// How long the chat follows its end after its first rows show, while late rows (a tool row's output, an image's box) still grow it, so it opens at the end in either mode.
export const OPEN_FOLLOW_MS = 1000

// Whether the view still follows its end as the chat opens: its first rows showed under OPEN_FOLLOW_MS ago, and he has neither moved the view nor sent.
export const opensAtEnd = ({
  handAt,
  now,
  openedAt,
  sent,
}: {
  handAt: number
  now: number
  openedAt: number | null
  sent: boolean
}): boolean =>
  openedAt !== null &&
  now - openedAt < OPEN_FOLLOW_MS &&
  handAt === Number.NEGATIVE_INFINITY &&
  !sent

// Whether his wheel turns Reading to Watching on its own: a wheel down that reaches the very end, read as it turns, since a view already at the end scrolls nothing and so fires no scroll for ownEnd to read, and the room under a send cut as his scroll lands can clamp the view back up before its scroll event.
export const wheelsToEnd = (box: ScrollBox, mode: ChatMode, deltaY: number): boolean =>
  mode === "reading" &&
  deltaY > 0 &&
  box.scrollTop + box.clientHeight + deltaY >= box.scrollHeight - 1

// Whether his wheel moves a block inside the view first, a code block or table that can still scroll its way, so the view itself stays where it is.
export const scrollsInside = (target: Element | null, box: Element, deltaY: number): boolean => {
  for (let el = target; el && el !== box; el = el.parentElement) {
    const room = deltaY > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop
    if (room > 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return true
  }
  return false
}

// Whether an end the view arrived at is his: its last scroll moved it down (his wheel, a drag of the scrollbar, a key), never one the room's cut brings to him after his scroll up, which moves nothing. delta is that last scroll's change in scrollTop.
export const ownEnd = (delta: number, way: HandWay): boolean => delta > 0.5 && way !== "up"
