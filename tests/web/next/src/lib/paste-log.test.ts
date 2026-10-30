import { describe, expect, test } from "bun:test"

import {
  PASTE_REPORT_BYTES as API_REPORT_BYTES,
  PASTE_REPORT_ENTRIES as API_REPORT_ENTRIES,
  pasteReportSchema,
} from "../../../../../api/hono/src/lib/dashboard/paste-report"
import {
  EMPTY_WAIT_MS,
  type Emptied,
  emptyWatch,
  fillsBox,
  LOAD_MARK_KEY,
  loadReport,
  logPaste,
  markInserted,
  missesIn,
  missWatch,
  nameOf,
  PASTE_MISS_ENTRIES,
  PASTE_REPORT_BYTES,
  PASTE_WAIT_MS,
  pasteReport,
  PASTE_LOG_KEY,
  PASTE_LOG_MAX,
  pasteEntry,
  type PasteLogEntry,
  type PasteMiss,
  readPasteLog,
  takesText,
} from "../../../../../web/next/src/lib/paste-log"

const memory = () => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    store,
  }
}

const throwing = {
  getItem: (): string | null => {
    throw new Error("blocked")
  },
  setItem: (): void => {
    throw new Error("blocked")
  },
}

const element = (tagName: string, id = "", slot: string | null = null) => ({
  getAttribute: (name: string) => (name === "data-slot" ? slot : null),
  id,
  tagName,
})

const box = { ...element("TEXTAREA", "composer"), value: "abc" }
const at = "2026-10-18T11:00:00.000Z"
const seen = { active: box, at, box, mount: "m1", now: 1000, visible: true }
const WORDS = "dictated words nobody may read"
const clipboard = (text: string, types = ["text/plain"]) => ({
  getData: (type: string) => (type === "text/plain" ? text : ""),
  types,
})

