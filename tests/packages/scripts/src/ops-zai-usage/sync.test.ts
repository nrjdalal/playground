import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  beat,
  cycle,
  emptyBalanceAt,
  windowsOf,
  zaiQuota,
  BALANCE_HOLD_MS,
  CYCLE_SECONDS,
} from "../../../../../packages/scripts/src/ops-zai-usage/sync"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "ops-zai-usage-"))
  dirs.push(dir)
  return dir
}

const FIVE_RESET = 1794864000000
const WEEK_RESET = 1795113600000
const LIMITS = [
  {
    currentValue: 11480,
    nextResetTime: FIVE_RESET,
    number: 5,
    percentage: 41,
    remaining: 16520,
    type: "CREDIT_LIMIT",
    unit: 3,
    usage: 28000,
  },
  {
    currentValue: 39900,
    nextResetTime: WEEK_RESET,
    number: 1,
    percentage: 28.5,
    remaining: 100100,
    type: "CREDIT_LIMIT",
    unit: 6,
    usage: 140000,
  },
]

describe("windowsOf", () => {
  test("maps unit 3 with number 5 to the 5-hour window and unit 6 with number 1 to the week", () => {
    expect(windowsOf(LIMITS)).toEqual({
      fiveHour: { cap: 28000, resetsAt: new Date(FIVE_RESET).toISOString(), used: 11480 },
      week: { cap: 140000, resetsAt: new Date(WEEK_RESET).toISOString(), used: 39900 },
    })
  })

  test("keeps a window whose reset time the answer lacks", () => {
    expect(
      windowsOf([
        {
          currentValue: 0,
          nextResetTime: null,
          number: 1,
          type: "CREDIT_LIMIT",
          unit: 6,
          usage: 140000,
        },
      ]),
    ).toEqual({ fiveHour: null, week: { cap: 140000, resetsAt: null, used: 0 } })
  })

  test("keeps an answer that holds the five-hour window alone, its week unread", () => {
    expect(windowsOf(LIMITS.slice(0, 1))).toEqual({
      fiveHour: { cap: 28000, resetsAt: new Date(FIVE_RESET).toISOString(), used: 11480 },
      week: null,
    })
  })

  test("refuses an answer that holds no whole credit window", () => {
    expect(
      windowsOf([
        { type: "OTHER_LIMIT", unit: 3, number: 5, usage: 1, currentValue: 1, nextResetTime: 1 },
        { currentValue: 1, nextResetTime: 1, number: 5, type: "CREDIT_LIMIT", unit: 3, usage: 0 },
        "not a limit",
      ]),
    ).toBeNull()
    expect(windowsOf([])).toBeNull()
    expect(windowsOf(undefined)).toBeNull()
  })
})

describe("zaiQuota", () => {
  const ok = (async () =>
    new Response(
      JSON.stringify({
        code: 200,
        data: { level: "max", limits: LIMITS },
        msg: "ok",
        success: true,
      }),
      {
        status: 200,
      },
    )) as unknown as typeof fetch

  test("hands back the data only when the body says it succeeded", async () => {
    const data = (await zaiQuota("zai_key", ok)) as { limits: unknown[] }
    expect(data.limits).toHaveLength(2)
  })

  test("refuses a 200 whose body says the call failed", async () => {
    const refused = (async () =>
      new Response(JSON.stringify({ code: 1001, msg: "unauthorized", success: false }), {
        status: 200,
      })) as unknown as typeof fetch
    await expect(zaiQuota("zai_key", refused)).rejects.toThrow("code 1001")
  })

  test("refuses an empty key without calling", async () => {
    await expect(zaiQuota("", ok)).rejects.toThrow("Keychain")
  })

  test("masks the key in a network failure", async () => {
    const broken = (async () =>
      Promise.reject(new Error("boom for zai_key"))) as unknown as typeof fetch
    await expect(zaiQuota("zai_key", broken)).rejects.toThrow("boom for ***")
  })
})

