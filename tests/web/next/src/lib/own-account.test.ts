import { describe, expect, test } from "bun:test"

import { markOwn } from "@/lib/own-account"

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