describe("pasteEntry", () => {
  test("records a paste's lengths, types, delay and focus, never its words", () => {
    const entry = pasteEntry(
      {
        clipboardData: clipboard(WORDS, ["text/plain", "text/html"]),
        defaultPrevented: false,
        target: box,
        timeStamp: 880,
        type: "paste",
      },
      seen,
    )
    expect(entry).toEqual({
      active: "#composer",
      at,
      boxLength: 3,
      cause: null,
      delay: 120,
      event: "paste",
      inBox: true,
      inputType: null,
      length: WORDS.length,
      mount: "m1",
      prevented: false,
      reached: null,
      related: "none",
      target: "#composer",
      types: ["text/plain", "text/html"],
      visible: true,
    })
    expect(JSON.stringify(entry)).not.toContain("dictated")
  })

  test("a paste the composer inserted itself reads as let into the box, one it took as a file as kept from it", () => {
    const paste = (defaultPrevented: boolean) => ({
      clipboardData: clipboard(WORDS),
      defaultPrevented,
      target: box,
      timeStamp: 880,
      type: "paste",
    })
    const inserted = paste(true)
    markInserted(inserted, true)
    expect(pasteEntry(inserted, seen)?.prevented).toBe(false)
    const missed = paste(true)
    markInserted(missed, false)
    expect(pasteEntry(missed, seen)?.prevented).toBe(false)
    expect(pasteEntry(paste(true), seen)?.prevented).toBe(true)
  })

  test("names where a paste went when focus was not in the box", () => {
    const button = element("BUTTON", "", "button")
    const entry = pasteEntry(
      {
        clipboardData: clipboard(WORDS),
        defaultPrevented: false,
        target: button,
        timeStamp: 1000,
        type: "paste",
      },
      { ...seen, active: button },
    )
    expect(entry?.active).toBe("button[button]")
    expect(entry?.target).toBe("button[button]")
  })

  test("keeps Cmd or Ctrl+V and leaves out every other key", () => {
    const key = (k: string, mods: { ctrlKey?: boolean; metaKey?: boolean }) =>
      pasteEntry(
        { ...mods, defaultPrevented: false, key: k, target: box, timeStamp: 990, type: "keydown" },
        seen,
      )
    expect(key("v", { metaKey: true })?.event).toBe("keydown")
    expect(key("V", { ctrlKey: true })?.delay).toBe(10)
    expect(key("v", {})).toBeNull()
    expect(key("a", { metaKey: true })).toBeNull()
  })

  test("records a beforeinput's data length and inputType in the box alone", () => {
    const input = (target: unknown) =>
      pasteEntry(
        {
          data: WORDS,
          defaultPrevented: false,
          inputType: "insertFromPaste",
          target,
          timeStamp: 1000,
          type: "beforeinput",
        },
        seen,
      )
    expect(input(box)).toMatchObject({ inputType: "insertFromPaste", length: WORDS.length })
    expect(input(element("INPUT", "search"))).toBeNull()
  })

  test("leaves plain typing out and keeps every insert that could be a dictation", () => {
    const input = (inputType: string, data: string | null) =>
      pasteEntry(
        { data, defaultPrevented: false, inputType, target: box, timeStamp: 1000, type: "input" },
        seen,
      )
    expect(input("insertText", "a")).toBeNull()
    expect(input("insertLineBreak", null)).toBeNull()
    expect(input("insertText", null)?.inputType).toBe("insertText")
    expect(input("deleteContentBackward", null)).toBeNull()
    expect(input("deleteWordBackward", null)).toBeNull()
    expect(input("insertText", WORDS)?.length).toBe(WORDS.length)
    expect(input("insertFromPaste", null)?.inputType).toBe("insertFromPaste")
    expect(input("insertReplacementText", "b")?.inputType).toBe("insertReplacementText")
  })

  test("a missed dictation's Cmd+V survives the message typed after it", () => {
    const storage = memory()
    const log = (event: Parameters<typeof pasteEntry>[0]) => {
      const entry = pasteEntry(event, seen)
      if (entry) logPaste(entry, storage)
    }
    log({
      defaultPrevented: false,
      key: "v",
      metaKey: true,
      target: box,
      timeStamp: 990,
      type: "keydown",
    })
    for (let i = 0; i < 500; i += 1) {
      for (const type of ["beforeinput", "input"])
        log({
          data: "x",
          defaultPrevented: false,
          inputType: "insertText",
          target: box,
          timeStamp: 1000,
          type,
        })
      log({
        data: null,
        defaultPrevented: false,
        inputType: "deleteContentBackward",
        target: box,
        timeStamp: 1000,
        type: "input",
      })
    }
    expect(readPasteLog(storage).map((e) => e.event)).toEqual(["keydown"])
  })

  test("names an element by id, else by tag and slot, else none", () => {
    expect(nameOf(element("DIV", "", "field"))).toBe("div[field]")
    expect(nameOf(element("BODY"))).toBe("body")
    expect(nameOf(element("BUTTON", "base-ui-_r_4g_", "button"))).toBe("button[button]")
    expect(nameOf(element("DIV", "_R_1a_"))).toBe("div")
    expect(nameOf(null)).toBe("none")
  })
})

describe("the paste log", () => {
  const entry = (n: number): PasteLogEntry => ({
    active: "#composer",
    at,
    boxLength: n,
    cause: null,
    delay: 0,
    event: "input",
    inBox: true,
    inputType: "insertText",
    length: 1,
    mount: "m1",
    prevented: false,
    reached: null,
    related: "none",
    target: "#composer",
    types: [],
    visible: true,
  })

  test(`keeps the last ${PASTE_LOG_MAX} entries, the oldest dropped`, () => {
    const storage = memory()
    for (let i = 0; i < PASTE_LOG_MAX + 25; i += 1) logPaste(entry(i), storage)
    const log = readPasteLog(storage)
    expect(log).toHaveLength(PASTE_LOG_MAX)
    expect(log[0]?.boxLength).toBe(25)
  })

  test("reads a missing, broken or blocked log as empty and writes nothing to a blocked one", () => {
    expect(readPasteLog(memory())).toEqual([])
    const broken = memory()
    broken.store.set(PASTE_LOG_KEY, "{not json")
    expect(readPasteLog(broken)).toEqual([])
    expect(readPasteLog(throwing)).toEqual([])
    expect(() => logPaste(entry(1), throwing)).not.toThrow()
  })
})

