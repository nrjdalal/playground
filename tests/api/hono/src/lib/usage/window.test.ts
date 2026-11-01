import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  readAccountUsages,
  readUsage,
  usageOf,
  usagePath,
  withSeen,
} from "../../../../../../api/hono/src/lib/usage/window"
import { liveReads } from "../../../../../live-reads"

// These drive the live paths against the test's own scratch files.
liveReads()

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

const NOW = new Date("2026-10-06T08:30:00Z")

// What the ops-usage job writes: the rate_limits it read, and when.
const file = (writtenAt: string, limits: Record<string, unknown>) =>
  JSON.stringify({ rate_limits: limits, writtenAt })

describe("usageOf", () => {
  test("each window's used share and reset time, fresh while the usage job keeps writing", () => {
    const text = file("2026-10-06T08:25:00Z", {
      five_hour: { resets_at: 1791291600, used_percentage: 16 },
      seven_day: { resets_at: 1791817200, used_percentage: 21 },
    })
    expect(usageOf(text, NOW)).toEqual({
      fiveHour: { resetsAt: "2026-10-06T13:00:00.000Z", usedPercent: 16 },
      sevenDay: { resetsAt: "2026-10-12T15:00:00.000Z", usedPercent: 21 },
      stale: false,
      writtenAt: "2026-10-06T08:25:00.000Z",
    })
  })

  test("a file older than ten minutes is stale; a window it lacks is null", () => {
    const text = file("2026-10-06T08:19:00Z", { five_hour: { used_percentage: 40 } })
    expect(usageOf(text, NOW)).toEqual({
      fiveHour: { resetsAt: null, usedPercent: 40 },
      sevenDay: null,
      stale: true,
      writtenAt: "2026-10-06T08:19:00.000Z",
    })
  })

  test("the rotation the file carries, and none when it carries none or another shape", () => {
    const limits = { seven_day: { used_percentage: 1 } }
    const withRotation = (rotation: unknown) =>
      JSON.stringify({ rate_limits: limits, rotation, writtenAt: "2026-10-06T08:25:00Z" })
    const pool = [
      {
        account: "a@example.com",
        ending: true,
        endsAt: "2026-11-07T18:30:00+00:00",
        renewsOn: null,
      },
      { account: "b@example.com", ending: false, endsAt: null, renewsOn: 3 },
    ]
    expect(usageOf(withRotation({ pool }), NOW)?.rotation).toEqual({ pool })
    expect(
      usageOf(withRotation({ pool: [{ account: "c@example.com", ending: true }] }), NOW)?.rotation,
    ).toEqual({ pool: [{ account: "c@example.com", ending: true, endsAt: null, renewsOn: null }] })
    for (const renewsOn of [1.5, 0, 32])
      expect(
        usageOf(
          withRotation({ pool: [{ account: "d@example.com", ending: false, renewsOn }] }),
          NOW,
        ),
      ).not.toHaveProperty("rotation")
    expect(usageOf(file("2026-10-06T08:25:00Z", limits), NOW)).not.toHaveProperty("rotation")
    expect(usageOf(withRotation({ pool: ["a@example.com"] }), NOW)).not.toHaveProperty("rotation")
    expect(
      usageOf(withRotation({ pool: [{ account: "a@example.com", ending: "yes" }] }), NOW),
    ).not.toHaveProperty("rotation")
  })

  test("no window, no time it was written, or no JSON is no usage", () => {
    expect(usageOf(file("2026-10-06T08:25:00Z", {}), NOW)).toBeNull()
    expect(
      usageOf(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 1 } } }), NOW),
    ).toBeNull()
    expect(usageOf(file("yesterday", { five_hour: { used_percentage: 1 } }), NOW)).toBeNull()
    expect(usageOf("{", NOW)).toBeNull()
  })
})

describe("an account with no 5-hour window (#162)", () => {
  const probed = (limits: Record<string, unknown>, source = "token/ratelimit-headers") =>
    JSON.stringify({ rate_limits: limits, source, writtenAt: "2026-10-06T08:25:00Z" })

  test("a probe reading with a week and no five_hour is no 5-hour window, not a missing read", () => {
    expect(usageOf(probed({ seven_day: { used_percentage: 21 } }), NOW)).toMatchObject({
      fiveHour: null,
      fiveHourNone: true,
    })
  })

  test("a /usage reading that lacks five_hour, or a probe that has it, marks nothing", () => {
    expect(
      usageOf(probed({ seven_day: { used_percentage: 21 } }, "oauth/usage"), NOW)?.fiveHourNone,
    ).toBeUndefined()
    expect(
      usageOf(
        probed({ five_hour: { used_percentage: 4 }, seven_day: { used_percentage: 21 } }),
        NOW,
      )?.fiveHourNone,
    ).toBeUndefined()
  })

  test("withSeen never puts back a 5-hour window the account does not have", () => {
    const seen = {
      fiveHour: { resetsAt: null, seenAt: "2026-10-06T08:00:00.000Z", usedPercent: 40 },
    }
    expect(
      withSeen(usageOf(probed({ seven_day: { used_percentage: 21 } }), NOW)!, seen).fiveHour,
    ).toBeNull()
  })
})

