import { describe, expect, test } from "bun:test"

import {
  forecastLine,
  tokensLabel,
  topFor,
  usdLabel,
  wallLabel,
} from "../../../../../web/next/src/lib/usage"

type WindowView = Parameters<typeof forecastLine>[0]

const NOW = new Date(2026, 9, 6, 10, 0)

const local = (hour: number, minute = 0, date = 6) => new Date(2026, 9, date, hour, minute)

const clock = (at: Date) => at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })

const view = (overrides: Partial<WindowView>): WindowView => ({
  forecast: { beforeReset: true, perHour: 12.5, runsOutAt: local(15).toISOString() },
  resetsAt: local(17).toISOString(),
  usedPercent: 50,
  ...overrides,
})

describe("forecastLine", () => {
  test("a window with no reset time or no forecast has nothing to forecast against", () => {
    expect(forecastLine(view({ resetsAt: null }), NOW)).toBe("No reset time to forecast against")
    expect(forecastLine(view({ forecast: null }), NOW)).toBe("No reset time to forecast against")
  })

  test("a window with nothing used says when it resets", () => {
    const line = forecastLine(
      view({ forecast: { beforeReset: false, perHour: 0, runsOutAt: null } }),
      NOW,
    )
    expect(line).toBe(`Nothing used yet; resets ${clock(local(17))}`)
  })

  test("a burn that runs out first names the rate, when it runs out and the reset after it", () => {
    expect(forecastLine(view({}), NOW)).toBe(
      `At 12.5% an hour it runs out ${clock(local(15))}, before it resets ${clock(local(17))}`,
    )
  })

  test("a burn that lasts names the rate and the reset", () => {
    const line = forecastLine(
      view({ forecast: { beforeReset: false, perHour: 2, runsOutAt: local(23).toISOString() } }),
      NOW,
    )
    expect(line).toBe(`At 2.0% an hour it lasts until it resets ${clock(local(17))}`)
  })

  test("a time on another day carries its weekday", () => {
    const line = forecastLine(view({ resetsAt: local(9, 30, 7).toISOString() }), NOW)
    expect(line).toEndWith(`before it resets Wed ${clock(local(9, 30, 7))}`)
  })
})

describe("topFor", () => {
  const spend = (usd: number) => ({ calls: usd > 0 ? 1 : 0, tokens: 0, usd })
  const rows = [
    { id: "week-big", today: spend(0), week: spend(9) },
    { id: "week-mid", today: spend(1), week: spend(5) },
    { id: "today-only", today: spend(3), week: spend(3) },
    { id: "idle", today: spend(0), week: spend(0) },
  ]

  test("keeps the rows that spent in the period, costliest first", () => {
    expect(topFor(rows, "week").map((row) => row.id)).toEqual([
      "week-big",
      "week-mid",
      "today-only",
    ])
    expect(topFor(rows, "today").map((row) => row.id)).toEqual(["today-only", "week-mid"])
  })

  test("cuts each period to its own top, so the week never shows today's extras over its own", () => {
    expect(topFor(rows, "week", 2).map((row) => row.id)).toEqual(["week-big", "week-mid"])
    expect(topFor(rows, "today", 1).map((row) => row.id)).toEqual(["today-only"])
  })
})

describe("usdLabel", () => {
  test("dollars to the cent, with thousands grouped", () => {
    expect(usdLabel(0)).toBe("$0.00")
    expect(usdLabel(12.3456)).toBe("$12.35")
    expect(usdLabel(1234.5)).toBe("$1,234.50")
  })

  test("under a dollar keeps a tenth of a cent, so a cheap session does not read as free", () => {
    expect(usdLabel(0.0123)).toBe("$0.012")
    expect(usdLabel(0.5)).toBe("$0.50")
  })
})

describe("tokensLabel", () => {
  test("tokens as K, M or B with one decimal where it helps", () => {
    expect(tokensLabel(999)).toBe("999")
    expect(tokensLabel(450_000)).toBe("450K")
    expect(tokensLabel(12_345_678)).toBe("12.3M")
    expect(tokensLabel(1_500_000_000)).toBe("1.5B")
  })
})

describe("wallLabel", () => {
  test("minutes as hours and minutes, and a dash when unknown", () => {
    expect(wallLabel(null)).toBe("-")
    expect(wallLabel(40)).toBe("40m")
    expect(wallLabel(85)).toBe("1h 25m")
    expect(wallLabel(120)).toBe("2h 0m")
  })
})
