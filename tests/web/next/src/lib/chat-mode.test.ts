import { afterEach, describe, expect, test } from "bun:test"

import {
  CHAT_MODE_KEY,
  parseChatPrefs,
  prefsOf,
  readChatPrefs,
  saveChatPrefs,
} from "../../../../../web/next/src/lib/chat-mode"

const realStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")

afterEach(() => {
  if (realStorage) Object.defineProperty(globalThis, "localStorage", realStorage)
  else delete (globalThis as { localStorage?: Storage }).localStorage
})

const memoryStorage = () => {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    items,
    removeItem: (key: string) => void items.delete(key),
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

describe("parseChatPrefs", () => {
  test("keeps each chat's mode and pace", () => {
    const raw = JSON.stringify({
      dispatcher: { mode: "reading", pace: { at: 5, pace: 1.25 } },
      builder: { mode: "watching" },
    })
    expect(parseChatPrefs(raw)).toEqual({
      builder: { mode: "watching", pace: null },
      dispatcher: { mode: "reading", pace: { at: 5, pace: 1.25 } },
    })
  })

  test("drops a mode it does not know, a pace that does not read, and a value that is not an object", () => {
    expect(parseChatPrefs(JSON.stringify({ a: { mode: "following" } }))).toEqual({})
    expect(
      parseChatPrefs(JSON.stringify({ a: { mode: "reading", pace: { at: "x", pace: 2 } } })),
    ).toEqual({
      a: { mode: "reading", pace: null },
    })
    expect(parseChatPrefs("not json")).toEqual({})
    expect(parseChatPrefs("[1]")).toEqual({})
    expect(parseChatPrefs(null)).toEqual({})
  })

  test("a chat with nothing stored starts Watching at 1x", () => {
    expect(prefsOf({}, "dispatcher")).toEqual({ mode: "watching", pace: null })
  })
})

describe("the stored mode", () => {
  test("is read back from this browser", () => {
    const storage = memoryStorage()
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage })
    saveChatPrefs("dispatcher", { mode: "reading" })
    expect(parseChatPrefs(storage.items.get(CHAT_MODE_KEY) ?? null)).toEqual({
      dispatcher: { mode: "reading", pace: null },
    })
    expect(prefsOf(readChatPrefs(), "dispatcher").mode).toBe("reading")
  })

  test("is held in the tab when storage throws, as in a private window", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked")
      },
      removeItem: () => {
        throw new Error("blocked")
      },
      setItem: () => {
        throw new Error("blocked")
      },
    }
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: throwing })
    expect(() => saveChatPrefs("builder", { mode: "reading" })).not.toThrow()
    expect(prefsOf(readChatPrefs(), "builder").mode).toBe("reading")
  })

  test("keeps every chat's mode in the tab when storage reads but refuses each write, as a full one does", () => {
    const full = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error("quota")
      },
    }
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: full })
    saveChatPrefs("ops", { mode: "reading" })
    saveChatPrefs("planner", { mode: "reading" })
    expect(prefsOf(readChatPrefs(), "ops").mode).toBe("reading")
    expect(prefsOf(readChatPrefs(), "planner").mode).toBe("reading")
  })

  test("keeps a chat's change in the tab over what a full storage still holds for it", () => {
    const full = memoryStorage()
    full.items.set(CHAT_MODE_KEY, JSON.stringify({ ops: { mode: "reading" } }))
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        ...full,
        setItem: () => {
          throw new Error("quota")
        },
      },
    })
    saveChatPrefs("ops", { mode: "watching" })
    saveChatPrefs("planner", { mode: "reading" })
    expect(prefsOf(readChatPrefs(), "ops").mode).toBe("watching")
    expect(prefsOf(readChatPrefs(), "planner").mode).toBe("reading")
  })
})
