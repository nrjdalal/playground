import { describe, expect, test } from "bun:test"

import {
  GROUPS_KEY,
  groupOpen,
  parseGroups,
  saveGroup,
} from "../../../../../web/next/src/lib/sidebar-groups"

// A browser's localStorage, kept across a reload: a new page reads what the last one wrote.
const storage = () => {
  const items = new Map<string, string>()
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  }
}

const afterReload = (store: ReturnType<typeof storage>) => parseGroups(store.getItem(GROUPS_KEY))

describe("the sidebar's groups, open or closed", () => {
  test("a group you close is still closed after a reload, and the others keep their defaults", () => {
    const store = storage()
    saveGroup(store, "Orchestrators", false)
    const stored = afterReload(store)
    expect(groupOpen(stored, "Orchestrators", true)).toBe(false)
    expect(groupOpen(stored, "Subagents", true)).toBe(true)
    expect(groupOpen(stored, "Scripts", false)).toBe(false)
  })

  test("a group you open stays open, and each write keeps the other groups' states", () => {
    const store = storage()
    saveGroup(store, "Scripts", true)
    saveGroup(store, "Channels", false)
    const stored = afterReload(store)
    expect(groupOpen(stored, "Scripts", false)).toBe(true)
    expect(groupOpen(stored, "Channels", true)).toBe(false)
  })

  test("a missing or malformed value reads as no stored state", () => {
    expect(parseGroups(null)).toEqual({})
    expect(parseGroups("not json")).toEqual({})
    expect(parseGroups("[true]")).toEqual({})
    expect(parseGroups('{"Threads":"no","Other":true}')).toEqual({ Other: true })
  })
})
