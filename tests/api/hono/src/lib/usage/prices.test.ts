import { describe, expect, test } from "bun:test"

import { costOf, modelKey, PRICES } from "../../../../../../api/hono/src/lib/usage/prices"

const none = { cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, input: 0, output: 0 }

describe("modelKey", () => {
  test("drops a date and a context marker", () => {
    expect(modelKey("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5")
    expect(modelKey("claude-opus-5-5[1m]")).toBe("claude-opus-5-5")
    expect(modelKey("Claude-Sonnet-5-5")).toBe("claude-sonnet-5-5")
  })
})

describe("costOf", () => {
  test("charges a million of each kind at its rate", () => {
    expect(costOf("claude-opus-5-5", { ...none, input: 1e6 })).toBe(4)
    expect(costOf("claude-opus-5-5", { ...none, output: 1e6 })).toBe(20)
    expect(costOf("claude-opus-5-5", { ...none, cacheRead: 1e6 })).toBeCloseTo(0.2)
    expect(costOf("claude-sonnet-5-5", { ...none, cacheRead: 1e6 })).toBeCloseTo(0.1)
  })

  test("prices Haiku 5.5 at its base tier", () => {
    expect(costOf("claude-haiku-5-5", { ...none, input: 1e6, output: 1e6 })).toBe(0.6)
    expect(costOf("claude-haiku-5-5", { ...none, cacheRead: 1e6 })).toBeCloseTo(0.01)
    expect(costOf("claude-haiku-5-5", { ...none, cacheWrite: 1e6 })).toBe(0.125)
    expect(costOf("claude-haiku-5-5", { ...none, cacheWrite: 1e6, cacheWrite1h: 1e6 })).toBe(0.2)
  })

  test("charges a 5-minute write at 1.25x input and an hour-long one at 2x", () => {
    expect(costOf("claude-sonnet-5-5", { ...none, cacheWrite: 1e6 })).toBe(2.5)
    expect(costOf("claude-sonnet-5-5", { ...none, cacheWrite: 1e6, cacheWrite1h: 1e6 })).toBe(4)
    expect(costOf("claude-sonnet-5-5", { ...none, cacheWrite: 1e6, cacheWrite1h: 5e5 })).toBe(3.25)
  })

  test("never counts more hour-long writes than writes", () => {
    expect(costOf("claude-sonnet-5-5", { ...none, cacheWrite: 1e6, cacheWrite1h: 9e6 })).toBe(4)
  })

  test("prices the older models still listed on the pricing page", () => {
    expect(costOf("claude-opus-4-5-20251101", { ...none, input: 1e6, output: 1e6 })).toBe(30)
    expect(costOf("claude-sonnet-4-5-20250929", { ...none, input: 1e6, output: 1e6 })).toBe(18)
    expect(costOf("claude-sonnet-4-5", { ...none, cacheRead: 1e6 })).toBeCloseTo(0.3)
  })

  test("prices a dated id as its model and an unknown model as nothing", () => {
    expect(costOf("claude-haiku-4-5-20251001", { ...none, input: 1e6 })).toBe(1)
    expect(costOf("claude-mystery-9", { ...none, input: 1e6 })).toBeNull()
    expect(costOf(null, { ...none, input: 1e6 })).toBeNull()
  })

  test("keeps the table's keys A to Z, each without a date", () => {
    const keys = Object.keys(PRICES)
    expect(keys).toEqual([...keys].sort())
    for (const key of keys) expect(modelKey(key)).toBe(key)
  })

  test("prices a glm session at Z.ai's rates, so its usage reads like any other model's", () => {
    expect(PRICES["glm-5.3-flash"]).toEqual({ cacheRead: 0.03, input: 0.15, output: 0.5 })
    expect(costOf("glm-5.3-flash[1m]", { ...none, input: 1e6, output: 1e6 })).toBeCloseTo(0.65)
  })
})
