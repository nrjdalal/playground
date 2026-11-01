import { describe, expect, test } from "bun:test"

import { moveOldKeys, OLD_KEYS } from "../../../../../web/next/src/lib/old-keys"

// The old key each new key moves from, read from the move itself.
const oldKey = (key: string) => Object.keys(OLD_KEYS).find((old) => OLD_KEYS[old] === key)!

const storage = (entries: Record<string, string>) => {
  const map = new Map(Object.entries(entries))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    map,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe("the browser keys from before the rename", () => {
  test("an old key's value moves to its new key, and the old key goes", () => {
    const s = storage({ "desk.paste-log": "[1]", [oldKey("playground:music:volume")]: "40" })
    moveOldKeys(s)
    expect(Object.fromEntries(s.map)).toEqual({
      "dashboard.paste-log": "[1]",
      "playground:music:volume": "40",
    })
  })

  test("a value the new key already holds wins, and a second move changes nothing", () => {
    const s = storage({ "playground:seen:inbox": "new", [oldKey("playground:seen:inbox")]: "old" })
    moveOldKeys(s)
    moveOldKeys(s)
    expect(Object.fromEntries(s.map)).toEqual({ "playground:seen:inbox": "new" })
  })

  test("a storage that refuses is left as it is", () => {
    const refusing = {
      getItem: () => {
        throw new Error("denied")
      },
      removeItem: () => {},
      setItem: () => {},
    }
    expect(() => moveOldKeys(refusing)).not.toThrow()
  })
})
