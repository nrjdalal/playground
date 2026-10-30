import { describe, expect, test } from "bun:test"

import { fullTime, messageTime } from "../../../../../web/next/src/lib/time"

// Built from local parts, so the tests read the same in any time zone.
const NOW = new Date(2026, 9, 6, 21, 0)

describe("messageTime", () => {
  test("a message from today shows its clock alone", () => {
    expect(messageTime(new Date(2026, 9, 6, 19, 37, 4), NOW, "en-US")).toBe("7:37 PM")
  })

  test("a message from an earlier day shows its day before the clock", () => {
    expect(messageTime(new Date(2026, 9, 5, 19, 37), NOW, "en-US")).toBe("Oct 5, 7:37 PM")
  })

  test("a message from an earlier year shows the year too", () => {
    expect(messageTime(new Date(2025, 11, 31, 9, 5), NOW, "en-US")).toBe("Dec 31, 2025, 9:05 AM")
  })

  test("reads an ISO string as the stored time, and a time that does not parse as nothing", () => {
    const at = new Date(2026, 9, 6, 8, 15)
    expect(messageTime(at.toISOString(), NOW, "en-US")).toBe("8:15 AM")
    expect(messageTime("not a time", NOW, "en-US")).toBe("")
  })
})

describe("fullTime", () => {
  test("gives the date and the seconds, for a hover", () => {
    // the Mac's ICU joins the date and the clock with " at", Linux's with a comma
    expect(fullTime(new Date(2026, 9, 6, 19, 37, 4), "en-US")).toMatch(
      /^Oct 6, 2026(,| at) 7:37:04\sPM$/,
    )
    expect(fullTime("not a time", "en-US")).toBe("")
  })
})
