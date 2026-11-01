import { statSync, watch, type FSWatcher } from "node:fs"

import { getSessionNames, type SessionNames } from "@packages/config/kinds"
import { env } from "@packages/env/api-hono"

import { ActivityWatch, everyInterval, type ActivitySend } from "@/lib/dashboard/activity"
import { type CmuxStream, herdrAlone, stream } from "@/lib/dashboard/cmux"
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
import {
  DISPATCHER,
  DISPATCHERS,
  listLive,
  type Live,
  onRead,
  readDue,
  type Worker,
} from "@/lib/dashboard/workers"

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
  // approvals: whether a session's permission and plan prompts may be answered from the dashboard (PLAYGROUND_APPROVALS_ENABLED), so their cards say when they cannot.
  | {
      approvals: boolean
      dispatcher: string
      dispatchers: readonly string[]
      names: SessionNames
      type: "workers"
      workers: Worker[]
    }

type Listener = (frame: DashboardFrame) => void

// How the hub keeps pace with cmux's paced full read (workers.ts): `due` says when a board can hold what moved since a moment, `onRead` when a read lands, and `refreshGapMs` spaces the hub's own refreshes, each of which asks cmux for its Feed and workspaces.
export type Pace = {
  due: (since: number) => number | null
  onRead: (listener: () => void) => () => void
  refreshGapMs: number
}

const REFRESH_DEBOUNCE_MS = 300
const REFRESH_GAP_MS = 1000
const SAFETY_REFRESH_MS = 10_000
const EVENTS_RESTART_MS = 3_000
const REFRESH_TIMEOUT_MS = 8_000

// Tool calls stream through cmux as hook events and Feed telemetry, but only a picker or a message among them changes the board (a message to a manager moves its sender up); prompts, stops and notifications all do.
const TOOL_HOOKS = new Set(["PostToolUse", "PostToolUseFailure", "PreToolUse"])
const BOARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode", "SendMessage"])

export const movesTheBoard = (line: string): boolean => {
  let event: unknown
  try {
    event = JSON.parse(line)
  } catch {
    return false
  }
  if (typeof event !== "object" || event === null) return false
  const { name, payload, type } = event as { name?: unknown; payload?: unknown; type?: unknown }
  if (type === "ack") return true
  if (type !== "event") return false
  const fields =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {}
  const hook =
    typeof fields.hook_event_name === "string"
      ? fields.hook_event_name
      : typeof name === "string"
        ? (name.split(".").at(-1) ?? "")
        : ""
  return !TOOL_HOOKS.has(hook) || BOARD_TOOLS.has(String(fields.tool_name))
}

// A slow cmux read would hold the board on its old frame, so a refresh gives up after a while with an error frame; the next starts once that read settles, which run()'s own timeout bounds.
const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(Object.assign(new Error("cmux did not answer in time"), { code: "CMUX_FAILED" })),
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

// One process-wide feed shared by every open board: it runs `cmux events`, re-lists the workers when a session's state moves, and tails each live session's transcript for new entries. It starts with the first subscriber and stops with the last.
export class DashboardHub {
  constructor(
    private readonly deps: {
      approvals?: boolean
      events: boolean
      // herdr's events on one stream, every server's (herdr.ts), or null where this machine runs none; herdrEvents() for every server a stack that reads this machine names unless a test stubs it.
      herdr?: () => HerdrEvents | null
      listLive: typeof listLive
      pace?: Pace
      // Reads one surface's screen for the activity line, from cmux or herdr (terminal.ts) unless a test stubs it.
      readScreen?: (surface: string) => Promise<string>
      refreshTimeoutMs?: number
      stat?: (path: string) => { birthtimeMs: number; size: number }
      // Watches one transcript for changes, fs.watch unless a test fires the change itself: FSEvents drops a file's change under load.
      watch?: (path: string, onChange: () => void) => Pick<FSWatcher, "close">
    } = { events: true, listLive, pace: { due: readDue, onRead, refreshGapMs: REFRESH_GAP_MS } },
  ) {
    this.activity = new ActivityWatch({
      every: everyInterval,
      read: deps.readScreen ?? ((surface) => readScreen(surface, 40)),
    })
  }

  private listeners = new Set<Listener>()
  private readonly activity: ActivityWatch
  private events: CmuxStream | null = null
  private herdr: HerdrEvents | null = null
  private unwatchFixture: (() => void) | null = null
  private unwatchHosted: (() => void) | null = null
  private eventsRestart: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private refreshAt = 0
  private refreshedAt = 0
  // When the board last moved: each refresh asks for records cmux read since then.
  private movedAt = 0
  private unwatchRead: (() => void) | null = null
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
  // The live read a refresh started, kept until it settles even after the refresh gave up on it, so a slow `sessions list` never has a second one started beside it.
  private reading: Promise<Live> | null = null
  private dirty = false
  // When this run of the hub started, and whether it has listed the transcripts once: a transcript created since it started holds nothing any view has been sent.
  private startedAt = 0
  private scanned = false

  get watching(): number {
    return this.tails.size
  }

