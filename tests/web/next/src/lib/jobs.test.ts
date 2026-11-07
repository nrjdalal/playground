import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

// jobs.ts registers the job keys, by relative path, since @/ here is web/next/src
import { JOBS, jobKey } from "../../../../../packages/settings/src/jobs"
import { loginPath } from "../../../../../packages/settings/src/rendered"
import {
  listSettings,
  readSetting,
  setSetting,
} from "../../../../../packages/settings/src/settings-folder"
import { jobRows, jobToggleWrite } from "../../../../../web/next/src/lib/jobs"

const scratch = mkdtempSync(join(tmpdir(), "jobs-toggle-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const ME = "made-up-me"
const WHO = { actor: "made-up-user-id", author: "owner", inboxRef: null, reason: "test" }

// A data folder whose extensions have your login, as Set up settings leaves it.
const setUp = (name: string) => {
  const data = join(scratch, name)
  mkdirSync(dirname(loginPath(data)), { recursive: true })
  writeFileSync(loginPath(data), `${ME}\n`)
  return data
}

// The toggle's write as the settings API stores it: PUT /api/v1/settings/:key's body, through setSetting.
const save = (data: string, write: ReturnType<typeof jobToggleWrite>) =>
  setSetting(
    data,
    { key: write.param.key, scope: write.json.scope, value: write.json.value },
    { ...WHO, reason: write.json.reason },
  )

describe("Settings > Jobs (PG-1196)", () => {
  test("lists every registry job by name, A to Z, with its description, schedule, state and whether a setting sets it", () => {
    const data = setUp("list")
    const rows = jobRows(listSettings(data), ME)
    expect(rows.map((row) => row.name)).toEqual(Object.keys(JOBS))
    expect(rows.find((row) => row.name === "ops-sweep")).toEqual({
      description: JOBS["ops-sweep"]!.description,
      enabled: false,
      key: jobKey("ops-sweep"),
      name: "ops-sweep",
      row: undefined,
      schedule: JOBS["ops-sweep"]!.schedule,
      set: false,
    })
    expect(rows.find((row) => row.name === "ops-dashboard")).toMatchObject({
      enabled: true,
      set: false,
    })
  })

  test("a toggle stores the job's enabled field alone at your login's scope, so the job still reads the registry's", () => {
    const data = setUp("toggle")
    const key = jobKey("ops-ticket-card")
    const card = jobRows(listSettings(data), ME).find((row) => row.key === key)!
    const write = jobToggleWrite(card, true, ME)
    expect(write).toEqual({
      json: {
        by: "Settings",
        reason: "Turned ops-ticket-card on in Settings > Jobs",
        scope: ME,
        value: { enabled: true },
      },
      param: { key },
    })
    expect(save(data, write).ok).toBe(true)
    const read = readSetting(data, key)!
    expect(read.rows).toEqual([{ key, scope: ME, value: { enabled: true } }])
    expect(read.value).toEqual({ ...JOBS["ops-ticket-card"], enabled: true })
    expect(jobRows(listSettings(data), ME).find((row) => row.key === key)).toMatchObject({
      enabled: true,
      set: true,
    })
  })

  test("a toggle keeps the other fields your scope's row holds, and turns the job back off", () => {
    const data = setUp("keep")
    const key = jobKey("ops-sweep")
    expect(
      setSetting(data, { key, scope: ME, value: { enabled: true, pausedFor: "made-up" } }, WHO).ok,
    ).toBe(true)
    const row = jobRows(listSettings(data), ME).find((each) => each.key === key)!
    const write = jobToggleWrite(row, false, ME)
    expect(write.json).toMatchObject({
      reason: "Turned ops-sweep off in Settings > Jobs",
      value: { enabled: false, pausedFor: "made-up" },
    })
    expect(save(data, write).ok).toBe(true)
    expect(readSetting(data, key)!.rows).toEqual([
      { key, scope: ME, value: { enabled: false, pausedFor: "made-up" } },
    ])
  })
})
