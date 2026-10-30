import { useSyncExternalStore } from "react"

import { DEFAULT_MODE, type ChatMode, type Pace } from "@/components/dashboard/chat-scroll"

// Each chat's mode and learned pace in this browser, never in a database: the mode a chat opens in, and how much faster than reading speed it glides.
export type ChatPrefs = { mode: ChatMode; pace: Pace | null }
export type AllChatPrefs = Record<string, ChatPrefs>

export const CHAT_MODE_KEY = "dashboard.chat.mode.v1"

const EMPTY: AllChatPrefs = {}
const DEFAULT: ChatPrefs = { mode: DEFAULT_MODE, pace: null }

// Pure: the prefs a stored value holds, keeping only a mode it knows and a pace that is a time and a number.
export function parseChatPrefs(raw: string | null): AllChatPrefs {
  if (!raw) return EMPTY
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return EMPTY
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY
  const prefs: AllChatPrefs = {}
  for (const [name, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object") continue
    const { mode, pace } = entry as Record<string, unknown>
    if (mode !== "reading" && mode !== "watching") continue
    const { at, pace: speed } = (pace ?? {}) as Record<string, unknown>
    prefs[name] = {
      mode,
      pace:
        typeof at === "number" && typeof speed === "number" && speed > 0
          ? { at, pace: speed }
          : null,
    }
  }
  return prefs
}

// Pure: one chat's prefs, else the default.
export const prefsOf = (all: AllChatPrefs, name: string): ChatPrefs => all[name] ?? DEFAULT

// The prefs in this tab, read from localStorage and kept here too, so a blocked or private window still keeps a chat's mode while the tab lives; another tab's write arrives through the storage event.
let current: AllChatPrefs | null = null
const listeners = new Set<() => void>()

const readStored = (): AllChatPrefs | null => {
  try {
    return parseChatPrefs(localStorage.getItem(CHAT_MODE_KEY))
  } catch {
    return null
  }
}

export function readChatPrefs(): AllChatPrefs {
  if (current === null) current = readStored() ?? EMPTY
  return current
}

// Writes one chat's prefs over what storage holds now, so another tab's chats stay, with this tab's own on top, so a chat whose write storage refused keeps its change.
export function saveChatPrefs(name: string, change: Partial<ChatPrefs>): void {
  const before = { ...readStored(), ...readChatPrefs() }
  const next = { ...before, [name]: { ...prefsOf(before, name), ...change } }
  current = next
  try {
    localStorage.setItem(CHAT_MODE_KEY, JSON.stringify(next))
  } catch {}
  for (const listener of listeners) listener()
}

const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CHAT_MODE_KEY && event.key !== null) return
    current = null
    onChange()
  }
  listeners.add(onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onStorage)
  }
}

// One chat's prefs: the default on the server's first paint, then this browser's.
export const useChatPrefs = (name: string): ChatPrefs =>
  prefsOf(
    useSyncExternalStore(subscribe, readChatPrefs, () => EMPTY),
    name,
  )
