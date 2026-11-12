import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { attachmentsDir } from "../../../../../../api/hono/src/lib/dashboard/attachments"
import {
  boardReader,
  DashboardHub,
  movesTheBoard,
  type DashboardFrame,
} from "../../../../../../api/hono/src/lib/dashboard/hub"
import {
  DISPATCHER,
  DISPATCHERS,
  type Live,
  type Worker,
} from "../../../../../../api/hono/src/lib/dashboard/workers"
import { getSessionNames } from "../../../../../../packages/config/src/kinds"

// The cases hold real timers, and a loaded machine can take a case past bun's 5s default, which equals until's own deadline; 20s leaves the deadline the only clock that decides.
setDefaultTimeout(20_000)

describe("movesTheBoard", () => {
  test("every herdr event does", () => {
    for (const name of [
      "herdr.pane.created",
      "herdr.pane.exited",
      "herdr.pane.agent_status_changed",
    ])
      expect(movesTheBoard(JSON.stringify({ name, type: "event" }))).toBe(true)
  })

  test("a (re)connect ack does; heartbeats and junk do not", () => {
    expect(movesTheBoard(JSON.stringify({ type: "ack" }))).toBe(true)
    expect(movesTheBoard(JSON.stringify({ type: "heartbeat" }))).toBe(false)
    expect(movesTheBoard("not json")).toBe(false)
  })
})

type Deferred = {
  promise: Promise<Live>
  reject: (err: Error) => void
  resolve: (live: Live) => void
}

const deferred = (): Deferred => {
  let reject: (err: Error) => void = () => {}
  let resolve: (live: Live) => void = () => {}
  const promise = new Promise<Live>((r, j) => {
    reject = j
    resolve = r
  })
  return { promise, reject, resolve }
}

