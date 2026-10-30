import { describe, expect, test } from "bun:test"

import { scheduleWords } from "../../../../packages/config/src/schedule"

// A machine on IST, viewed from IST, so the clock rows read exactly as the table spells them.
const IST = { machineUtcOffsetMinutes: 330, zone: "Asia/Kolkata" }

describe("scheduleWords", () => {
  test.each([
    { $label: "60s", every: 60, words: "Every minute" },
    { $label: "300s", every: 300, words: "Every 5 min" },
    { $label: "an hour", every: 3600, words: "Every hour" },
    { $label: "2 hours", every: 7200, words: "Every 2 hours" },
    { $label: "45s", every: 45, words: "Every 45 sec" },
  ])("every: $label", ({ every, words }) => {
    expect(scheduleWords({ every })).toBe(words)
  })

  test.each([
    { $label: "every minute", cron: "* * * * *", words: "Every minute" },
    { $label: "every 5 min", cron: "*/5 * * * *", words: "Every 5 min" },
    { $label: "every 2 hours", cron: "0 */2 * * *", words: "Every 2 hours" },
    { $label: "daily at 5", cron: "0 5 * * *", words: "Every day at 5:00 AM" },
    { $label: "weekdays at 5", cron: "0 5 * * 1-5", words: "Weekdays at 5:00 AM" },
    { $label: "mondays at 9:30", cron: "30 9 * * 1", words: "Mondays at 9:30 AM" },
  ])("cron: $label", ({ cron, words }) => {
    expect(scheduleWords({ cron }, IST)).toBe(words)
  })

  test.each([
    { $label: "a day-of-month", cron: "0 5 1 * *" },
    { $label: "a day-of-week list", cron: "30 9 * * 1,3" },
    { $label: "a minute step on a clock hour", cron: "30 */2 * * *" },
    { $label: "an unreadable minute step", cron: "*/90 * * * *" },
    { $label: "too few fields", cron: "not a cron" },
  ])("cron shown as written: $label", ({ cron }) => {
    expect(scheduleWords({ cron }, IST)).toBe(cron)
  })

  test("always", () => {
    expect(scheduleWords({ always: true })).toBe("Always running")
  })

  test.each([{}, { every: 0 }, { cron: "" }])("unscheduled: $label", (schedule) => {
    expect(scheduleWords(schedule)).toBe("Unscheduled")
  })

  test("a cron in another time zone: a 5:00 UTC machine read from Kolkata", () => {
    expect(
      scheduleWords({ cron: "0 5 * * *" }, { machineUtcOffsetMinutes: 0, zone: "Asia/Kolkata" }),
    ).toBe("Every day at 10:30 AM")
  })

  test("a zone apart shifts the day: a Monday 5:00 machine on IST reads Sunday evening in Bogota", () => {
    expect(
      scheduleWords(
        { cron: "0 5 * * 1" },
        { machineUtcOffsetMinutes: 330, zone: "America/Bogota" },
      ),
    ).toBe("Sundays at 6:30 PM")
  })
})
