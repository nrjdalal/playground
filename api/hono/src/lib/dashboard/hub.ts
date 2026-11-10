import { statSync, watch, type FSWatcher } from "node:fs"

import { getSessionNames, type SessionNames } from "@packages/config/kinds"
import { env } from "@packages/env/api-hono"

import { ActivityWatch, everyInterval, type ActivitySend } from "@/lib/dashboard/activity"
import { onFixtureChange, readsLive } from "@/lib/dashboard/fixture"
import { herdrEvents, type HerdrEvents, herdrServers } from "@/lib/dashboard/herdr"
import { sdkHost } from "@/lib/dashboard/sdk"
import { readScreen } from "@/lib/dashboard/terminal"
import {
  awaitsSource,
  completeLines,
  NEWLINE,
  parseLines,
  TAIL_BYTES,
  type Entry,
} from "@/lib/dashboard/transcript"
import { DISPATCHER, DISPATCHERS, listLive, type Live, type Worker } from "@/lib/dashboard/workers"

export type DashboardFrame =
  | { type: "entries"; entries: Entry[]; sessionId: string }
  // dispatcher, on both board frames: the name of the session whose chat is the dashboard's home, so the dashboard knows it while no such session is live or the sessions cannot be read; dispatchers, every name the dispatcher role goes to, that one first, so the sidebar's header draws a row for each (#i520); names, the managers' session names, so the web places a name as the API does.
  | {
      code: string
      dispatcher: string
      dispatchers: readonly string[]
      message: string
      names: SessionNames
      type: "error"
    }
  // approvals: whether a session's permission and plan prompts may be answered from the dashboard (PLAYGROUND_APPROVALS_ENABLED), so their cards say when they cannot; restoring: a restore can still bring the dispatcher back (restoring() in herdr.ts), so the home says the factory is coming back rather than offering Start.
  | {
      approvals: boolean
      dispatcher: string
      dispatchers: readonly string[]
      names: SessionNames
      restoring: boolean
      type: "workers"
      workers: Worker[]
    }

type Listener = (frame: DashboardFrame) => void

const REFRESH_DEBOUNCE_MS = 300
// Spaces the hub's own refreshes, each of which reads every herdr server.
const REFRESH_GAP_MS = 1000
const SAFETY_REFRESH_MS = 10_000
const REFRESH_TIMEOUT_MS = 8_000

// Every herdr event moves the board (a pane opening, exiting, closing or moving, or a state change), and so does a (re)connect ack; a heartbeat or a line that does not parse does not.
export const movesTheBoard = (line: string): boolean => {
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    return false
  }
  if (typeof event !== "object" || event === null) return false
  const { type } = event as { type?: unknown }
  return type === "ack" || type === "event"
}

// A slow sessions read would hold the board on its old frame, so a refresh gives up after a while with an error frame; the next starts once that read settles, which readServer()'s deadline in herdr.ts bounds.
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error("the sessions read did not answer in time"), {
            code: "SESSIONS_FAILED",
          }),
        ),
      ms,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })

// Pure: each working session's surface, the only sessions whose screen the activity line may read.
export const working = (live: Live | null): Map<string, string> =>
  new Map(
    (live?.workers ?? []).flatMap((worker) => {
      const surface = live?.surfaces.get(worker.sessionId)
      return worker.light === "working" && surface ? [[worker.sessionId, surface] as const] : []
    }),
  )

// One process-wide feed shared by every open board: it follows herdr's events, re-lists the workers when a session's state moves, and tails each live session's transcript for new entries. It starts with the first subscriber and stops with the last.
export class DashboardHub {
  constructor(
    private readonly deps: {
      approvals?: boolean
      events: boolean
      // herdr's events on one stream, every server's (herdr.ts), or null where this machine runs none; herdrEvents() for every server a stack that reads this machine names unless a test stubs it.
      herdr?: () => HerdrEvents | null
      listLive: typeof listLive
      // Reads one session's herdr pane for the activity line (terminal.ts) unless a test stubs it.
      readScreen?: (surface: string) => Promise<string>
      refreshGapMs?: number
      refreshTimeoutMs?: number
      stat?: (path: string) => { birthtimeMs: number; size: number }
      // Watches one transcript for changes, fs.watch unless a test fires the change itself: FSEvents drops a file's change under load.
      watch?: (path: string, onChange: () => void) => Pick<FSWatcher, "close">
    } = { events: true, listLive, refreshGapMs: REFRESH_GAP_MS },
  ) {
    this.activity = new ActivityWatch({
      every: everyInterval,
      read: deps.readScreen ?? ((surface) => readScreen(surface, 40)),
    })
  }