const worker = (name: string): Worker => ({
  cwd: "/repo",
  effort: null,
  eta: null,
  failed: false,
  feed: [],
  lastActiveAt: null,
  lifecycle: "running",
  light: "working",
  model: null,
  name,
  questions: [],
  role: "worker",
  sessionId: `s-${name}`,
  startedAt: null,
  task: null,
  tasks: [],
  title: null,
  updatedAt: null,
  workspace: null,
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Each wait targets the frame or call the case checks, with a deadline generous for a loaded machine: a fixed sleep is too short under load and wasted on an idle one.
const until = async (what: string, is: () => boolean, ms = 5_000) => {
  const deadline = Date.now() + ms
  while (!is()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(5)
  }
}

// Windows the negative waits hold for, each proving a read does not start: all well past the 300ms debounce.
const NO_SECOND_READ_MS = 400
const UNREREAD_MS = 500

// A hub with herdr's live list replaced by answers the test releases one at a time.
const hubWith = (
  refreshTimeoutMs?: number,
  stat?: (path: string) => { birthtimeMs: number; size: number },
  refreshGapMs?: number,
) => {
  const calls: Deferred[] = []
  // when each read started, so a case can measure the space between reads from the reads themselves
  const starts: number[] = []
  // each tail's change listener, fired by the case after it appends: fs.watch's FSEvents lost 6 of 15 changes to a file at load5 13
  const watchers = new Map<string, () => void>()
  const changed = (path: string) => watchers.get(path)?.()
  const hub = new DashboardHub({
    events: false,
    listLive: () => {
      starts.push(Date.now())
      const call = deferred()
      calls.push(call)
      return call.promise
    },
    refreshGapMs,
    refreshTimeoutMs,
    stat,
    watch: (path, onChange) => {
      watchers.set(path, onChange)
      return { close: () => watchers.delete(path) }
    },
  })
  return { calls, changed, hub, starts }
}

describe("DashboardHub", () => {
  const dir = mkdtempSync(join(tmpdir(), "dashboard-hub-"))
  const transcript = join(dir, "s.jsonl")
  writeFileSync(transcript, "")
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test("a snapshot that returns after the last viewer left is dropped, and opens no watcher", async () => {
    const { calls, hub } = hubWith()
    const frames: DashboardFrame[] = []
    const unsubscribe = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    unsubscribe()
    calls[0]?.resolve({
      surfaces: new Map(),
      transcripts: new Map([["s-greed", transcript]]),
      workers: [worker("greed")],
    })
    // proves the negative: the settled read sends nothing and opens no watcher
    await sleep(NO_SECOND_READ_MS)
    expect(frames).toEqual([])
    expect(hub.watching).toBe(0)
  })

  // A permission or plan card is read-only unless the dashboard may answer it, so every board says which.
  test("the workers frame says whether approvals are on", async () => {
    const calls: Deferred[] = []
    const hub = new DashboardHub({
      approvals: true,
      events: false,
      listLive: () => {
        const call = deferred()
        calls.push(call)
        return call.promise
      },
    })
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    calls[0]?.resolve({ surfaces: new Map(), transcripts: new Map(), workers: [worker("one")] })
    await until("the workers frame", () => frames.length > 0)
    expect(frames[0]).toMatchObject({
      approvals: true,
      dispatcher: DISPATCHER,
      dispatchers: DISPATCHERS,
      type: "workers",
    })
    leave()
  })

  // #1682: while a restore brings the sessions back, the home says so rather than offering Start.
  test("the workers frame says whether a restore is still bringing sessions back", async () => {
    const calls: Deferred[] = []
    const hub = new DashboardHub({
      events: false,
      listLive: () => {
        const call = deferred()
        calls.push(call)
        return call.promise
      },
    })
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    calls[0]?.resolve({
      restoring: true,
      surfaces: new Map(),
      transcripts: new Map(),
      workers: [worker("one")],
    })
    await until("the workers frame", () => frames.length > 0)
    expect(frames[0]).toMatchObject({ restoring: true, type: "workers" })
    leave()
  })

  // herdr's stream (herdr.ts) moves the board, and it ends with the last viewer
  test("a herdr event refreshes the board, and the stream is killed when the last viewer leaves", async () => {
    let push: (line: string) => void = () => {}
    let killed = false
    let asked = 0
    const hub = new DashboardHub({
      events: false,
      herdr: () => ({
        kill: () => {
          killed = true
        },
        stdout: new ReadableStream<Uint8Array>({
          start: (c) => {
            push = (line) => c.enqueue(new TextEncoder().encode(`${line}\n`))
          },
        }),
      }),
      listLive: async () => {
        asked++
        return { surfaces: new Map(), transcripts: new Map(), workers: [worker("one")] }
      },
    })
    const leave = hub.subscribe(() => {})
    await until("the hub's first read", () => asked === 1)
    await sleep(NO_SECOND_READ_MS)
    push(JSON.stringify({ name: "herdr.pane.agent_status_changed", type: "event" }))
    await until("the refresh the event asks for", () => asked === 2)
    leave()
    expect(killed).toBe(true)
  })

  // The dashboard's home is headed by the dispatcher's name, so a board that cannot be read still names it.
  test("an error frame names the dispatcher too", async () => {
    const hub = new DashboardHub({
      events: false,
      listLive: () =>
        Promise.reject(
          Object.assign(new Error("the registry is down"), { code: "SESSIONS_FAILED" }),
        ),
    })
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    await until("the error frame", () => frames.length > 0)
    expect(frames[0]).toEqual({
      code: "SESSIONS_FAILED",
      dispatcher: DISPATCHER,
      dispatchers: DISPATCHERS,
      message: "the registry is down",
      names: getSessionNames(),
      type: "error",
    })
    leave()
  })

  test("refreshes never overlap, and the newest snapshot is the last one sent", async () => {
    const { calls, hub } = hubWith()
    const frames: DashboardFrame[] = []
    const first = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    const second = hub.subscribe(() => {})
    // proves the negative: no second read starts while the first is in flight
    await sleep(NO_SECOND_READ_MS)
    expect(calls).toHaveLength(1)
    calls[0]?.resolve({ surfaces: new Map(), transcripts: new Map(), workers: [worker("old")] })
    await until("the second read", () => calls.length === 2)
    calls[1]?.resolve({ surfaces: new Map(), transcripts: new Map(), workers: [worker("new")] })
    await until("the workers frames", () => frames.length === 2)
    const names = frames.map((f) => (f.type === "workers" ? f.workers[0]?.name : f.type))
    expect(names).toEqual(["old", "new"])
    first()
    second()
  })

  // A sessions read once took 12.7s at load 19 (9 Oct), longer than a refresh waits, and a new read started beside each slow one stacked them until the live chat went down.
  test("a slow sessions read times out with an error frame, and no new read starts until it settles", async () => {
    const { calls, hub } = hubWith(200)
    const frames: DashboardFrame[] = []
    const first = hub.subscribe((frame) => frames.push(frame))
    await until("the error frame", () => frames.length > 0)
    const second = hub.subscribe(() => {})
    // proves the negative: no new read starts while the timed-out one is still unsettled
    await sleep(NO_SECOND_READ_MS)
    expect(calls).toHaveLength(1)
    calls[0]?.resolve({ surfaces: new Map(), transcripts: new Map(), workers: [worker("late")] })
    await until("the second read", () => calls.length === 2)
    calls[1]?.resolve({ surfaces: new Map(), transcripts: new Map(), workers: [worker("back")] })
    await until("the workers frame after the error", () => frames.length === 2)
    expect(frames.map((f) => f.type)).toEqual(["error", "workers"])
    first()
    second()
  })

  const empty = (): Live => ({ surfaces: new Map(), transcripts: new Map(), workers: [] })

  // Board moves arrived about four a second on 12 Oct; each refresh reads every herdr server, so the hub starts one at most once a gap however many arrive.
  test("a burst of moves runs one refresh a gap", async () => {
    const gap = 1000
    const { calls, hub, starts } = hubWith(undefined, undefined, gap)
    const leaves = [hub.subscribe(() => {})]
    await until("the hub's first read", () => calls.length === 1)
    calls[0]?.resolve(empty())
    // the burst ends once the second read starts, so on a loaded runner every move still lands inside the gap
    for (let i = 0; i < 10; i++) {
      await sleep(50)
      if (calls.length > 1) break
      leaves.push(hub.subscribe(() => {}))
    }
    await until("the second read after the gap", () => calls.length === 2)
    // the gap holds the burst back, measured between the two reads' starts; the 5ms covers the clock ticks between the hub's reads of the time and these stamps
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(gap - 5)
    calls[1]?.resolve(empty())
    for (const leave of leaves) leave()
  })

  const line = (id: string, text: string) =>
    `${JSON.stringify({ message: { content: text, role: "user" }, origin: { kind: "human" }, timestamp: "2026-10-06T00:00:00.000Z", type: "user", uuid: id })}\n`
  const attachment = (bytes: number) =>
    `${JSON.stringify({ attachment: { content: "x".repeat(bytes), type: "skill_listing" }, type: "attachment", uuid: "a-1" })}\n`
  const sentBy = (frames: DashboardFrame[]) =>
    frames.flatMap((f) =>
      f.type === "entries" ? f.entries.map((e) => `${f.sessionId}:${e.text}`) : [],
    )
  // Creation times the test records as it writes each file, so the rule is pinned whatever the runner's filesystem keeps.
  const birthtimes = () => {
    const born = new Map<string, number>()
    return {
      born: (path: string, at = Date.now()) => born.set(path, at),
      stat: (path: string) => ({ birthtimeMs: born.get(path) ?? 0, size: statSync(path).size }),
    }
  }
  const live = (transcripts: [string, string][]): Live => ({
    surfaces: new Map(),
    transcripts: new Map(transcripts),
    workers: transcripts.map(([id]) => worker(id.replace("s-", ""))),
  })

  // A brand-new session writes its first prompt, with a burst of attachments, before the hub sees its transcript, so a tail started at the end would never send that prompt: the view showed it only after a reload. A transcript that was there before the hub started keeps its history to itself, so a restarted dashboard sends no burst of old entries.
  test("a transcript created since the hub started is read from its start, an older one from its end", async () => {
    const { born, stat } = birthtimes()
    const before = join(dir, "before.jsonl")
    writeFileSync(before, line("u-before", "already there when the hub started"))
    born(before, Date.now() - 60_000)
    const { calls, changed, hub } = hubWith(undefined, stat)
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    const early = join(dir, "early.jsonl")
    writeFileSync(early, line("u-early", "created before the hub's first look"))
    born(early)
    calls[0]?.resolve(
      live([
        ["s-before", before],
        ["s-early", early],
      ]),
    )
    await until("the entry the start-read sends", () => sentBy(frames).length === 1)
    const fresh = join(dir, "fresh.jsonl")
    writeFileSync(fresh, line("u-1", "the first prompt") + attachment(100_000))
    born(fresh)
    const again = hub.subscribe(() => {})
    await until("the second read", () => calls.length === 2)
    calls[1]?.resolve(
      live([
        ["s-before", before],
        ["s-early", early],
        ["s-fresh", fresh],
      ]),
    )
    await until("the fresh transcript's first prompt", () => sentBy(frames).length === 2)
    appendFileSync(before, line("u-new", "said after the tail began"))
    changed(before)
    await until("the older transcript's next line", () => sentBy(frames).length === 3)
    expect(sentBy(frames)).toEqual([
      "s-early:created before the hub's first look",
      "s-fresh:the first prompt",
      "s-before:said after the tail began",
    ])
    leave()
    again()
  })

  // a lost change event left its line unsent until the session wrote again: every refresh reads each open tail again from its offset
  const opened = async (name: string) => {
    const { born, stat } = birthtimes()
    const path = join(dir, name)
    writeFileSync(path, line("u-0", "there before the hub started"))
    born(path, Date.now() - 60_000)
    const { calls, changed, hub } = hubWith(undefined, stat)
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    calls[0]?.resolve(live([["s-tail", path]]))
    await until("the tail's watcher", () => hub.watching === 1)
    // a second viewer asks for a refresh, as the safety timer does every 10 s; `answer` settles its sessions read
    const refresh = async (answer = (call: Deferred) => call.resolve(live([["s-tail", path]]))) => {
      const at = calls.length
      const again = hub.subscribe(() => {})
      await until("the next read", () => calls.length === at + 1)
      const call = calls[at]
      if (call) answer(call)
      return again
    }
    return { changed, frames, leave, path, refresh }
  }

  test("a line whose change event is lost reaches the board on the next refresh", async () => {
    const { frames, leave, path, refresh } = await opened("lost.jsonl")
    appendFileSync(path, line("u-1", "its change event was lost"))
    const again = await refresh()
    await until("the lost line", () => sentBy(frames).length === 1)
    expect(sentBy(frames)).toEqual(["s-tail:its change event was lost"])
    leave()
    again()
  })

  test("a line whose change event is lost reaches the board on a refresh whose sessions read fails", async () => {
    const { frames, leave, path, refresh } = await opened("failed.jsonl")
    appendFileSync(path, line("u-1", "read on a failed refresh"))
    const again = await refresh((call) => call.reject(new Error("the registry is down")))
    await until("the lost line", () => sentBy(frames).length === 1)
    expect(sentBy(frames)).toEqual(["s-tail:read on a failed refresh"])
    leave()
    again()
  })

  test("a line both its change event and a refresh read is sent once", async () => {
    const { changed, frames, leave, path, refresh } = await opened("both.jsonl")
    appendFileSync(path, line("u-1", "read twice, sent once"))
    // the event fires in the tick the refresh's read lands, so its tail read is still reading when the refresh's starts
    const again = await refresh((call) => {
      call.resolve(live([["s-tail", path]]))
      changed(path)
    })
    await until("the line", () => sentBy(frames).length > 0)
    await sleep(UNREREAD_MS)
    expect(sentBy(frames)).toEqual(["s-tail:read twice, sent once"])
    leave()
    again()
  })

  test("where no creation time is kept, a transcript is new when it appears after the hub's first look", async () => {
    const stat = (path: string) => ({ birthtimeMs: 0, size: statSync(path).size })
    const { calls, hub } = hubWith(undefined, stat)
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    const first = join(dir, "first-look.jsonl")
    writeFileSync(first, line("u-a", "listed at the first look"))
    calls[0]?.resolve(live([["s-first", first]]))
    await until("the first look's tail, read from its end", () => hub.watching === 1)
    const later = join(dir, "later.jsonl")
    writeFileSync(later, line("u-b", "listed at a later look"))
    const again = hub.subscribe(() => {})
    await until("the second read", () => calls.length === 2)
    calls[1]?.resolve(
      live([
        ["s-first", first],
        ["s-later", later],
      ]),
    )
    await until("the later look's entry", () => sentBy(frames).length === 1)
    expect(sentBy(frames)).toEqual(["s-later:listed at a later look"])
    leave()
    again()
  })

  // A forked session copies its conversation into a new file, which can be many MB: the first read reaches back only as far as a view's own history read does.
  test("a large new transcript is read from as far back as a view's history reaches", async () => {
    const { born, stat } = birthtimes()
    const { calls, hub } = hubWith(undefined, stat)
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    const big = join(dir, "big.jsonl")
    writeFileSync(
      big,
      line("u-old", "beyond the window") +
        attachment(600_000) +
        line("u-late", "inside the window"),
    )
    born(big)
    calls[0]?.resolve(live([["s-big", big]]))
    await until("the window's entry", () => sentBy(frames).length === 1)
    expect(sentBy(frames)).toEqual(["s-big:inside the window"])
    leave()
  })

  // A session's record keeps an answered picker until the turn ends; the session writing again is the first sign it was answered.
  test("a line from a session waiting on you re-reads the board at once; one from a working session does not", async () => {
    const { born, stat } = birthtimes()
    const waiting = join(dir, "waiting.jsonl")
    const busy = join(dir, "busy.jsonl")
    writeFileSync(waiting, line("w-0", "asked"))
    writeFileSync(busy, line("b-0", "working"))
    born(waiting, Date.now() - 60_000)
    born(busy, Date.now() - 60_000)
    const { calls, changed, hub } = hubWith(undefined, stat)
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    calls[0]?.resolve({
      surfaces: new Map(),
      transcripts: new Map([
        ["s-waiting", waiting],
        ["s-busy", busy],
      ]),
      workers: [{ ...worker("waiting"), light: "needs-you" }, worker("busy")],
    })
    await until("the two tails, read from their ends", () => hub.watching === 2)
    appendFileSync(busy, line("b-1", "still working"))
    changed(busy)
    await until("the busy line's entry", () => sentBy(frames).length === 1)
    // proves the negative: a working session's line re-reads nothing, the window starting at its entry
    await sleep(UNREREAD_MS)
    expect(calls).toHaveLength(1)
    appendFileSync(waiting, line("w-1", "answered"))
    changed(waiting)
    await until("the re-read", () => calls.length === 2)
    leave()
  })

  // an image's attachment went unseen while the message alone showed. Claude Code names a message's image on a source line written after it, so a read can end between the two.
  test("a message whose image's source line comes in a later read is sent again, its image named", async () => {
    const { born, stat } = birthtimes()
    const { calls, changed, hub } = hubWith(undefined, stat)
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    const path = join(dir, "image.jsonl")
    writeFileSync(path, line("u-0", "before the image"))
    born(path)
    calls[0]?.resolve(live([["s-image", path]]))
    await until("the first line", () => sentBy(frames).length === 1)
    const png = "11111111-2222-4333-8444-555555555555.png"
    const record = (fields: Record<string, unknown>) =>
      `${JSON.stringify({ promptId: "p-1", timestamp: "2026-10-06T00:00:00.000Z", type: "user", ...fields })}\n`
    appendFileSync(
      path,
      record({
        message: {
          content: [
            { text: "[Image #1]the sketch\nAttached:", type: "text" },
            {
              source: { data: "iVBORw0KGgo=", media_type: "image/png", type: "base64" },
              type: "image",
            },
          ],
          role: "user",
        },
        origin: { kind: "human" },
        uuid: "u-1",
      }),
    )
    changed(path)
    await until("the message", () => sentBy(frames).length === 2)
    appendFileSync(
      path,
      record({
        isMeta: true,
        message: {
          content: [{ text: `[Image: source: ${join(attachmentsDir(), png)}]`, type: "text" }],
          role: "user",
        },
        uuid: "m-1",
      }),
    )
    changed(path)
    await until("the message again", () => sentBy(frames).length === 3)
    const sent = frames.flatMap((f) => (f.type === "entries" ? f.entries : []))
    expect(sent.map((e) => [e.id, e.attachments?.map((a) => a.id) ?? null])).toEqual([
      ["u-0", null],
      ["u-1", [null]],
      ["u-1", [png]],
    ])
    leave()
  })

  // A message whose image no source line names (a path outside the folder, or a Claude Code that writes none) goes out at once, and is held for one read only.
  test("a message whose image's source line never comes is sent at once, and held no longer than the next read", async () => {
    const { born, stat } = birthtimes()
    const { calls, changed, hub } = hubWith(undefined, stat)
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    await until("the hub's first read", () => calls.length === 1)
    const path = join(dir, "unnamed.jsonl")
    writeFileSync(path, line("u-0", "before the image"))
    born(path)
    calls[0]?.resolve(live([["s-unnamed", path]]))
    await until("the first line", () => sentBy(frames).length === 1)
    appendFileSync(
      path,
      `${JSON.stringify({
        message: {
          content: [
            { text: "[Image #1]the sketch\nAttached:", type: "text" },
            {
              source: { data: "iVBORw0KGgo=", media_type: "image/png", type: "base64" },
              type: "image",
            },
          ],
          role: "user",
        },
        origin: { kind: "human" },
        promptId: "p-2",
        timestamp: "2026-10-06T00:00:00.000Z",
        type: "user",
        uuid: "u-1",
      })}\n`,
    )
    changed(path)
    await until("the message, before any source line", () => sentBy(frames).length === 2)
    appendFileSync(path, line("u-2", "the next line, no source"))
    changed(path)
    await until("the next line", () => sentBy(frames).length === 4)
    appendFileSync(path, line("u-3", "a later line"))
    changed(path)
    await until("the later line", () => sentBy(frames).length === 5)
    const batches = frames.flatMap((f) =>
      f.type === "entries" ? [f.entries.map((e) => e.id)] : [],
    )
    expect(batches).toEqual([["u-0"], ["u-1"], ["u-1", "u-2"], ["u-3"]])
    leave()
  })

  // The one case on the real fs.watch: FSEvents dropped or delayed a file's change by seconds at load5 13, so it appends again until a read sends what it wrote.
  test("a change fs.watch reports sends the transcript's new lines", async () => {
    const path = join(dir, "real-watch.jsonl")
    writeFileSync(path, "")
    const calls: Deferred[] = []
    const hub = new DashboardHub({
      events: false,
      listLive: () => {
        const call = deferred()
        calls.push(call)
        return call.promise
      },
    })
    const frames: DashboardFrame[] = []
    const leave = hub.subscribe((frame) => frames.push(frame))
    try {
      await until("the hub's first read", () => calls.length === 1)
      calls[0]?.resolve(live([["s-real", path]]))
      await until("the tail", () => hub.watching === 1)
      // inside the case's 20s, so a watcher that never reports fails on its own message
      const deadline = Date.now() + 15_000
      for (let i = 0; sentBy(frames).length === 0; i++) {
        if (Date.now() > deadline)
          throw new Error("timed out waiting for fs.watch to report a change")
        appendFileSync(path, line(`r-${i}`, "seen through fs.watch"))
        await sleep(500)
      }
      expect(sentBy(frames)[0]).toBe("s-real:seen through fs.watch")
    } finally {
      leave()
    }
  })

  test("the snapshot is the newest live list while anyone watches, and none after a failure or once all leave", async () => {
    const { calls, hub } = hubWith(200)
    const leave = hub.subscribe(() => {})
    await until("the hub's first read", () => calls.length === 1)
    const live: Live = { surfaces: new Map(), transcripts: new Map(), workers: [worker("lust")] }
    calls[0]?.resolve(live)
    await until("the first read's snapshot", () => hub.snapshot === live)
    const again = hub.subscribe(() => {})
    await until("the second read", () => calls.length === 2)
    await until("the snapshot dropped after the failure", () => hub.snapshot === null)
    const back: Live = { ...live, workers: [worker("back")] }
    const third = hub.subscribe(() => {})
    // proves the negative: no third read starts while the timed-out second read is unsettled
    await sleep(NO_SECOND_READ_MS)
    expect(calls).toHaveLength(2)
    calls[1]?.resolve(live)
    await until("the third read", () => calls.length === 3)
    calls[2]?.resolve(back)
    await until("the newest snapshot", () => hub.snapshot === back)
    leave()
    again()
    third()
    expect(hub.snapshot).toBeNull()
  })
})

describe("boardReader, the board for a reader with no socket", () => {
  const frame = {
    code: "X",
    dispatcher: "d",
    dispatchers: [],
    message: "m",
    names: {},
    type: "error",
  } as unknown as DashboardFrame
  const entries = { entries: [], sessionId: "s", type: "entries" } as unknown as DashboardFrame

  // A hub that hands a listener a frame now (a board already watching) or later (one it refreshes for this read), and counts its subscribes and who still listens.
  const fake = (now: DashboardFrame | null) => {
    const listeners = new Set<(frame: DashboardFrame) => void>()
    let subscribes = 0
    return {
      listeners,
      subscribes: () => subscribes,
      subscribe(listener: (frame: DashboardFrame) => void) {
        subscribes++
        listeners.add(listener)
        if (now) listener(now)
        return () => void listeners.delete(listener)
      },
    }
  }

  test("answers the frame a watching board already holds", async () => {
    expect(await boardReader(fake(frame), { timeoutMs: 1000 })()).toBe(frame)
  })

  test("waits for a refresh's board frame, past an entries frame, and gives null when none comes in time", async () => {
    const hub = fake(null)
    const waiting = boardReader(hub, { timeoutMs: 1000 })()
    for (const listener of hub.listeners) listener(entries)
    for (const listener of hub.listeners) listener(frame)
    expect(await waiting).toBe(frame)
    expect(await boardReader(fake(null), { timeoutMs: 10 })()).toBeNull()
  })

  // each read every 5 s subscribed and left, so the hub started herdr's feed and a full refresh for every read
  test("holds one subscription across reads, and lets it go once reads stop", async () => {
    const hub = fake(frame)
    const read = boardReader(hub, { holdMs: 50, timeoutMs: 1000 })
    await read()
    await read()
    expect(hub.subscribes()).toBe(1)
    await Bun.sleep(80)
    expect(hub.listeners.size).toBe(0)
    await read()
    expect(hub.subscribes()).toBe(2)
  })
})
