import { describe, expect, test } from "bun:test"

import { CLOCK_SLACK_MS, isAhead } from "../../../../../api/hono/src/lib/clock"

const NOW = new Date("2026-10-31T21:43:00.000Z")
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

describe("isAhead", () => {
  test("is true only past the slack, and never for a time that does not parse", () => {
    expect(isAhead(at(CLOCK_SLACK_MS), NOW)).toBe(false)
    expect(isAhead(at(CLOCK_SLACK_MS + 1000), NOW)).toBe(true)
    expect(isAhead(at(-60_000), NOW)).toBe(false)
    expect(isAhead("soon", NOW)).toBe(false)
  })
})
