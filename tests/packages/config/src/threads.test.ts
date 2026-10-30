import { describe, expect, test } from "bun:test"

import {
  markerOf,
  THREAD_ID,
  threadPatchSchema,
  threadSchema,
  withMarker,
} from "../../../../packages/config/src/threads"

describe("a thread id", () => {
  test("is 4 characters of the id alphabet with at least one letter", () => {
    for (const id of ["k7mq", "2b34", "bcdf"]) expect(THREAD_ID.test(id)).toBe(true)
    for (const id of ["2345", "k7m", "k7mqx", "K7MQ", "a7mq", "k0mq", "k7-q"]) {
      expect(THREAD_ID.test(id)).toBe(false)
    }
  })
})

describe("a thread's marker", () => {
  test("opens the words, past the [Image #n] marks Claude Code puts first, and is read back out", () => {
    expect(withMarker("k7mq", "  Ship it")).toBe("[thread:k7mq] Ship it")
    expect(markerOf("[thread:k7mq] Ship it")).toEqual({ id: "k7mq", text: "Ship it" })
    expect(markerOf("[Image #1] [thread:k7mq] look")).toEqual({
      id: "k7mq",
      text: "[Image #1] look",
    })
  })

  test("is no marker past the start, with an id the contract refuses, or as #k7mq", () => {
    for (const text of ["see [thread:k7mq]", "[thread:a7mq] hi", "#k7mq hi", "[thread:k7mqx] hi"]) {
      expect(markerOf(text)).toEqual({ id: null, text })
    }
  })
})

describe("a thread PATCH body", () => {
  test("takes read as true or false", () => {
    expect(threadPatchSchema.parse({ read: true })).toEqual({ read: true })
    expect(threadPatchSchema.parse({ read: false })).toEqual({ read: false })
  })

  test("takes each field and trims the title", () => {
    expect(threadPatchSchema.parse({ archived: true, pinned: false, title: "  Ship it " })).toEqual(
      {
        archived: true,
        pinned: false,
        title: "Ship it",
      },
    )
  })

  test("refuses an empty body, a blank title and an unknown field's wrong type", () => {
    expect(threadPatchSchema.safeParse({}).success).toBe(false)
    expect(threadPatchSchema.safeParse({ title: "   " }).success).toBe(false)
    expect(threadPatchSchema.safeParse({ pinned: "yes" }).success).toBe(false)
  })
})

describe("a thread row", () => {
  const row = {
    archivedAt: null,
    createdAt: "2026-10-22T10:00:00.000Z",
    firstMessageId: null,
    id: "k7mq",
    lastReadAt: null,
    pinnedAt: null,
    title: "Threads in the sidebar",
    unread: 0,
    updatedAt: "2026-10-22T10:00:00.000Z",
  }

  test("carries its first message's id, or null before a route tags one", () => {
    expect(threadSchema.parse(row).firstMessageId).toBeNull()
    expect(threadSchema.parse({ ...row, firstMessageId: "6f1c" }).firstMessageId).toBe("6f1c")
    const { firstMessageId: _, ...missing } = row
    expect(threadSchema.safeParse(missing).success).toBe(false)
  })
})
