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
export const GROUPS_KEY = "dashboard.sidebar.groups.v1"

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

// The stored value, or null when the browser's storage throws (site data blocked), which reads as no stored state, every group at its default.
export const readGroups = (store: () => Pick<Storage, "getItem">): string | null => {
  try {
    return store().getItem(GROUPS_KEY)
  } catch {
    return null
  }
}

// Writes one group's state beside the others' (current) and returns the new value; a store that throws leaves it unwritten, and the page keeps working on this tab's copy.
export const saveGroup = (
  store: () => Pick<Storage, "setItem">,
  current: string | null,
  group: NavGroup,
  open: boolean,
): string => {
  const next = JSON.stringify({ ...parseGroups(current), [group]: open })
  try {
    store().setItem(GROUPS_KEY, next)
  } catch {
    // blocked storage keeps the state in this tab alone (kept)
  }
  return next
}

// Fired on a change in this tab, since the storage event reaches only other tabs.
const CHANGED = "dashboard-sidebar-groups"

// This tab's last write, which a group reads while the browser's storage throws, so a group still opens and closes while the tab lives.
let kept: string | null = null

const snapshot = () => readGroups(() => localStorage) ?? kept

const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify)
  window.addEventListener(CHANGED, notify)
  return () => {
    window.removeEventListener("storage", notify)
    window.removeEventListener(CHANGED, notify)
  }
}

// A group's open state and its setter, kept in this browser across reloads and shared by every place that draws the group; the server renders its default.
export function useGroupOpen(
  group: NavGroup,
  initial: boolean,
): [boolean, (open: boolean) => void] {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null)
  const setOpen = useCallback(
    (open: boolean) => {
      kept = saveGroup(() => localStorage, snapshot(), group, open)
      window.dispatchEvent(new Event(CHANGED))
    },
    [group],
  )
  return [groupOpen(parseGroups(raw), group, initial), setOpen]
}