  private listeners = new Set<Listener>()
  private readonly activity: ActivityWatch
  private herdr: HerdrEvents | null = null
  private unwatchFixture: (() => void) | null = null
  private unwatchHosted: (() => void) | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private refreshAt = 0
  private refreshedAt = 0
  private safetyTimer: ReturnType<typeof setInterval> | null = null
  // midLine: the offset was set inside the file rather than at a line's end, so the first read starts after the first newline. unnamed: the last read's last line, a message whose image's source line it ended before.
  private tails = new Map<
    string,
    {
      midLine: boolean
      offset: number
      path: string
      reading: Promise<void>
      unnamed: string | null
      watcher: Pick<FSWatcher, "close">
    }
  >()
  private last: DashboardFrame | null = null
  private live: Live | null = null
  private generation = 0
  private refreshing = false
  // The live read a refresh started, kept until it settles even after the refresh gave up on it, so a slow read never has a second one started beside it.
  private reading: Promise<Live> | null = null
  private dirty = false
  // When this run of the hub started, and whether it has listed the transcripts once: a transcript created since it started holds nothing any view has been sent.
  private startedAt = 0
  private scanned = false

  get watching(): number {
    return this.tails.size
  }

  // The newest live list a refresh read while anyone is subscribed, so a route can answer from what the dashboard already streams rather than reading the sessions again. A refresh that failed leaves none, so a route reads them itself and meets the same failure.
  get snapshot(): Live | null {
    return this.live
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    if (this.last) listener(this.last)
    if (this.listeners.size === 1) this.start()
    else this.scheduleRefresh()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  // A client opened sessionId's chat: it gets that session's activity (an ActivityFrame on its own socket, apart from the DashboardFrames every board gets) while the session works, read only while some client watches it. A watch is held from the moment it arrives, even before the hub's first list, but only a session the hub lists as working is ever read, so one it does not know is never read. The returned function closes the watch.
  watch(sessionId: string, send: ActivitySend): () => void {
    return this.activity.watch(sessionId, send)
  }

  private broadcast(frame: DashboardFrame) {
    for (const listener of this.listeners) listener(frame)
  }

  // A fixture's own writes say when its state moves, and a stack that reads this machine follows herdr's events. A session the dashboard hosts says so itself.
  private start() {
    this.startedAt = Date.now()
    this.unwatchHosted = sdkHost.onChange(() => this.scheduleRefresh())
    if (this.deps.events && !readsLive())
      this.unwatchFixture = onFixtureChange(() => this.scheduleRefresh())
    this.startHerdr()
    this.safetyTimer = setInterval(() => this.scheduleRefresh(), SAFETY_REFRESH_MS)
    this.scheduleRefresh()
  }

  private stop() {
    this.generation += 1
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    if (this.safetyTimer) clearInterval(this.safetyTimer)
    this.refreshTimer = this.safetyTimer = null
    this.unwatchFixture?.()
    this.unwatchFixture = null
    this.unwatchHosted?.()
    this.unwatchHosted = null
    this.dirty = false
    const herdr = this.herdr
    this.herdr = null
    herdr?.kill()
    for (const tail of this.tails.values()) tail.watcher.close()
    this.tails.clear()
    this.last = null
    this.live = null
    this.activity.close()
    this.scanned = false
  }

  // herdr's stream reconnects by itself and ends only when killed, and every board reads herdr afresh, so a move refreshes the board. herdrServers() names none on a hosted or refused stack, and on a fixture stack the fixture's own server, whose events herdrEvents skips.
  private startHerdr() {
    const servers = this.deps.herdr || !this.deps.events ? [] : herdrServers()
    const events = this.deps.herdr?.() ?? (servers.length ? herdrEvents(servers) : null)
    if (!events) return
    this.herdr = events
    void (async () => {
      const decoder = new TextDecoder()
      let buffered = ""
      try {
        for await (const chunk of events.stdout) {
          buffered += decoder.decode(chunk, { stream: true })
          const lines = buffered.split("\n")
          buffered = lines.pop() ?? ""
          if (lines.some(movesTheBoard)) this.scheduleRefresh()
        }
      } catch {}
    })()
  }

  // An earlier refresh replaces a later one already set.
  private scheduleRefresh() {
    if (this.listeners.size === 0) return
    const at = Math.max(
      Date.now() + REFRESH_DEBOUNCE_MS,
      this.refreshedAt + (this.deps.refreshGapMs ?? 0),
    )
    if (this.refreshTimer) {
      if (this.refreshAt <= at) return
      clearTimeout(this.refreshTimer)
    }
    this.refreshAt = at
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh()
    }, at - Date.now())
  }

  // One refresh at a time: a change during one marks the board dirty and runs it again after, so the newest snapshot is always the last one sent. A snapshot that returns after the last viewer left, or after a restart, is dropped.
  private async refresh() {
    if (this.refreshing || this.reading) {
      this.dirty = true
      return
    }
    this.refreshing = true
    this.refreshedAt = Date.now()
    const generation = this.generation
    try {
      let frame: DashboardFrame
      let live: Live | null = null
      try {
        const reading = this.deps.listLive()
        this.reading = reading
        const settled = () => {
          this.reading = null
          if (this.dirty && !this.refreshing) {
            this.dirty = false
            this.scheduleRefresh()
          }
        }
        reading.then(settled, settled)
        live = await withTimeout(reading, this.deps.refreshTimeoutMs ?? REFRESH_TIMEOUT_MS)
        const approvals = this.deps.approvals ?? env.PLAYGROUND_APPROVALS_ENABLED
        frame = {
          approvals,
          dispatcher: DISPATCHER,
          dispatchers: DISPATCHERS,
          names: getSessionNames(),
          restoring: live.restoring === true,
          type: "workers",
          workers: live.workers,
        }
      } catch (err) {
        const code = err instanceof Error && "code" in err ? String(err.code) : "SESSIONS_FAILED"
        frame = {
          code,
          dispatcher: DISPATCHER,
          dispatchers: DISPATCHERS,
          message: err instanceof Error ? err.message : "the sessions read failed",
          names: getSessionNames(),
          type: "error",
        }
      }
      if (generation !== this.generation || this.listeners.size === 0) return
      // a failed read leaves every tail open, so each is read again as on a good one
      if (live) this.syncTails(live.transcripts)
      else for (const sessionId of this.tails.keys()) this.queueRead(sessionId)
      this.live = live
      this.activity.update(working(live))
      this.last = frame
      this.broadcast(frame)
    } finally {
      this.refreshing = false
      if (this.dirty) {
        this.dirty = false
        this.scheduleRefresh()
      }
    }
  }

  // Tail every live session's transcript: new lines become entries frames; a session that ended stops being watched. A transcript created since the hub started is read from its start (its last TAIL_BYTES when larger): a new session writes its first prompt, with a burst of attachments, before the hub sees the file, and a tail from the end would never send that prompt (the web merges entries by id, so one it already fetched is not doubled). One created earlier is read from its current end, its history being the view's to fetch, so a restarted dashboard sends no burst of old entries.
  private syncTails(transcripts: Map<string, string>) {
    for (const [sessionId, tail] of this.tails) {
      if (transcripts.get(sessionId) === tail.path) continue
      tail.watcher.close()
      this.tails.delete(sessionId)
    }
    for (const [sessionId, path] of transcripts) {
      // a lost change event leaves its lines past the offset, so a refresh reads an open tail again (herdr.md); a read with nothing past the offset ends at once.
      if (this.tails.has(sessionId)) {
        this.queueRead(sessionId)
        continue
      }
      try {
        // stat before watch, so a file gone between the two leaves no watcher behind.
        const { birthtimeMs, size } = (this.deps.stat ?? statSync)(path)
        // A filesystem that keeps no creation time reports 0; then a transcript is new when it appears after the hub's first look.
        const fresh = birthtimeMs > 0 ? birthtimeMs >= this.startedAt : this.scanned
        // A new transcript is read from as far back as a view's own history read reaches, so one that starts large (a forked session copies its conversation into a new file) costs one bounded read.
        const offset = fresh ? Math.max(0, size - TAIL_BYTES) : size
        const watcher = (this.deps.watch ?? watch)(path, () => this.queueRead(sessionId))
        this.tails.set(sessionId, {
          midLine: offset > 0 && offset < size,
          offset,
          path,
          reading: Promise.resolve(),
          unnamed: null,
          watcher,
        })
        if (offset < size) this.queueRead(sessionId)
      } catch {
        // A transcript not yet written has nothing to tail; the next refresh tries again.
      }
    }
    this.scanned = true
  }

  // Reads of one transcript run one at a time, so two change events never read the same bytes twice.
  private queueRead(sessionId: string) {
    const tail = this.tails.get(sessionId)
    if (!tail) return
    tail.reading = tail.reading.then(() => this.readTail(sessionId)).catch(() => {})
  }

  private async readTail(sessionId: string) {
    const tail = this.tails.get(sessionId)
    if (!tail) return
    const size = Bun.file(tail.path).size
    if (size <= tail.offset) return
    let bytes = new Uint8Array(await Bun.file(tail.path).slice(tail.offset, size).arrayBuffer())
    if (tail.midLine) {
      const start = bytes.indexOf(NEWLINE) + 1
      if (start === 0) return
      tail.offset += start
      tail.midLine = false
      bytes = bytes.subarray(start)
    }
    const { consumed, text } = completeLines(bytes)
    if (consumed === 0) return
    tail.offset += consumed
    // Claude Code names a message's image on a source line written after it, so a message a read ended on is read again with the next read's lines, which send it with its image named.
    const entries = parseLines(tail.unnamed ? `${tail.unnamed}\n${text}` : text)
    const last = text.slice(text.lastIndexOf("\n", text.length - 2) + 1, -1)
    tail.unnamed = last.includes("[Image #") && awaitsSource(last) ? last : null
    if (entries.length > 0) this.broadcast({ type: "entries", entries, sessionId })
    // A session waiting on the owner writes again only once the owner has answered it, which herdr may not report until its turn ends.
    const waiting = this.live?.workers.some(
      (w) => w.sessionId === sessionId && w.light === "needs-you",
    )
    if (waiting) this.scheduleRefresh()
  }
}

