import { afterEach, describe, expect, test } from "bun:test"

import { INBOX_REFRESH_MS, inboxPolling } from "../../../../../web/next/src/lib/inbox"
import {
  DOT,
  inboxMark,
  newInInbox,
  newInInboxCount,
  readMark,
  showsDot,
  TAB_DOT_POLLING,
  writeMark,
} from "../../../../../web/next/src/lib/tab-dot"

type Item = Parameters<typeof newInInbox>[0][number]

const item = (createdAt: string, fields: Record<string, unknown> = {}): Item =>
  ({
    createdAt,
    id: `i-${createdAt}`,
    kind: "decision",
    readAt: null,
    ref: 1,
    status: "open",
    ...fields,
  }) as unknown as Item

const T0 = "2026-10-08T12:00:00.000Z"
const T1 = "2026-10-08T12:05:00.000Z"
const T2 = "2026-10-08T12:10:00.000Z"

// The dot shows only for a Changelog update or something new in the Inbox.
describe("showsDot", () => {
  test("shows for an unread Changelog entry or something new in the inbox, each alone", () => {
    expect(showsDot({ changelog: true, inbox: false })).toBe(true)
    expect(showsDot({ changelog: false, inbox: true })).toBe(true)
  })

  test("shows for nothing else: with neither, no dot", () => {
    expect(showsDot({ changelog: false, inbox: false })).toBe(false)
  })
})

describe("newInInbox", () => {
  test("an item that needs you and came after the inbox's last look is new", () => {
    expect(newInInbox([item(T2)], T1)).toBe(true)
  })

  test("viewing the inbox clears it: an item no later than the look is not new", () => {
    expect(newInInbox([item(T0), item(T1)], T1)).toBe(false)
  })

  test("before any look, every item that needs you is new", () => {
    expect(newInInbox([item(T0)], null)).toBe(true)
    expect(newInInbox([], null)).toBe(false)
  })

  test("an item that asks nothing of you any more is not new, however late", () => {
    expect(newInInbox([item(T2, { status: "answered" })], T1)).toBe(false)
    expect(newInInbox([item(T2, { kind: "update", readAt: T2, status: "open" })], T1)).toBe(false)
    expect(newInInbox([item(T2, { kind: "update", readAt: null, status: "open" })], T1)).toBe(true)
  })

  test("an item put away that came back after the look is new again, though its words are old", () => {
    expect(newInInbox([item(T0, { answer: { snoozedUntil: T2 } })], T1)).toBe(true)
  })

  test("one whose time had passed before the look is not, its wake seen already", () => {
    expect(newInInbox([item(T0, { answer: { snoozedUntil: T0 } })], T1)).toBe(false)
  })
})

// A click on the toolbar square clears the dot.
describe("newInInboxCount", () => {
  test("counts what needs you and came after the last look, so a look clears the bar's count with no answer given", () => {
    const items = [item(T0), item(T2), item(T2, { id: "b" }), item(T2, { status: "answered" })]
    expect(newInInboxCount(items, T1)).toBe(2)
    expect(newInInboxCount(items, T2)).toBe(0)
    expect(newInInboxCount(items, null)).toBe(3)
  })
})

describe("inboxMark", () => {
  test("a look marks the newest item's time, the server's clock, so a later item is still new whatever this browser's clock says", () => {
    expect(inboxMark([item(T0), item(T2), item(T1)])).toBe(T2)
    expect(newInInbox([item(T0), item(T2)], inboxMark([item(T0), item(T2)]))).toBe(false)
    expect(newInInbox([item(T0), item("2026-10-08T12:10:00.001Z")], inboxMark([item(T0)]))).toBe(
      true,
    )
  })

  test("an item's time to come back marks too, so a look after the wake clears it", () => {
    expect(inboxMark([item(T0, { answer: { snoozedUntil: T2 } })])).toBe(T2)
    expect(newInInbox([item(T0, { answer: { snoozedUntil: T2 } })], T2)).toBe(false)
  })

  test("an empty inbox leaves no mark", () => {
    expect(inboxMark([])).toBeNull()
  })
})

describe("TAB_DOT_POLLING", () => {
  // TanStack Query skips a plain refetchInterval while the tab is hidden, which is when the dot is read
  test("the dot's inbox read polls on its interval in a hidden tab too", () => {
    expect(TAB_DOT_POLLING).toEqual({ background: true, poll: true })
    const polling = inboxPolling(TAB_DOT_POLLING)
    expect(polling.refetchIntervalInBackground).toBe(true)
    expect(polling.refetchInterval).toBe(INBOX_REFRESH_MS)
    expect(inboxPolling({ background: false, poll: true }).refetchIntervalInBackground).toBe(false)
  })
})

describe("readMark and writeMark", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const fired: string[] = []
  const withStorage = (storage: unknown) => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage })
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { dispatchEvent: (event: Event) => fired.push(event.type) },
    })
  }
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original)
    else Reflect.deleteProperty(globalThis, "localStorage")
    Reflect.deleteProperty(globalThis, "window")
    fired.length = 0
  })

  test("a mark only moves forward, per browser, and tells this tab's readers", () => {
    const store = new Map<string, string>()
    withStorage({
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    })
    expect(readMark("inbox")).toBeNull()
    writeMark("inbox", T1)
    expect(readMark("inbox")).toBe(T1)
    writeMark("inbox", T0)
    expect(readMark("inbox")).toBe(T1)
    expect(fired).toEqual(["playground:seen"])
  })

  test("storage that throws reads as no mark and writes nothing, never an error", () => {
    const fail = () => {
      throw new Error("blocked")
    }
    withStorage({ getItem: fail, setItem: fail })
    expect(readMark("inbox")).toBeNull()
    expect(() => writeMark("inbox", T1)).not.toThrow()
    expect(fired).toEqual([])
  })
})

describe("DOT", () => {
  test("sits flush in the icon's top right corner, about 3/8 of the icon across, ringed", () => {
    expect(DOT.x + DOT.r).toBe(DOT.size)
    expect(DOT.y - DOT.r).toBe(0)
    const share = (2 * DOT.r) / DOT.size
    expect(share).toBeGreaterThanOrEqual(0.35)
    expect(share).toBeLessThanOrEqual(0.4)
    expect(DOT.ring).toBeGreaterThan(0)
  })
})

describe("inboxMark and a change", () => {
  test("a look takes in a change after the newest post, so the change reads Updated no longer", () => {
    const changed = item(T0, {
      answer: { at: T2, choice: "approve" },
      status: "approved",
      updatedAt: T2,
    })
    expect(inboxMark([changed, item(T1)])).toBe(T2)
  })
})