describe("withSeen", () => {
  test("a window the file lacks is the last one it held, marked with when that was written; one never seen stays null", () => {
    const seen = {}
    const read = (writtenAt: string, limits: Record<string, unknown>) =>
      withSeen(usageOf(file(writtenAt, limits), NOW)!, seen)
    expect(read("2026-10-06T08:20:00Z", { seven_day: { used_percentage: 21 } }).fiveHour).toBeNull()
    const fresh = read("2026-10-06T08:25:00Z", {
      five_hour: { used_percentage: 40 },
      seven_day: { used_percentage: 21 },
    })
    expect(fresh.fiveHour).toEqual({ resetsAt: null, usedPercent: 40 })
    expect(fresh.sevenDay).toEqual({ resetsAt: null, usedPercent: 21 })
    const after = read("2026-10-06T08:29:00Z", { seven_day: { used_percentage: 22 } })
    expect(after.fiveHour).toEqual({
      resetsAt: null,
      seenAt: "2026-10-06T08:25:00.000Z",
      usedPercent: 40,
    })
    expect(after.sevenDay).toEqual({ resetsAt: null, usedPercent: 22 })
  })
})

describe("readUsage", () => {
  test("reads the file, and a missing one is no usage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-"))
    dirs.push(dir)
    const path = join(dir, "usage.json")
    expect(await readUsage(path, NOW)).toBeNull()
    writeFileSync(path, file("2026-10-06T08:29:00Z", { seven_day: { used_percentage: 21 } }))
    expect((await readUsage(path, NOW))?.sevenDay).toEqual({ resetsAt: null, usedPercent: 21 })
  })

  test("the file sits in the data folder PLAYGROUND_DATA_DIR names", () => {
    const before = process.env.PLAYGROUND_DATA_DIR
    process.env.PLAYGROUND_DATA_DIR = "/x/data"
    try {
      expect(usagePath()).toBe("/x/data/usage.json")
    } finally {
      if (before === undefined) delete process.env.PLAYGROUND_DATA_DIR
      else process.env.PLAYGROUND_DATA_DIR = before
    }
  })
})

