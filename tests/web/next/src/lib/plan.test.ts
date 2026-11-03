import { describe, expect, test } from "bun:test"

import { prLabel, statusLabel, zoneTime } from "../../../../../web/next/src/lib/plan"

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

describe("zoneTime", () => {
  test("shows a moment in the owner's zone, with its weekday and the zone's own name", () => {
    expect(zoneTime("2026-10-06T19:57:00+00:00", "Asia/Kolkata")).toBe("Wed 01:27 IST")
    expect(zoneTime("2026-10-06T19:57:00+00:00", "UTC")).toBe("Tue 19:57 UTC")
    expect(zoneTime("2026-10-06T10:00:00Z", "Asia/Kolkata")).toBe("Tue 15:30 IST")
    expect(zoneTime("2026-10-06T10:00:00Z", "UTC")).toBe("Tue 10:00 UTC")
  })

  test("shows none, or a zone not yet read, as a dash", () => {
    expect(zoneTime(null, "UTC")).toBe("-")
    expect(zoneTime("2026-10-06T10:00:00Z", undefined)).toBe("-")
  })
})

test("prLabel is a pull request's number", () => {
  expect(prLabel("https://github.com/example/app/pull/107")).toBe("#107")
})