describe("cycle", () => {
  test("writes the windows with a writtenAt and reports ok", async () => {
    const path = join(scratch(), "zai-usage.json")
    const now = new Date("2026-10-16T15:00:00.000Z")
    expect(await cycle(async () => ({ limits: LIMITS }), path, now)).toBe("ok")
    const written = JSON.parse(await readFile(path, "utf8")) as {
      windows: { fiveHour: { cap: number } }
      writtenAt: string
    }
    expect(written.writtenAt).toBe("2026-10-16T15:00:00.000Z")
    expect(written.windows.fiveHour.cap).toBe(28000)
  })

  test("marks the balance empty while a GLM session's empty-balance failure is in its hold", async () => {
    const path = join(scratch(), "zai-usage.json")
    const now = new Date("2026-10-16T15:00:00.000Z")
    const seen = async () => "2026-10-16T14:40:00.000Z"
    expect(await cycle(async () => ({ limits: LIMITS }), path, now, seen)).toBe("ok")
    const written = JSON.parse(await readFile(path, "utf8")) as { balance?: unknown }
    expect(written.balance).toEqual({ empty: true, seenAt: "2026-10-16T14:40:00.000Z" })
    expect(await cycle(async () => ({ limits: LIMITS }), path, now)).toBe("ok")
    expect(
      (JSON.parse(await readFile(path, "utf8")) as { balance?: unknown }).balance,
    ).toBeUndefined()
  })

  test("reports why it failed and writes the error over the last file's windows", async () => {
    const dir = scratch()
    const path = join(dir, "zai-usage.json")
    const now = new Date("2026-10-16T15:05:00.000Z")
    expect(await cycle(async () => ({ limits: [] }), path, now)).toBe(
      "no credit window in the answer",
    )
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      error: "no credit window in the answer",
      errorAt: "2026-10-16T15:05:00.000Z",
    })
    await cycle(async () => ({ limits: LIMITS }), path, new Date("2026-10-16T15:10:00.000Z"))
    await cycle(async () => Promise.reject(new Error("Z.ai 401: code 1001")), path, now)
    const failed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
    expect(failed.error).toBe("Z.ai 401: code 1001")
    expect(failed.writtenAt).toBe("2026-10-16T15:10:00.000Z")
    expect(failed.windows).toBeDefined()
  })
})

describe("emptyBalanceAt", () => {
  const now = new Date("2026-10-31T03:00:00.000Z")
  const state = (dir: string, id: string, record: Record<string, unknown>) =>
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({ event: "StopFailure", sessionId: id, ...record }),
    )

  test("names the newest empty-balance failure within the hold, and no other failure", async () => {
    const dir = join(scratch(), "session-state")
    mkdirSync(dir)
    state(dir, "a", { at: "2026-10-31T02:05:11.819Z", reason: "balance", state: "failed" })
    state(dir, "b", { at: "2026-10-31T02:30:00.000Z", reason: "balance", state: "failed" })
    state(dir, "c", { at: "2026-10-31T02:55:00.000Z", reason: "rate_limit", state: "failed" })
    state(dir, "d", { at: "2026-10-31T02:56:00.000Z", state: "working" })
    writeFileSync(join(dir, "e.json"), "{ nope")
    expect(await emptyBalanceAt(dir, now)).toBe("2026-10-31T02:30:00.000Z")
  })

  test("lets the flag lapse once the newest failure is older than the hold, so one start can try again", async () => {
    const dir = join(scratch(), "session-state")
    mkdirSync(dir)
    const old = new Date(now.getTime() - BALANCE_HOLD_MS - 1000).toISOString()
    state(dir, "a", { at: old, reason: "balance", state: "failed" })
    expect(await emptyBalanceAt(dir, now)).toBeNull()
    expect(await emptyBalanceAt(join(dir, "missing"), now)).toBeNull()
  })

  test("holds for an hour", () => {
    expect(BALANCE_HOLD_MS).toBe(60 * 60 * 1000)
  })
})

test("CYCLE_SECONDS is five minutes", () => {
  expect(CYCLE_SECONDS).toBe(300)
})

describe("beat", () => {
  test("names the job, its cycle and the last result", async () => {
    const path = join(scratch(), "ops-zai-usage.json")
    await beat(
      path,
      new Date("2026-10-16T14:00:00.000Z"),
      new Date("2026-10-16T15:00:00.000Z"),
      "ok",
    )
    const written = JSON.parse(await readFile(path, "utf8")) as {
      cycleSeconds: number
      job: string
      lastResult: string
    }
    expect(written.job).toBe("ops-zai-usage")
    expect(written.cycleSeconds).toBe(300)
    expect(written.lastResult).toBe("ok")
  })
})
