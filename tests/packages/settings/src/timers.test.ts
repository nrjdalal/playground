import { describe, expect, test } from "bun:test"

import { checkSetting, cronMatches, timerSettings } from "../../../../packages/settings/src"

const row = { cron: "0 17 * * 1-5", name: "report", text: "start the report", to: "builder" }

describe("the timers setting", () => {
  test("is an empty list by default", () => {
    expect(timerSettings.get({ schemaVersion: 1, values: {} }, "timers")).toEqual([])
  })

  test("takes a row whose cron the beat reads", () => {
    expect(checkSetting("timers", [row])).toEqual({ key: "timers", ok: true, value: [row] })
  })

  test.each([
    ["a cron that is not 5 fields", { ...row, cron: "every 5" }],
    ["a cron field out of range", { ...row, cron: "61 * * * *" }],
    ["a to the relay would send to ops instead", { ...row, to: "Builder" }],
    ["an empty text", { ...row, text: "" }],
  ])("refuses %s", (_, bad) => {
    expect(checkSetting("timers", [bad]).ok).toBe(false)
  })

  test("refuses two rows of one name", () => {
    expect(checkSetting("timers", [row, { ...row, cron: "*/10 * * * *" }]).ok).toBe(false)
  })
})

// Machine wall time, as the timers beat reads a cron.
const at = (hour: number, minute: number) => new Date(2026, 9, 19, hour, minute, 10)

describe("cronMatches", () => {
  test("reads minute lists, steps and hours in machine wall time", () => {
    expect(cronMatches("3,18,33,48 * * * *", at(13, 33))).toBe(true)
    expect(cronMatches("3,18,33,48 * * * *", at(13, 34))).toBe(false)
    expect(cronMatches("*/5 * * * *", at(9, 55))).toBe(true)
    expect(cronMatches("7 */2 * * *", at(14, 7))).toBe(true)
    expect(cronMatches("7 */2 * * *", at(13, 7))).toBe(false)
    expect(cronMatches("13 21 * * *", at(21, 13))).toBe(true)
  })

  test("matches day of month and day of week both, where standard cron takes either", () => {
    expect(cronMatches("0 9 19 * 1", at(9, 0))).toBe(true)
    expect(cronMatches("0 9 19 * 2", at(9, 0))).toBe(false)
  })

  test("refuses a cron it cannot read", () => {
    expect(() => cronMatches("every 5", at(1, 1))).toThrow()
    expect(() => cronMatches("61 * * * *", at(1, 1))).toThrow()
  })
})