describe("missWatch", () => {
  const logged = (
    event: PasteLogEntry["event"],
    patch: Partial<PasteLogEntry> = {},
  ): PasteLogEntry => ({
    active: "#composer",
    at,
    boxLength: 0,
    cause: null,
    delay: 0,
    event,
    inBox: true,
    inputType: null,
    length: 0,
    mount: "m1",
    prevented: false,
    reached: null,
    related: "none",
    target: "#composer",
    types: [],
    visible: true,
    ...patch,
  })
  const watching = () => {
    const misses: PasteMiss[] = []
    const timers = new Map<number, { ms: number; run: () => void }>()
    let next = 0
    const watch = missWatch((miss) => misses.push(miss), {
      clear: (id) => void timers.delete(id as number),
      set: (run, ms) => {
        timers.set(++next, { ms, run })
        return next
      },
    })
    const elapse = () => {
      for (const [id, { run }] of [...timers]) {
        timers.delete(id)
        run()
      }
    }
    return { elapse, misses, timers, watch }
  }

  test(`reports no-paste when a Cmd+V in the box brings no paste within ${PASTE_WAIT_MS}ms`, () => {
    const { elapse, misses, timers, watch } = watching()
    watch.seen(logged("keydown"), true)
    expect([...timers.values()].map((t) => t.ms)).toEqual([PASTE_WAIT_MS])
    elapse()
    expect(misses).toEqual(["no-paste"])
  })

  test("reports nothing when the paste comes, or the Cmd+V was made outside the box", () => {
    const { elapse, misses, watch } = watching()
    watch.seen(logged("keydown"), true)
    watch.seen(logged("paste", { length: 42, types: ["text/plain"] }), true)
    watch.seen(logged("keydown", { active: "button[button]" }), false)
    elapse()
    expect(misses).toEqual([])
  })

  test("reports empty-paste for a paste into the box with no text and no file", () => {
    const { misses, watch } = watching()
    watch.seen(logged("paste", { types: ["text/plain"] }), true)
    watch.seen(logged("paste", { types: ["Files"] }), true)
    watch.seen(logged("paste"), false)
    expect(misses).toEqual(["empty-paste"])
  })

  test("a stop cancels the wait", () => {
    const { elapse, misses, watch } = watching()
    watch.seen(logged("keydown"), true)
    watch.stop()
    elapse()
    expect(misses).toEqual([])
  })
})

