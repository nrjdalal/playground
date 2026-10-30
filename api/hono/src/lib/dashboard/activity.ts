import { z } from "zod"

// What a working session is doing right now, read from Claude Code's spinner line as `cmux read-screen` shows it above the input box: a cycling glyph, one verb ending in "…", then in parentheses its parts split by " · " (the elapsed time, the tokens with their arrow, and sometimes "thought for Ns" or "esc to interrupt"):
//   ✻ Whisking… (1m 11s · ↓ 2.1k tokens · thought for 4s)
// Only these parsed values ever leave the dashboard, never the screen's text, which can hold anything the session showed: the verb is letters alone and the rest are numbers.
export type Activity = {
  // Seconds since the step began.
  elapsed: number | null
  // Seconds spent thinking, when the line says so.
  thought: number | null
  // Tokens so far, as a whole number (2.1k is 2100).
  tokens: number | null
  // The spinner's word, without its "…": Whisking, Formulating.
  verb: string
}

const GLYPHS = "✻✽✶✳✢·*"

// The glyph, the verb and its "…", then the parenthesised parts. A verb is one word of letters, joined by a hyphen or an apostrophe as Claude Code's own are (Flambéing, Topsy-turvying, Beboppin'), so no digit, space or other text can ride in it.
const LINE_RE = new RegExp(
  `^[${GLYPHS}]\\s+(\\p{L}{2,30}(?:[-'’]\\p{L}{1,30}){0,3}'?)(?:…|\\.\\.\\.)\\s+\\((.*)\\)\\s*$`,
  "u",
)

