import { describe, expect, test } from "bun:test"

import { duration, remaining, remainingRange } from "../../../../../web/next/src/lib/eta"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const NOW = Date.parse("2026-10-06T12:00:00Z")
const at = (ms: number) => new Date(NOW + ms).toISOString()

describe("duration", () => {
  test("minutes, exact and with no tilde", () => {
    expect(duration(42 * MINUTE)).toBe("42m")
    expect(duration(42 * MINUTE + 59_000)).toBe("42m")
    expect(duration(30_000)).toBe("0m")
  })

  test("hours with minutes", () => {
    expect(duration(3 * HOUR + 12 * MINUTE)).toBe("3h 12m")
    expect(duration(3 * HOUR)).toBe("3h")
  })

  test("days with hours", () => {
    expect(duration(52 * HOUR + 30 * MINUTE)).toBe("2d 4h")
    expect(duration(48 * HOUR)).toBe("2d")
  })

  test("a negative or unreadable length reads as none", () => {
    expect(duration(-MINUTE)).toBe("0m")
    expect(duration(Number.NaN)).toBe("0m")
  })
})

describe("remaining", () => {
  test("minutes left, approximate", () => {
    expect(remaining(at(20 * MINUTE), NOW)).toBe("~20m left")
    expect(remaining(at(20_000), NOW)).toBe("~1m left")
  })

  test("hours with minutes left, to five minutes", () => {
    expect(remaining(at(2 * HOUR + 31 * MINUTE), NOW)).toBe("~2h 30m left")
    expect(remaining(at(HOUR + MINUTE), NOW)).toBe("~1h left")
    expect(remaining(at(59 * MINUTE + 50_000), NOW)).toBe("~1h left")
  })

  test("days with hours left", () => {
    expect(remaining(at(52 * HOUR + 20 * MINUTE), NOW)).toBe("~2d 4h left")
  })

  test("overdue N, exact", () => {
    expect(remaining(at(-15 * MINUTE), NOW)).toBe("overdue 15m")
    expect(remaining(at(-(HOUR + 2 * MINUTE)), NOW)).toBe("overdue 1h 2m")
    expect(remaining(at(0), NOW)).toBe("overdue 1m")
  })

  test("from now, for a start or a finish", () => {
    expect(remaining(at(20 * MINUTE), NOW, "in")).toBe("in ~20m")
    expect(remaining(at(-15 * MINUTE), NOW, "in")).toBe("overdue 15m")
  })

  test("no time, or one that does not read, is none", () => {
    expect(remaining(null, NOW)).toBeNull()
    expect(remaining(undefined, NOW)).toBeNull()
    expect(remaining("soon", NOW)).toBeNull()
  })
})

describe("remainingRange", () => {
  test("both ends ahead read as a range", () => {
    expect(remainingRange(at(20 * MINUTE), at(HOUR + 10 * MINUTE), NOW)).toBe(
      "~20m to ~1h 10m left",
    )
    expect(remainingRange(at(20 * MINUTE), at(40 * MINUTE), NOW, "in")).toBe("in ~20m to ~40m")
  })

  test("an early end passed reads as the late end alone", () => {
    expect(remainingRange(at(-5 * MINUTE), at(40 * MINUTE), NOW)).toBe("~40m left")
  })

  test("both ends passed read as overdue from the late end", () => {
    expect(remainingRange(at(-HOUR), at(-15 * MINUTE), NOW)).toBe("overdue 15m")
  })

  test("a missing end reads as the other alone", () => {
    expect(remainingRange(null, at(40 * MINUTE), NOW)).toBe("~40m left")
    expect(remainingRange(at(20 * MINUTE), null, NOW)).toBe("~20m left")
    expect(remainingRange(null, null, NOW)).toBeNull()
  })
})