describe("pasteReport", () => {
  test(`sends the miss with the log's last ${PASTE_MISS_ENTRIES} entries, within what the API takes`, () => {
    expect(PASTE_LOG_MAX).toBe(API_REPORT_ENTRIES)
    expect(PASTE_REPORT_BYTES).toBe(API_REPORT_BYTES)
    const storage = memory()
    const entry = (n: number): PasteLogEntry => ({
      active: "#composer",
      at,
      boxLength: n,
      cause: null,
      delay: 0,
      event: "input",
      inBox: true,
      inputType: "insertFromPaste",
      length: 9,
      mount: "m1",
      prevented: false,
      reached: null,
      related: "none",
      target: "#composer",
      types: [],
      visible: true,
    })
    expect(pasteReport("no-paste", storage)).toBeNull()
    for (let i = 0; i < PASTE_MISS_ENTRIES + 5; i += 1) logPaste(entry(i), storage)
    const report = pasteReport("no-paste", storage)
    expect(report?.miss).toBe("no-paste")
    expect(report?.entries).toHaveLength(PASTE_MISS_ENTRIES)
    expect(report?.entries[0]?.boxLength).toBe(5)
  })

  // Odd clipboards a real page meets: Google Docs' 62-character type, a type with a space, more than 8 types, and an input event with an empty inputType.
  const ODD_TYPES = [
    "application/x-vnd.google-docs-document-slice-clip+wrapped12345",
    "text/plain",
    "Some Type",
    ...Array.from({ length: 8 }, (_, i) => `x/${i}`),
  ]

  test("every entry the log keeps passes the API's schema, so one odd event never fails a report", () => {
    const entries = [
      pasteEntry(
        {
          clipboardData: clipboard(WORDS, ODD_TYPES),
          defaultPrevented: false,
          target: box,
          timeStamp: 880,
          type: "paste",
        },
        seen,
      ),
      pasteEntry(
        {
          data: WORDS,
          defaultPrevented: false,
          inputType: "",
          target: box,
          timeStamp: 880,
          type: "input",
        },
        seen,
      ),
    ]
    expect(pasteReportSchema.safeParse({ entries, miss: "no-paste" }).success).toBe(true)
    expect(entries[0]?.types).toHaveLength(8)
    expect(entries[0]?.types).toContain("text/plain")
    expect(entries[1]?.inputType).toBeNull()
  })

  test("an entry an earlier page logged reports in the API's shape too", () => {
    const storage = memory()
    storage.setItem(
      PASTE_LOG_KEY,
      JSON.stringify([
        {
          active: "#composer",
          at,
          boxLength: 0,
          delay: 0,
          event: "paste",
          inputType: "",
          length: 0,
          prevented: false,
          target: "#composer",
          types: ODD_TYPES,
        },
      ]),
    )
    expect(pasteReportSchema.safeParse(pasteReport("empty-paste", storage)).success).toBe(true)
  })
})

describe("focus and mounts", () => {
  const event = (type: string, extra: Record<string, unknown> = {}) => ({
    defaultPrevented: false,
    target: box,
    timeStamp: 1000,
    type,
    ...extra,
  })

  test("a focusout from the box names where focus went, and one elsewhere is left out", () => {
    const tab = element("BUTTON", "", "tabs-trigger")
    expect(pasteEntry(event("focusout", { relatedTarget: tab }), seen)).toMatchObject({
      event: "focusout",
      related: "button[tabs-trigger]",
    })
    expect(pasteEntry(event("focusout", { relatedTarget: null }), seen)?.related).toBe("none")
    expect(pasteEntry(event("focusout", { target: tab }), seen)).toBeNull()
  })

  test("the window's blur and focus and the page's visibility are logged, with whether the page is shown", () => {
    for (const type of ["blur", "focus", "visibilitychange"])
      expect(pasteEntry(event(type, { target: {} }), { ...seen, visible: false })).toMatchObject({
        event: type,
        visible: false,
      })
  })

  test("a mount and an unmount carry the composer's mount id", () => {
    expect(pasteEntry(event("mount"), { ...seen, mount: "k3j9x2" })).toMatchObject({
      event: "mount",
      mount: "k3j9x2",
    })
    expect(pasteEntry(event("unmount"), seen)?.event).toBe("unmount")
  })

  test("a Cmd+V says whether focus was in this box, not another of the same id", () => {
    const stale = { ...element("TEXTAREA", "composer"), value: "" }
    const key = (active: unknown) =>
      pasteEntry(event("keydown", { key: "v", metaKey: true }), { ...seen, active })
    expect(key(box)).toMatchObject({ active: "#composer", inBox: true })
    expect(key(stale)).toMatchObject({ active: "#composer", inBox: false })
  })

  test("each new entry passes the API's schema, and an older one is filled in to it", () => {
    const storage = memory()
    storage.setItem(PASTE_LOG_KEY, JSON.stringify([older("keydown", 0)]))
    for (const type of ["focusout", "blur", "focus", "visibilitychange", "mount", "unmount"]) {
      const entry = pasteEntry(event(type), { ...seen, at: stamp(30) })
      if (entry) logPaste(entry, storage)
    }
    const report = loadReport(storage)
    expect(report?.entries).toHaveLength(7)
    expect(report?.entries[0]).toMatchObject({ inBox: null, mount: "none", visible: null })
    expect(pasteReportSchema.safeParse(report).success).toBe(true)
  })
})

