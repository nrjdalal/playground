import { describe, expect, test } from "bun:test"

import { checkSetting, timerSettings } from "../../../../packages/settings/src"

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
