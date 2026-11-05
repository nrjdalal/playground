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

type Store = Pick<Storage, "getItem" | "setItem">

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

// Writes one group's state beside the others'.
export const saveGroup = (store: Store, group: NavGroup, open: boolean) =>
  store.setItem(
    GROUPS_KEY,
    JSON.stringify({ ...parseGroups(store.getItem(GROUPS_KEY)), [group]: open }),
  )

// Fired on a change in this tab, since the storage event reaches only other tabs.
const CHANGED = "dashboard-sidebar-groups"

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
  const raw = useSyncExternalStore(
    subscribe,
    () => localStorage.getItem(GROUPS_KEY),
    () => null,
  )
  const setOpen = useCallback(
    (open: boolean) => {
      saveGroup(localStorage, group, open)
      window.dispatchEvent(new Event(CHANGED))
    },
    [group],
  )
  return [groupOpen(parseGroups(raw), group, initial), setOpen]
}