// An entry as the owner's page logged it, before the focus fields, at a number of seconds past at.
const stamp = (seconds: number) => new Date(Date.parse(at) + seconds * 1000).toISOString()
function older(event: string, seconds: number, length = 9) {
  return {
    active: "#composer",
    at: stamp(seconds),
    boxLength: 0,
    delay: 0,
    event,
    inputType: null,
    length,
    prevented: false,
    target: "#composer",
    types: event === "paste" ? ["text/plain"] : [],
  }
}
const hit = (seconds: number): PasteLogEntry => ({
  ...(older("paste", seconds) as PasteLogEntry),
  cause: null,
  inBox: true,
  mount: "m1",
  reached: null,
  related: "none",
  visible: true,
})

describe("loadReport", () => {
  const miss = (seconds: number): PasteLogEntry => ({ ...hit(seconds), length: 0 })

  test("carries the whole stored log once a miss is in it, then nothing until a newer miss", () => {
    const storage = memory()
    expect(loadReport(storage)).toBeNull()
    for (let i = 0; i < PASTE_LOG_MAX + 10; i += 1) logPaste(hit(i), storage)
    expect(loadReport(storage)).toBeNull()
    logPaste(miss(300), storage)
    const report = loadReport(storage)
    expect(report?.miss).toBe("load")
    expect(report?.entries).toHaveLength(PASTE_LOG_MAX)
    expect(pasteReportSchema.safeParse(report).success).toBe(true)
    storage.setItem(LOAD_MARK_KEY, report?.entries.at(-1)?.at ?? "")
    expect(loadReport(storage)).toBeNull()
    logPaste(hit(400), storage)
    expect(loadReport(storage)).toBeNull()
    logPaste(miss(500), storage)
    expect(loadReport(storage)?.entries).toHaveLength(PASTE_LOG_MAX)
  })

  test("keeps the newest entries that fit the API's body cap", () => {
    const storage = memory()
    // every name and type at the most the API takes
    const long = "x".repeat(100)
    const types = Array.from({ length: 8 }, (_, i) => `${i}${"t".repeat(59)}`)
    for (let i = 0; i < PASTE_LOG_MAX; i += 1)
      logPaste(
        { ...hit(i), active: long, mount: long, related: long, target: long, types },
        storage,
      )
    logPaste(miss(PASTE_LOG_MAX), storage)
    const report = loadReport(storage)
    expect(JSON.stringify(report).length).toBeLessThanOrEqual(PASTE_REPORT_BYTES)
    expect(report?.entries.length).toBeLessThan(PASTE_LOG_MAX)
    expect(report?.entries.at(-1)?.at).toBe(stamp(PASTE_LOG_MAX))
  })
})

