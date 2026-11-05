import { describe, expect, test } from "bun:test"

import {
  GROUPS_KEY,
  groupOpen,
  parseGroups,
  readGroups,
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

type Store = ReturnType<typeof storage>

const afterReload = (store: Store) => parseGroups(readGroups(() => store))

const save = (store: Store, group: Parameters<typeof saveGroup>[2], open: boolean) =>
  saveGroup(
    () => store,
    readGroups(() => store),
    group,
    open,
  )

// A browser whose site data is blocked: reaching localStorage, or reading or writing it, throws.
const blocked = () => {
  throw new Error("SecurityError: the operation is insecure")
}

describe("the sidebar's groups, open or closed", () => {
  test("a group you close is still closed after a reload, and the others keep their defaults", () => {
    const store = storage()
    save(store, "Orchestrators", false)
    const stored = afterReload(store)
    expect(groupOpen(stored, "Orchestrators", true)).toBe(false)
    expect(groupOpen(stored, "Subagents", true)).toBe(true)
    expect(groupOpen(stored, "Scripts", false)).toBe(false)
  })

  test("a group you open stays open, and each write keeps the other groups' states", () => {
    const store = storage()
    save(store, "Scripts", true)
    save(store, "Channels", false)
    const stored = afterReload(store)
    expect(groupOpen(stored, "Scripts", false)).toBe(true)
    expect(groupOpen(stored, "Channels", true)).toBe(false)
  })

  test("storage that throws reads as no stored state, and a write to it throws nothing and returns the new value for this tab", () => {
    expect(readGroups(blocked)).toBeNull()
    expect(readGroups(() => ({ getItem: blocked }))).toBeNull()
    expect(saveGroup(blocked, null, "Other", true)).toBe('{"Other":true}')
    expect(saveGroup(() => ({ setItem: blocked }), '{"Scripts":true}', "Other", true)).toBe(
      '{"Scripts":true,"Other":true}',
    )
  })

  test("a missing or malformed value reads as no stored state", () => {
    expect(parseGroups(null)).toEqual({})
    expect(parseGroups("not json")).toEqual({})
    expect(parseGroups("[true]")).toEqual({})
    expect(parseGroups('{"Threads":"no","Other":true}')).toEqual({ Other: true })
  })
})
