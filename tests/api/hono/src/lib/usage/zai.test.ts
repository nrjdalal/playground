import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  ZAI_STALE_MS,
  zaiFailureOf,
  zaiProblem,
  zaiUsageOf,
} from "../../../../../../api/hono/src/lib/usage/zai"

const SAMPLE = JSON.stringify({
  windows: {
    fiveHour: { cap: 28000, resetsAt: "2026-10-16T20:00:00.000Z", used: 11480 },
    week: { cap: 140000, resetsAt: "2026-10-19T00:00:00.000Z", used: 39900 },
  },
  writtenAt: "2026-10-16T15:00:00.000Z",
})

describe("zaiUsageOf", () => {
  const now = new Date("2026-10-16T15:05:00.000Z")

  test("reads the two credit windows the job wrote", () => {
    expect(zaiUsageOf(SAMPLE, now)).toEqual({
      fiveHour: { cap: 28000, resetsAt: "2026-10-16T20:00:00.000Z", used: 11480 },
      stale: false,
      week: { cap: 140000, resetsAt: "2026-10-19T00:00:00.000Z", used: 39900 },
      writtenAt: "2026-10-16T15:00:00.000Z",
    })
  })

  test("reads an empty balance as both windows spent, whatever the quota endpoint said", () => {
    const empty = JSON.parse(SAMPLE) as Record<string, unknown>
    empty.balance = { empty: true, seenAt: "2026-10-16T14:40:00.000Z" }
    expect(zaiUsageOf(JSON.stringify(empty), now)).toMatchObject({
      fiveHour: { cap: 28000, used: 28000 },
      week: { cap: 140000, used: 140000 },
    })
  })

  test("reads no usage while the job reports a failed read, so the sidebar draws no GLM readings", () => {
    const failed = JSON.parse(SAMPLE) as Record<string, unknown>
    failed.error = "Z.ai 401: code 1001"
    failed.errorAt = "2026-10-16T15:04:00.000Z"
    expect(zaiUsageOf(JSON.stringify(failed), now)).toBeNull()
    expect(
      zaiUsageOf(
        JSON.stringify({
          error: "no credit window in the answer",
          errorAt: "2026-10-16T15:04:00.000Z",
        }),
        now,
      ),
    ).toBeNull()
  })

  test("marks the file stale past ten minutes", () => {
    expect(ZAI_STALE_MS).toBe(10 * 60 * 1000)
    expect(zaiUsageOf(SAMPLE, now)?.stale).toBe(false)
    expect(zaiUsageOf(SAMPLE, new Date("2026-10-16T15:10:00.001Z"))?.stale).toBe(true)
  })

  test("keeps one window alone and the other null", () => {
    const one = zaiUsageOf(
      JSON.stringify({
        windows: { fiveHour: null, week: { cap: 140000, resetsAt: null, used: 1 } },
        writtenAt: "2026-10-16T15:00:00.000Z",
      }),
      now,
    )
    expect(one?.fiveHour).toBeNull()
    expect(one?.week).toEqual({ cap: 140000, resetsAt: null, used: 1 })
  })

  test("refuses a file that is not the job's shape", () => {
    expect(zaiUsageOf("not json", now)).toBeNull()
    expect(zaiUsageOf("{}", now)).toBeNull()
    expect(
      zaiUsageOf(
        JSON.stringify({
          windows: { fiveHour: null, week: null },
          writtenAt: "2026-10-16T15:00:00.000Z",
        }),
        now,
      ),
    ).toBeNull()
    expect(
      zaiUsageOf(
        JSON.stringify({
          windows: { fiveHour: { cap: 0, resetsAt: null, used: 1 }, week: null },
          writtenAt: "2026-10-16T15:00:00.000Z",
        }),
        now,
      ),
    ).toBeNull()
  })

  test("parses the shipped fixture's zai-usage entry", async () => {
    const fixturePath = join(
      import.meta.dir,
      "../../../../../../api/hono/src/fixtures/dashboard.json",
    )
    const fixture = (await Bun.file(fixturePath).json()) as Record<string, unknown>
    const usage = zaiUsageOf(
      JSON.stringify((fixture.files as Record<string, unknown>)["playground/zai-usage.json"]),
      now,
    )
    expect(usage?.fiveHour?.cap).toBe(28000)
    expect(usage?.week?.cap).toBe(140000)
    expect(usage?.writtenAt).toBeTypeOf("string")
  })
})

describe("zaiProblem", () => {
  test("names a file the job stopped writing, and nothing else", () => {
    expect(zaiProblem(zaiUsageOf(SAMPLE, new Date("2026-10-16T15:10:00.001Z")))).toBe(
      "The GLM credit windows are stale: last written 2026-10-16T15:00:00.000Z",
    )
    expect(zaiProblem(zaiUsageOf(SAMPLE, new Date("2026-10-16T15:05:00.000Z")))).toBeNull()
    expect(zaiProblem(null)).toBeNull()
  })
})

describe("zaiFailureOf", () => {
  test("names a read the job wrote as failed, which zaiUsageOf reads as no usage", () => {
    const failed = JSON.stringify({
      ...JSON.parse(SAMPLE),
      error: "Z.ai 500: code ?",
      errorAt: "2026-10-16T15:05:00.000Z",
    })
    expect(zaiUsageOf(failed, new Date("2026-10-16T15:06:00.000Z"))).toBeNull()
    expect(zaiFailureOf(failed)).toBe(
      "The GLM usage read failed at 2026-10-16T15:05:00.000Z: Z.ai 500: code ?",
    )
    expect(zaiFailureOf(SAMPLE)).toBeNull()
    expect(zaiFailureOf("not json")).toBeNull()
  })
})