describe("the log keeps its misses", () => {
  const ats = (storage: ReturnType<typeof memory>) => readPasteLog(storage).map((e) => e.at)

  test("a miss already stored, and every entry within 10s of it, outlives any number of hits", () => {
    const storage = memory()
    // A log from the owner's page: a Cmd+V no paste followed, an input 5s on, one 12s on, and an empty paste
    storage.setItem(
      PASTE_LOG_KEY,
      JSON.stringify([
        older("keydown", 0),
        older("input", 5),
        older("input", 12),
        older("paste", 40, 0),
      ]),
    )
    for (let i = 0; i < 500; i += 1) logPaste(hit(100 + i), storage)
    const kept = ats(storage)
    expect(kept).toHaveLength(PASTE_LOG_MAX)
    expect(kept.slice(0, 3)).toEqual([stamp(0), stamp(5), stamp(40)])
    expect(kept.at(-1)).toBe(stamp(599))
  })

  test("a Cmd+V a paste followed within 1s is a hit and gives way", () => {
    const storage = memory()
    logPaste({ ...hit(0), event: "keydown", length: 0, types: [] }, storage)
    logPaste({ ...hit(0), at: new Date(Date.parse(stamp(0)) + 500).toISOString() }, storage)
    for (let i = 0; i < PASTE_LOG_MAX; i += 1) logPaste(hit(100 + i), storage)
    expect(ats(storage)[0]).toBe(stamp(100))
  })

  test("a Cmd+V or an empty paste outside the box is no miss, and an older page's entry still is one", () => {
    const outside = { inBox: false, length: 0 }
    expect(missesIn([{ ...hit(0), event: "keydown", ...outside, types: [] }])).toEqual([false])
    expect(missesIn([{ ...hit(0), ...outside }])).toEqual([false])
    expect(missesIn([older("keydown", 0) as PasteLogEntry])).toEqual([true])
    const storage = memory()
    logPaste({ ...hit(0), event: "keydown", ...outside, types: [] }, storage)
    expect(loadReport(storage)).toBeNull()
  })

  test("a miss outlives a burst of hits, since a Cmd+V still waiting for its paste is no miss yet", () => {
    const storage = memory()
    logPaste({ ...hit(0), length: 0 }, storage)
    const burst = (ms: number) => new Date(Date.parse(stamp(20)) + ms).toISOString()
    for (let i = 0; i < 250; i += 1) {
      logPaste({ ...hit(0), at: burst(i * 12), event: "keydown", length: 0, types: [] }, storage)
      logPaste({ ...hit(0), at: burst(i * 12 + 4) }, storage)
    }
    expect(ats(storage)[0]).toBe(stamp(0))
  })

  test("once every entry is a miss, the oldest misses give way", () => {
    const storage = memory()
    for (let i = 0; i < PASTE_LOG_MAX + 50; i += 1) logPaste({ ...hit(i * 20), length: 0 }, storage)
    const kept = ats(storage)
    expect(kept).toHaveLength(PASTE_LOG_MAX)
    expect(kept[0]).toBe(stamp(50 * 20))
  })
})