  // The newest live list a refresh read while anyone is subscribed, so a route can answer from what the dashboard already streams rather than asking cmux again. A refresh that failed leaves none, so a route asks cmux itself and meets the same failure.
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

  // A fixture has no cmux events: its own writes say when its state moves, and a dashboard that reads herdr alone has herdr's alone. A session the dashboard hosts says so itself.
  private start() {
    this.startedAt = Date.now()
    this.unwatchHosted = sdkHost.onChange(() => this.scheduleRefresh())
    this.unwatchRead = this.deps.pace?.onRead(() => this.scheduleRefresh(false)) ?? null
    if (this.deps.events && readsLive()) {
      if (!herdrAlone()) this.startEvents()
    } else if (this.deps.events) this.unwatchFixture = onFixtureChange(() => this.scheduleRefresh())
    this.startHerdr()
    this.safetyTimer = setInterval(() => this.scheduleRefresh(), SAFETY_REFRESH_MS)
    this.scheduleRefresh()
  }

  private stop() {
    this.generation += 1
    if (this.eventsRestart) clearTimeout(this.eventsRestart)
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    if (this.safetyTimer) clearInterval(this.safetyTimer)
    this.eventsRestart = this.refreshTimer = this.safetyTimer = null
    this.unwatchFixture?.()
    this.unwatchFixture = null
    this.unwatchHosted?.()
    this.unwatchHosted = null
    this.unwatchRead?.()
    this.unwatchRead = null
    this.dirty = false
    const events = this.events
    this.events = null
    events?.kill()
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

  private startEvents() {
    let proc: CmuxStream
    try {
      proc = stream(["events", "--category", "agent", "--category", "feed", "--reconnect"])
    } catch {
      this.retryEvents()
      return
    }
    this.events = proc
    void this.readEvents(proc)
  }

  private retryEvents() {
    if (this.listeners.size === 0) return
    this.eventsRestart = setTimeout(() => this.startEvents(), EVENTS_RESTART_MS)
  }

  // A read that fails (a stream the runtime released under it) ends like an exit: the process goes and a new one starts.
  private async readEvents(proc: CmuxStream) {
    const decoder = new TextDecoder()
    let buffered = ""
    try {
      for await (const chunk of proc.stdout) {
        buffered += decoder.decode(chunk, { stream: true })
        const lines = buffered.split("\n")
        buffered = lines.pop() ?? ""
        if (lines.some(movesTheBoard)) this.scheduleRefresh()
      }
    } catch {
      proc.kill()
    }
    await proc.exited
    if (this.events === proc) {
      this.events = null
      this.retryEvents()
    }
  }

  // herdr's stream reconnects by itself and ends only when killed, and a herdr move needs no new cmux read, since every board reads herdr afresh: so its moves refresh on the cmux records already read. herdrServers() names none on a stack that does not read this machine.
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
          if (lines.some(movesTheBoard)) this.scheduleRefresh(false)
        }
      } catch {}
    })()
  }

  // `moved`: the board may have moved now, so the refresh wants records read from now on; a refresh that only catches up on a read keeps the moment it has. An earlier refresh replaces a later one already set.
  private scheduleRefresh(moved = true, delay = REFRESH_DEBOUNCE_MS) {
    if (this.listeners.size === 0) return
    if (moved) this.movedAt = Date.now()
    const at = Math.max(Date.now() + delay, this.refreshedAt + (this.deps.pace?.refreshGapMs ?? 0))
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
    const since = this.movedAt
    try {
      let frame: DashboardFrame
      let live: Live | null = null
      try {
        const reading = this.deps.listLive({ since, wait: false })
        this.reading = reading
        const settled = () => {
          this.reading = null
          if (this.dirty && !this.refreshing) {
            this.dirty = false
            this.scheduleRefresh(false)
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
          type: "workers",
          workers: live.workers,
        }
      } catch (err) {
        const code = err instanceof Error && "code" in err ? String(err.code) : "CMUX_FAILED"
        frame = {
          code,
          dispatcher: DISPATCHER,
          dispatchers: DISPATCHERS,
          message: err instanceof Error ? err.message : "cmux failed",
          names: getSessionNames(),
          type: "error",
        }
      }
      if (generation !== this.generation || this.listeners.size === 0) return
      if (live) this.syncTails(live.transcripts)
      this.live = live
      this.activity.update(working(live))
      this.last = frame
      this.broadcast(frame)
    } finally {
      this.refreshing = false
      const due = this.deps.pace?.due(since) ?? null
      if (this.dirty) {
        this.dirty = false
        this.scheduleRefresh(false)
      } else if (due !== null) this.scheduleRefresh(false, Math.max(REFRESH_DEBOUNCE_MS, due))
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
      if (this.tails.has(sessionId)) continue
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
    // A session waiting on the owner writes again only once the owner has answered it, which cmux may not report until its turn ends.
    const waiting = this.live?.workers.some(
      (w) => w.sessionId === sessionId && w.light === "needs-you",
    )
    if (waiting) this.scheduleRefresh()
  }
}

export const dashboardHub = new DashboardHub()
