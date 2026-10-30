import { describe, expect, test } from "bun:test"

import { istTime, prLabel, statusLabel } from "../../../../../web/next/src/lib/plan"

describe("statusLabel", () => {
  test("puts the planner's codes in plain words, keeping what follows as written", () => {
    expect(statusLabel("READY")).toBe("Ready")
    expect(statusLabel("WAITS ON #106")).toBe("Waits on #106")
    expect(statusLabel("WAITS ON 06.0, stream PR 2, 14a")).toBe("Waits on 06.0, stream PR 2, 14a")
    expect(statusLabel("IN FLIGHT")).toBe("In flight")
  })

  test("leaves a status it does not know as written, and shows none as a dash", () => {
    expect(statusLabel("READYING")).toBe("READYING")
    expect(statusLabel("Building")).toBe("Building")
    expect(statusLabel(undefined)).toBe("-")
  })
})

describe("istTime", () => {
  test("shows a moment in India's time, with its weekday", () => {
    expect(istTime("2026-10-06T19:57:00+00:00")).toBe("Wed 01:27")
    expect(istTime("2026-10-06T10:00:00Z")).toBe("Tue 15:30")
  })

  test("shows none as a dash", () => {
    expect(istTime(null)).toBe("-")
  })
})

test("prLabel is a pull request's number", () => {
  expect(prLabel("https://github.com/example/app/pull/107")).toBe("#107")
})