describe("a Cmd+V heard on the window", () => {
  const cmdV = {
    defaultPrevented: false,
    key: "v",
    metaKey: true,
    timeStamp: 1000,
    type: "keydown",
  }
  const body = element("BODY")
  const button = element("BUTTON", "", "button")
  const search = element("INPUT", "search")

  test("a Cmd+V records where it reached, and every other event reads null", () => {
    expect(
      pasteEntry({ ...cmdV, target: body }, { ...seen, active: body, reached: "none" }),
    ).toMatchObject({
      active: "body",
      inBox: false,
      reached: "none",
      target: "body",
    })
    expect(pasteEntry({ ...cmdV, target: box }, { ...seen, reached: "box" })?.reached).toBe("box")
    expect(
      pasteEntry(
        { defaultPrevented: false, target: box, timeStamp: 1000, type: "focus" },
        { ...seen, reached: "box" },
      )?.reached,
    ).toBeNull()
  })

  test("takesText names an input, a textarea or an editable element, and nothing else", () => {
    expect(takesText(search)).toBe(true)
    expect(takesText(box)).toBe(true)
    expect(takesText({ ...element("DIV"), isContentEditable: true })).toBe(true)
    expect(takesText(body)).toBe(false)
    expect(takesText(button)).toBe(false)
    expect(takesText(null)).toBe(false)
    expect(takesText({ ...search, type: "checkbox" })).toBe(false)
    expect(takesText({ ...search, type: "radio" })).toBe(false)
    expect(takesText({ ...search, type: "email" })).toBe(true)
  })

  const watching = () => {
    const misses: PasteMiss[] = []
    const timers: (() => void)[] = []
    const watch = missWatch((miss) => misses.push(miss), {
      clear: () => {},
      set: (run) => timers.push(run),
    })
    return { elapse: () => timers.splice(0).forEach((run) => run()), misses, watch }
  }
  const key = (reached: PasteLogEntry["reached"]): PasteLogEntry => ({
    ...hit(0),
    event: "keydown",
    inBox: reached === "box",
    length: 0,
    reached,
    types: [],
  })

  test("reports off-box at once for a Cmd+V that reached nothing taking text, and nothing for one in another field", () => {
    const { misses, watch } = watching()
    watch.seen(key("none"), false)
    expect(misses).toEqual(["off-box"])
    watch.seen(key("field"), false)
    expect(misses).toEqual(["off-box"])
  })

  test("a Cmd+V stopped before it reached the box waits for its paste as the box's own does", () => {
    const { elapse, misses, watch } = watching()
    watch.seen(key("stopped"), true)
    elapse()
    expect(misses).toEqual(["no-paste"])
  })

  test("missesIn reads a Cmd+V that reached nothing as a miss, and one in another field as none", () => {
    expect(missesIn([key("none")])).toEqual([true])
    expect(missesIn([key("field")])).toEqual([false])
    const storage = memory()
    logPaste(key("none"), storage)
    expect(loadReport(storage)?.entries[0]?.reached).toBe("none")
  })

  test("a paste logged before its Cmd+V is still that Cmd+V's paste, as Ctrl+V's default action and a busy page order them", () => {
    expect(missesIn([hit(0), key("box")])).toEqual([false, false])
    const { elapse, misses, watch } = watching()
    watch.seen(hit(0), true)
    watch.seen(key("box"), true)
    elapse()
    expect(misses).toEqual([])
  })

  test("a paste from before the Cmd+V is not its paste", () => {
    expect(missesIn([hit(-5), key("box")])).toEqual([false, true])
    const { elapse, misses, watch } = watching()
    watch.seen(hit(-5), true)
    watch.seen(key("box"), true)
    elapse()
    expect(misses).toEqual(["no-paste"])
  })

  test("an off-box report passes the API's schema", () => {
    const storage = memory()
    logPaste(key("none"), storage)
    expect(pasteReportSchema.safeParse(pasteReport("off-box", storage)).success).toBe(true)
  })
})

