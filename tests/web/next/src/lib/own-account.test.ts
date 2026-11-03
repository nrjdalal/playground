import { describe, expect, test } from "bun:test"

import { markOwn, withOwn } from "@/lib/own-account"

describe("withOwn", () => {
  const rows = [
    { email: "pat@example.com", label: "work", renews: 17 },
    { email: "sam@example.com", own: true },
    { label: "zai", provider: "glm" },
  ]

  test("marks the one Claude row by its email own, and leaves every other row as it was", () => {
    expect(withOwn(rows, "pat@example.com", true)).toEqual([
      { email: "pat@example.com", label: "work", own: true, renews: 17 },
      rows[1],
      rows[2],
    ])
  })

  test("switched off, drops own from the row, so it reads as unset", () => {
    expect(withOwn(rows, "sam@example.com", false)).toEqual([
      rows[0],
      { email: "sam@example.com" },
      rows[2],
    ])
  })

  test("never marks a GLM row, whose label can match no Claude email", () => {
    expect(withOwn(rows, "zai", true)).toEqual(rows)
  })
})

describe("markOwn", () => {
  test("refuses a stored value that is not a list, and writes nothing", async () => {
    const writes: unknown[] = []
    const io = {
      read: async () => ({ not: "a list" }),
      write: async (rows: Record<string, unknown>[]) => void writes.push(rows),
    }
    await expect(markOwn("a-key", true, io)).rejects.toThrow("usage.accounts is not a list")
    expect(writes).toEqual([])
  })
})
