import type { InboxItem } from "@api/hono"
import { useSyncExternalStore } from "react"

import { changedAt, needsYou } from "@/lib/inbox"

// The tab's favicon wears a red dot, as Slack's does, only when something is new for you: a Changelog entry you have not read, or an inbox item that came after you last viewed the inbox. Each source is also marked where it lives: the Inbox tab and the Changelog square show their count inside a red dot.

// What you last viewed, per browser: the inbox, up to a time.
export type SeenMark = "inbox"

const KEYS: Record<SeenMark, string> = {
  inbox: "playground:seen:inbox",
}

// written in this tab; another tab's write arrives as the storage event
const EVENT = "playground:seen"

const at = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0)

// A mark as this browser last wrote it; null when none is stored or storage cannot be read.
export function readMark(mark: SeenMark): string | null {
  try {
    return localStorage.getItem(KEYS[mark])
  } catch {
    return null
  }
}

// Moves a mark forward to seenAt, never back, and tells this tab's readers.
export function writeMark(mark: SeenMark, seenAt: string) {
  try {
    if (at(readMark(mark)) >= at(seenAt)) return
    localStorage.setItem(KEYS[mark], seenAt)
  } catch {
    return
  }
  window.dispatchEvent(new Event(EVENT))
}

const subscribeMarks = (onChange: () => void) => {
  window.addEventListener("storage", onChange)
  window.addEventListener(EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(EVENT, onChange)
  }
}

export const useMark = (mark: SeenMark): string | null =>
  useSyncExternalStore(
    subscribeMarks,
    () => readMark(mark),
    () => null,
  )

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange)
  return () => document.removeEventListener("visibilitychange", onChange)
}

// Whether this tab is the one in front, since only a visible tab views anything.
export const useTabVisible = (): boolean =>
  useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  )

// How the dot's own reads poll: on their interval, and in a hidden tab too, since a background tab is where the dot is read and TanStack Query skips a plain interval there.
export const TAB_DOT_POLLING = { background: true, poll: true } as const

// When an item is set to ask again, from its answer; null when it holds none. The list never holds a sleeping item (the API leaves it out), so this reads an awake one's past wake.
const snoozedUntil = (item: InboxItem): string | null =>
  item.answer && "snoozedUntil" in item.answer ? item.answer.snoozedUntil : null

// Pure: whether the inbox holds an item that needs you and came after you last viewed it; before any view, every such item is new. One put away asks again as new once its time has passed the look, though its words are old.
export const newInInbox = (items: InboxItem[], seenAt: string | null): boolean =>
  newInInboxCount(items, seenAt) > 0

// Pure: how many such items there are, the bar's count, which a look at the Inbox clears without answering any.
export const newInInboxCount = (items: InboxItem[], seenAt: string | null): number =>
  items.filter(
    (item) =>
      needsYou(item) && (at(item.createdAt) > at(seenAt) || at(snoozedUntil(item)) > at(seenAt)),
  ).length

// Pure: the mark viewing the inbox leaves: the newest time an item was posted, changed or set to come back, by the server's clock that stamped it, so this browser's clock never hides a later one; null when the inbox is empty.
export const inboxMark = (items: InboxItem[]): string | null =>
  items
    .flatMap((item) => [changedAt(item) ?? item.createdAt, snoozedUntil(item)])
    .reduce<string | null>((latest, time) => (at(time) > at(latest) ? time : latest), null)

// What is new for you, by source: each lights the tab's dot and its own.
export type DotSources = {
  changelog: boolean
  inbox: boolean
}

// Pure: the dot shows for an unread Changelog entry or something new in the inbox, and for nothing else.
export const showsDot = ({ changelog, inbox }: DotSources): boolean => changelog || inbox

// The dot on a 64px icon, flush with its top right corner as Slack's is: its edge touches the icon's top and right, it spans 3/8 of the icon, and a ring cut out of the icon around it shows the tab bar's own colour, whatever the theme, so it reads apart from the icon.
export const DOT = { r: 12, ring: 4, size: 64, x: 52, y: 12 } as const