describe("emptyWatch", () => {
  // a clock and timers the test moves by hand, 100ms a tick as the watch asks
  const watching = (field: () => { value: string } | null) => {
    const emptied: Emptied[] = []
    let clock = 0
    let queued: { at: number; run: () => void }[] = []
    const watch = emptyWatch(field, (e) => emptied.push(e), {
      now: () => clock,
      timers: {
        clear: (id) => void (queued = queued.filter((t) => t !== id)),
        set: (run, ms) => {
          const timer = { at: clock + ms, run }
          queued.push(timer)
          return timer
        },
      },
    })
    const elapse = (ms: number) => {
      const end = clock + ms
      for (let next = queued[0]; next && next.at <= end; next = queued[0]) {
        queued.shift()
        clock = next.at
        next.run()
      }
      clock = end
    }
    return { elapse, emptied, watch }
  }

  test("a box set empty soon after a paste reports reset, how long after and its length before", () => {
    const field = { value: "" }
    const { elapse, emptied, watch } = watching(() => field)
    watch.pasted()
    field.value = "hello there!"
    elapse(300)
    field.value = ""
    elapse(100)
    expect(emptied).toEqual([{ after: 400, before: 12, cause: "reset" }])
    elapse(EMPTY_WAIT_MS)
    expect(emptied).toHaveLength(1)
  })

  test("his key or press after the paste, or a box emptied past the wait, reports nothing", () => {
    const field = { value: "words" }
    const { elapse, emptied, watch } = watching(() => field)
    watch.pasted()
    watch.userActed()
    field.value = ""
    elapse(500)
    field.value = "words"
    watch.pasted()
    elapse(EMPTY_WAIT_MS + 100)
    field.value = ""
    elapse(500)
    expect(emptied).toEqual([])
  })

  test("a box taken down after a paste and come up empty reports remount", () => {
    const old = { value: "" }
    const first = watching(() => old)
    first.watch.pasted()
    old.value = "words"
    first.elapse(200)
    first.watch.stop()
    const fresh = { value: "" }
    const second = watching(() => fresh)
    second.elapse(100)
    expect(second.emptied).toEqual([{ after: 100, before: 5, cause: "remount" }])
  })

  test("a paste whose words never reached the box reads empty-insert, its length the paste's", () => {
    const field = { value: "" }
    const { elapse, emptied, watch } = watching(() => field)
    watch.pasted(84)
    elapse(0)
    expect(emptied).toEqual([{ after: 0, before: 84, cause: "empty-insert" }])
  })

  test("a paste whose input came, then emptied before the first look, still reads reset", () => {
    const field = { value: "" }
    const { elapse, emptied, watch } = watching(() => field)
    watch.pasted(12)
    watch.landed()
    elapse(0)
    expect(emptied).toEqual([{ after: 0, before: 12, cause: "reset" }])
  })

  test("a paste the composer inserted lands as it is logged, so a box set empty after it reads reset", () => {
    const field = { value: "hello" }
    const { elapse, emptied, watch } = watching(() => field)
    watch.pasted(5, true)
    field.value = ""
    elapse(0)
    expect(emptied).toEqual([{ after: 0, before: 5, cause: "reset" }])
  })

  test("a paste the composer tried and the box never took reads empty-insert", () => {
    const field = { value: "" }
    const { elapse, emptied, watch } = watching(() => field)
    watch.pasted(5, false)
    elapse(0)
    expect(emptied).toEqual([{ after: 0, before: 5, cause: "empty-insert" }])
  })

  test("a paste that replaced a longer selection with shorter words is still watched", () => {
    const field = { value: "a long draft he selected" }
    const { elapse, emptied, watch } = watching(() => field)
    watch.pasted(5)
    field.value = "short"
    elapse(100)
    field.value = ""
    elapse(100)
    expect(emptied).toEqual([{ after: 200, before: 5, cause: "reset" }])
  })

  test("fillsBox: only a paste into the box with words the composer let in", () => {
    const paste = (patch: Partial<PasteLogEntry>) => ({
      ...hit(0),
      length: 12,
      prevented: false,
      ...patch,
    })
    expect(fillsBox(paste({}), true)).toBe(true)
    expect(fillsBox(paste({ length: 0, prevented: true, types: ["Files"] }), true)).toBe(false)
    expect(fillsBox(paste({ length: 5000, prevented: true }), true)).toBe(false)
    expect(fillsBox(paste({ length: 0, types: ["Files"] }), true)).toBe(false)
    expect(fillsBox(paste({}), false)).toBe(false)
    expect(fillsBox({ ...paste({}), event: "keydown" }, true)).toBe(false)
  })

  test("a box come up with the words after a remount reports nothing", () => {
    const first = watching(() => ({ value: "words" }))
    first.watch.pasted()
    first.watch.stop()
    const second = watching(() => ({ value: "words" }))
    second.elapse(EMPTY_WAIT_MS)
    expect(second.emptied).toEqual([])
  })

  test("an emptied entry and its report pass the API's schema", () => {
    const storage = memory()
    logPaste(
      {
        ...hit(0),
        boxLength: 12,
        cause: "reset",
        delay: 400,
        event: "emptied",
        length: 0,
        types: [],
      },
      storage,
    )
    expect(missesIn(readPasteLog(storage))).toEqual([true])
    expect(pasteReportSchema.safeParse(pasteReport("emptied", storage)).success).toBe(true)
  })
})