export const dashboardHub = new DashboardHub()

// How long the board stays subscribed after the last read, so the hosted relay's read every 5 s takes the newest frame rather than starting the hub's feed and a full refresh each time.
export const BOARD_HOLD_MS = 30_000

// The board as the socket sends it, for a client with no socket (the hosted relay, which carries requests and no live frames): the newest board frame while it holds a subscription, held holdMs past the last read; null when none comes within timeoutMs.
export function boardReader(
  hub: Pick<DashboardHub, "subscribe"> = dashboardHub,
  { holdMs = BOARD_HOLD_MS, timeoutMs = 10_000 }: { holdMs?: number; timeoutMs?: number } = {},
): () => Promise<DashboardFrame | null> {
  let latest: DashboardFrame | null = null
  let leave: (() => void) | null = null
  let idle: ReturnType<typeof setTimeout> | null = null
  const waiters = new Set<(frame: DashboardFrame | null) => void>()
  const stop = () => {
    leave?.()
    leave = null
    latest = null
  }
  return () => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(stop, holdMs)
    idle.unref?.()
    leave ??= hub.subscribe((frame) => {
      if (frame.type === "entries") return
      latest = frame
      for (const waiter of waiters) waiter(frame)
    })
    if (latest) return Promise.resolve(latest)
    return new Promise((resolve) => {
      const done = (frame: DashboardFrame | null) => {
        waiters.delete(done)
        clearTimeout(timer)
        resolve(frame)
      }
      const timer = setTimeout(() => done(null), timeoutMs)
      waiters.add(done)
    })
  }
}

// The dashboard's one reader, for GET /api/v1/board.
export const boardFrame = boardReader()