describe("readAccountUsages", () => {
  test("every usage-*.json, labelled by its account, the main login first and the rest A to Z", async () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-"))
    dirs.push(dir)
    const limits = { seven_day: { used_percentage: 21 } }
    const write = (name: string, account?: string) =>
      writeFileSync(
        join(dir, name),
        JSON.stringify({ account, rate_limits: limits, writtenAt: "2026-10-06T08:29:00Z" }),
      )
    write("usage-b.json", "zed@example.com")
    write("usage-c.json", "Main@example.com")
    write("usage-d.json", "ada@example.com")
    // usage.json counts under the account it names, zai-usage.json is GLM's, and a file naming no account has no label
    write("usage.json", "zed@example.com")
    write("zai-usage.json", "glm@example.com")
    write("usage-e.json")
    writeFileSync(join(dir, "usage-f.json"), "{")
    // a file naming an account but holding no window is left out
    writeFileSync(
      join(dir, "usage-g.json"),
      JSON.stringify({ account: "bo@example.com", writtenAt: "2026-10-06T08:29:00Z" }),
    )
    const accounts = await readAccountUsages("main@example.com", dir, NOW)
    expect(accounts.map((a) => a.account)).toEqual([
      "Main@example.com",
      "ada@example.com",
      "zed@example.com",
    ])
    expect(accounts[0]!.usage.sevenDay).toEqual({ resetsAt: null, usedPercent: 21 })
    // with no main login, A to Z alone
    expect((await readAccountUsages(null, dir, NOW)).map((a) => a.account)).toEqual([
      "ada@example.com",
      "Main@example.com",
      "zed@example.com",
    ])
    expect(await readAccountUsages(null, join(dir, "missing"), NOW)).toEqual([])
  })

  test("two files naming one account, in any case, show once, the later written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-"))
    dirs.push(dir)
    const write = (name: string, account: string, used: number, writtenAt: string) =>
      writeFileSync(
        join(dir, name),
        JSON.stringify({
          account,
          rate_limits: { seven_day: { used_percentage: used } },
          writtenAt,
        }),
      )
    write("usage-a.json", "ada@example.com", 30, "2026-10-06T08:29:00Z")
    write("usage-b.json", "Ada@Example.com", 10, "2026-10-06T08:20:00Z")
    const accounts = await readAccountUsages(null, dir, NOW)
    expect(accounts.map((a) => a.usage.sevenDay?.usedPercent)).toEqual([30])
  })

  test("a fresh usage.json beats an older usage-<name>.json of the account it names", async () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-"))
    dirs.push(dir)
    const write = (name: string, used: number, writtenAt: string) =>
      writeFileSync(
        join(dir, name),
        JSON.stringify({
          account: "main@example.com",
          rate_limits: { seven_day: { used_percentage: used } },
          writtenAt,
        }),
      )
    write("usage-main.json", 40, "2026-10-06T02:24:00Z")
    write("usage.json", 55, "2026-10-06T08:29:00Z")
    const accounts = await readAccountUsages("main@example.com", dir, NOW)
    expect(accounts.map((a) => [a.usage.sevenDay?.usedPercent, a.usage.stale])).toEqual([
      [55, false],
    ])
  })
  // usage.json's accounts map, as ops-usage's accounts_reading() writes it: each account the factory spends into, its week share, the week's reset in seconds, and when it was read.
  const withMap = (accounts: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), "usage-"))
    dirs.push(dir)
    writeFileSync(
      join(dir, "usage.json"),
      JSON.stringify({
        account: "main@example.com",
        accounts,
        rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 30 } },
        writtenAt: "2026-10-06T08:29:00Z",
      }),
    )
    return dir
  }

  test("an account only usage.json's accounts map reads lists, with its week reading and no 5-hour reading", async () => {
    const dir = withMap({
      "bo@example.com": { readAt: "2026-10-06T08:28:00Z", week: 64, weekReset: 1791000000 },
      "cy@example.com": { readAt: "2026-10-06T08:00:00Z", week: 9, weekReset: 1791100000 },
      // an entry off its shape is left out
      "dee@example.com": { readAt: "2026-10-06T08:28:00Z", week: "64" },
    })
    const accounts = await readAccountUsages("main@example.com", dir, NOW)
    expect(accounts.map((a) => a.account)).toEqual([
      "main@example.com",
      "bo@example.com",
      "cy@example.com",
    ])
    expect(accounts[1]!.usage).toEqual({
      fiveHour: null,
      sevenDay: { resetsAt: new Date(1791000000 * 1000).toISOString(), usedPercent: 64 },
      stale: false,
      writtenAt: "2026-10-06T08:28:00.000Z",
    })
    // read 30 minutes before NOW, so stale as an old file is
    expect(accounts[2]!.usage.stale).toBe(true)
  })

  test("a fresh usage file wins over a map entry for the same account, newer or not; a stale file gives way to a newer entry", async () => {
    const dir = withMap({
      "ada@example.com": { readAt: "2026-10-06T08:20:00Z", week: 80, weekReset: 1791000000 },
      "bo@example.com": { readAt: "2026-10-06T08:28:00Z", week: 64, weekReset: 1791000000 },
      "cy@example.com": { readAt: "2026-10-06T08:28:00Z", week: 50, weekReset: 1791000000 },
      // the map's entry for usage.json's own account, read as the file was, keeps the file's 5-hour reading
      "main@example.com": { readAt: "2026-10-06T08:29:00Z", week: 30, weekReset: 1791000000 },
    })
    const write = (name: string, account: string, used: number, writtenAt: string) =>
      writeFileSync(
        join(dir, name),
        JSON.stringify({
          account,
          rate_limits: { five_hour: { used_percentage: 5 }, seven_day: { used_percentage: used } },
          writtenAt,
        }),
      )
    write("usage-ada.json", "Ada@example.com", 70, "2026-10-06T08:25:00Z")
    write("usage-bo.json", "bo@example.com", 40, "2026-10-06T06:00:00Z")
    // fresh, though older than its map entry, so it keeps its 5-hour reading
    write("usage-cy.json", "cy@example.com", 45, "2026-10-06T08:22:00Z")
    const accounts = await readAccountUsages("main@example.com", dir, NOW)
    expect(
      accounts.map((a) => [
        a.account,
        a.usage.sevenDay?.usedPercent,
        a.usage.fiveHour?.usedPercent ?? null,
      ]),
    ).toEqual([
      ["main@example.com", 30, 12],
      ["Ada@example.com", 70, 5],
      ["bo@example.com", 64, null],
      ["cy@example.com", 45, 5],
    ])
  })
})