const DURATION_RE = /^(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?$/

// Pure: "1m 11s" as 71, "2h 3m" as 7380; null for anything else.
export function seconds(text: string): number | null {
  const match = DURATION_RE.exec(text.trim())
  if (!match || !text.trim() || match.slice(1).every((part) => part === undefined)) return null
  const [, h = "0", m = "0", s = "0"] = match
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

const TOKENS_RE = /^[↓↑]?\s*(\d+(?:\.\d+)?)\s*([kKmM]?)\s+tokens?$/

// Pure: "↓ 2.1k tokens" as 2100; null for anything else.
export function tokenCount(text: string): number | null {
  const match = TOKENS_RE.exec(text.trim())
  if (!match) return null
  const scale = { "": 1, k: 1_000, m: 1_000_000 }[match[2]?.toLowerCase() ?? ""] ?? 1
  return Math.round(Number(match[1]) * scale)
}

const THOUGHT_RE = /^thought for\s+(.+)$/i

// Pure: the activity the screen's spinner line shows, the lowest one on the screen; null when the session shows none (idle). Each part is read by its shape and any part of another shape is ignored, so a new part never breaks it.
export function parseActivity(screen: string): Activity | null {
  const lines = screen.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = LINE_RE.exec(lines[i]?.trim() ?? "")
    if (!match) continue
    const activity: Activity = {
      elapsed: null,
      thought: null,
      tokens: null,
      verb: match[1] ?? "",
    }
    for (const part of (match[2] ?? "").split(" · ")) {
      const thought = THOUGHT_RE.exec(part.trim())
      if (thought) {
        activity.thought ??= seconds(thought[1] ?? "")
        continue
      }
      const count = tokenCount(part)
      if (count !== null) {
        activity.tokens ??= count
        continue
      }
      const elapsed = seconds(part)
      if (elapsed !== null) activity.elapsed ??= elapsed
    }
    return activity
  }
  return null
}

// Pure: whether two readings say the same, so the hub sends a frame only on a change.
export const sameActivity = (a: Activity | null, b: Activity | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.verb === b.verb &&
    a.elapsed === b.elapsed &&
    a.tokens === b.tokens &&
    a.thought === b.thought)

// The frame a session's viewers get: its activity, or null once it stops (it went idle).
export type ActivityFrame = { activity: Activity | null; sessionId: string; type: "activity" }

export type ActivitySend = (frame: ActivityFrame) => void

export type ActivityDeps = {
  // Reads one surface's screen; the hub passes cmux's read-screen through run(), so no new cmux command.
  read: (surface: string) => Promise<string>
  // Calls tick every ms until the returned stop is called.
  every: (ms: number, tick: () => void) => () => void
  // The clock the once-a-second limit reads; Date.now unless a test drives it.
  now?: () => number
}

export const ACTIVITY_INTERVAL_MS = 1_000

// A timer may fire a little early; a read this close to a second after the last still goes.
const THROTTLE_SLACK_MS = 50

// How long a session's last read is kept after its last viewer leaves.
const RECENT_KEEP_MS = 60_000

// The real clock: tick every ms on a timer.
export const everyInterval: ActivityDeps["every"] = (ms, tick) => {
  const timer = setInterval(tick, ms)
  return () => clearInterval(timer)
}

type Watched = {
  inFlight: boolean
  last: Activity | null
  stop: (() => void) | null
  viewers: Set<ActivitySend>
}

// Reads a session's screen only while it is working and at least one client has its chat open, at most once a second, and tells only those clients, only when what it shows changes. A session with no viewer, or one that is not working, is never read, so the dashboard never polls every working session.
export class ActivityWatch {
  private readonly sessions = new Map<string, Watched>()
  // Each session's last read and what it showed, kept past its last viewer so a watch sent again within the second reuses it rather than reading again.
  private readonly recent = new Map<string, { at: number; last: Activity | null }>()
  private working = new Map<string, string>()

  constructor(private readonly deps: ActivityDeps & { intervalMs?: number }) {}

  // How many sessions are being read now.
  get reading(): number {
    return [...this.sessions.values()].filter((s) => s.stop).length
  }

  // A client's chat on sessionId is open: it gets the activity now (one read) and then on each change. The returned function closes it.
  watch(sessionId: string, send: ActivitySend): () => void {
    const watched = this.sessions.get(sessionId) ?? {
      inFlight: false,
      last: null,
      stop: null,
      viewers: new Set<ActivitySend>(),
    }
    this.sessions.set(sessionId, watched)
    watched.viewers.add(send)
    if (watched.stop) {
      if (watched.last) send({ activity: watched.last, sessionId, type: "activity" })
    } else this.sync(sessionId)
    return () => {
      watched.viewers.delete(send)
      if (watched.viewers.size > 0 || this.sessions.get(sessionId) !== watched) return
      watched.stop?.()
      watched.stop = null
      this.sessions.delete(sessionId)
    }
  }

  // The sessions working now, each with its surface, from the hub's newest list: reading starts for a watched one that began working and stops, with one clearing frame, for one that no longer is.
  update(working: Map<string, string>) {
    this.working = working
    for (const [sessionId, read] of this.recent) {
      if (this.now() - read.at > RECENT_KEEP_MS) this.recent.delete(sessionId)
    }
    for (const sessionId of this.sessions.keys()) this.sync(sessionId)
  }

  // Stops every read, as the hub does when its last subscriber leaves.
  close() {
    for (const watched of this.sessions.values()) watched.stop?.()
    this.sessions.clear()
  }

  private sync(sessionId: string) {
    const watched = this.sessions.get(sessionId)
    if (!watched) return
    const surface = this.working.get(sessionId)
    if (surface && watched.viewers.size > 0) {
      if (watched.stop) return
      const tick = () => void this.read(sessionId, watched)
      watched.stop = this.deps.every(this.interval, tick)
      const recent = this.recent.get(sessionId)
      if (recent && this.now() - recent.at < this.interval) {
        if (recent.last) this.emit(sessionId, watched, recent.last)
      } else tick()
      return
    }
    if (!watched.stop) return
    watched.stop()
    watched.stop = null
    if (watched.last) this.emit(sessionId, watched, null)
  }

  private async read(sessionId: string, watched: Watched) {
    const surface = this.working.get(sessionId)
    if (!surface || watched.inFlight || !watched.stop) return
    const at = this.now()
    const recent = this.recent.get(sessionId)
    if (recent && at - recent.at < this.interval - THROTTLE_SLACK_MS) return
    this.recent.set(sessionId, { at, last: recent?.last ?? null })
    watched.inFlight = true
    let activity: Activity | null = null
    try {
      activity = parseActivity(await this.deps.read(surface))
    } catch {
      activity = null
    } finally {
      watched.inFlight = false
    }
    this.recent.set(sessionId, { at, last: activity })
    if (!watched.stop || this.sessions.get(sessionId) !== watched) return
    if (!sameActivity(watched.last, activity)) this.emit(sessionId, watched, activity)
  }

  private get interval(): number {
    return this.deps.intervalMs ?? ACTIVITY_INTERVAL_MS
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private emit(sessionId: string, watched: Watched, activity: Activity | null) {
    watched.last = activity
    const frame: ActivityFrame = { activity, sessionId, type: "activity" }
    for (const send of watched.viewers) send(frame)
  }
}

// The one message a dashboard client sends over its socket: the chat it has open, or null when none is.
const watchMessageSchema = z.strictObject({
  sessionId: z.string().min(1).max(200).nullable(),
  type: z.literal("watch"),
})

// Pure: the session a socket's message asks to watch ({ sessionId }, null for none), or null for any other message, which the socket ignores.
export function parseWatchMessage(data: unknown): { sessionId: string | null } | null {
  if (typeof data !== "string") return null
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }
  const parsed = watchMessageSchema.safeParse(json)
  return parsed.success ? { sessionId: parsed.data.sessionId } : null
}
