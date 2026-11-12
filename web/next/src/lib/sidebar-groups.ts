"use client"

import { useCallback, useSyncExternalStore } from "react"

import type { GroupLabel } from "@/lib/dashboard"

// Every group the sidebar's nav draws, each one's label its toggle.
export type NavGroup =
  | Exclude<GroupLabel, "Dispatchers">
  | "Channels"
  | "Direct messages"
  | "Threads"

// Where this browser keeps each group's open or closed state, so a group you closed is still closed after a reload.
const GROUPS_KEY = "dashboard.sidebar.groups.v1"

export type GroupsOpen = Partial<Record<NavGroup, boolean>>

// Pure: the stored states, keeping only true or false values, and none from a missing or malformed value.
export const parseGroups = (raw: string | null): GroupsOpen => {
  try {
    const value: unknown = JSON.parse(raw ?? "{}")
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(([, open]) => typeof open === "boolean"),
    ) as GroupsOpen
  } catch {
    return {}
  }
}

// Pure: whether a group shows open, by its stored state, else its own default.
export const groupOpen = (stored: GroupsOpen, group: NavGroup, initial: boolean): boolean =>
  stored[group] ?? initial

// A tab's group states: read from the store once, on first use, then held in the tab, which every group reads from then on, so a store that throws, refuses a write or is full never leaves a toggle dead or the page down; each toggle writes the whole state through, any error ignored.
export function groupsState(store: () => Pick<Storage, "getItem" | "setItem">) {
  let raw: string | null | undefined
  const read = (): string | null => {
    if (raw === undefined) {
      try {
        raw = store().getItem(GROUPS_KEY)
      } catch {
        raw = null
      }
    }
    return raw
  }
  const set = (group: NavGroup, open: boolean) => {
    raw = JSON.stringify({ ...parseGroups(read()), [group]: open })
    try {
      store().setItem(GROUPS_KEY, raw)
    } catch {
      // the tab keeps the state alone
    }
  }
  return { read, set }
}

const tab = groupsState(() => localStorage)

// Fired on a toggle, so every place that draws the group reads the tab's new state.
const CHANGED = "dashboard-sidebar-groups"

const subscribe = (notify: () => void) => {
  window.addEventListener(CHANGED, notify)
  return () => window.removeEventListener(CHANGED, notify)
}

// A group's open state and its setter, kept in this browser across reloads and shared by every place that draws the group; the server renders its default.
export function useGroupOpen(
  group: NavGroup,
  initial: boolean,
): [boolean, (open: boolean) => void] {
  const raw = useSyncExternalStore(subscribe, tab.read, () => null)
  const setOpen = useCallback(
    (open: boolean) => {
      tab.set(group, open)
      window.dispatchEvent(new Event(CHANGED))
    },
    [group],
  )
  return [groupOpen(parseGroups(raw), group, initial), setOpen]
}

// Every group you can drag into another place, in the order the sidebar draws them until you do; Threads stays first.
export const ORDERED_GROUPS = [
  "Channels",
  "Direct messages",
  "Orchestrators",
  "Subagents",
  "AI Runners",
  "Scripts",
  "Other",
] as const satisfies readonly NavGroup[]

export type OrderedGroup = (typeof ORDERED_GROUPS)[number]

export const groupOrder = (_raw: string | null): OrderedGroup[] => [...ORDERED_GROUPS]

export const moveGroup = (
  order: OrderedGroup[],
  _shown: OrderedGroup[],
  _from: number,
  _to: number,
): OrderedGroup[] => order

export function orderState(
  _store: () => Pick<Storage, "getItem" | "setItem">,
  _account: string,
): { read: () => string | null; set: (order: OrderedGroup[]) => void } {
  return { read: () => null, set: () => {} }
}
