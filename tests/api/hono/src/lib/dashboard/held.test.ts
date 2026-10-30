import { describe, expect, test } from "bun:test"

import { heldReason, parseHeld } from "../../../../../../api/hono/src/lib/dashboard/held"

describe("parseHeld", () => {
  test("each held pull request's reason by owner/name#number; a reason that is not words costs only itself", () => {
    const held = parseHeld(
      JSON.stringify({ held: { "o/r#1080": "held for your go", "o/r#2": 7, "o/r#3": " " } }),
    )
    expect([...held]).toEqual([["o/r#1080", "held for your go"]])
  })

  test("a file that is not JSON, or holds no held object, holds none", () => {
    expect(parseHeld("not json").size).toBe(0)
    expect(parseHeld("[]").size).toBe(0)
    expect(parseHeld(JSON.stringify({ held: ["o/r#1"] })).size).toBe(0)
  })
})

describe("heldReason", () => {
  const held = parseHeld(JSON.stringify({ held: { "o/r#1080": "held for your go" } }))

  test("a pull request's reason by its URL, null when it is not held or has no URL", () => {
    expect(heldReason(held, "https://github.com/o/r/pull/1080")).toBe("held for your go")
    expect(heldReason(held, "https://github.com/o/r/pull/1081")).toBeNull()
    expect(heldReason(held, null)).toBeNull()
    expect(heldReason(held, "o/r#1080")).toBeNull()
  })
})
