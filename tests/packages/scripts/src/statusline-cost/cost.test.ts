import { describe, expect, test } from "bun:test"
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  emptyState,
  figures,
  localMidnight,
  update,
} from "../../../../../packages/scripts/src/statusline-cost/cost"

const cli = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "..",
  "packages",
  "scripts",
  "src",
  "statusline-cost",
  "cli.ts",
)
const NOW = Date.parse("2026-11-05T12:00:00Z")
const UTC = "UTC"

// A made-up assistant line in Claude Code's transcript shape: only the fields the reader reads
function line(o: {
  at: string
  fast?: boolean
  id: string
  model?: string
  read?: number
  req?: string
  input?: number
  output?: number
  w1h?: number
  w5m?: number
}): string {
  const w1h = o.w1h ?? 0
  return `${JSON.stringify({
    message: {
      content: [{ text: "made up", type: "text" }],
      id: o.id,
      model: o.model ?? "claude-opus-5-5",
      usage: {
        cache_creation: { ephemeral_1h_input_tokens: w1h, ephemeral_5m_input_tokens: o.w5m ?? 0 },
        cache_creation_input_tokens: w1h + (o.w5m ?? 0),
        cache_read_input_tokens: o.read ?? 0,
        input_tokens: o.input ?? 0,
        output_tokens: o.output ?? 0,
        ...(o.fast ? { speed: "fast" } : {}),
      },
    },
    requestId: o.req ?? "req_1",
    timestamp: o.at,
    type: "assistant",
  })}\n`
}

const projects = () => {
  const root = join(mkdtempSync(join(tmpdir(), "statusline-cost-")), "projects", "-made-up-project")
  mkdirSync(root, { recursive: true })
  return root
}

const run = (root: string, s = emptyState(), now = NOW, zone = UTC) => {
  update(s, join(root, ".."), now)
  return { s, ...figures(s, now, zone) }
}

const M = 1_000_000

describe("the status line's retail $", () => {
  test("a message in two files counts once, by its id and request id", () => {
    const root = projects()
    const one = line({ at: "2026-11-05T10:00:00Z", id: "msg_a", output: M })
    writeFileSync(join(root, "one.jsonl"), one)
    writeFileSync(
      join(root, "two.jsonl"),
      one + line({ at: "2026-11-05T10:00:00Z", id: "msg_a", output: M, req: "req_2" }),
    )
    // msg_a:req_1 twice, msg_a:req_2 once: two messages at $20 per million output on Opus 5.5
    expect(run(root).weekly).toBeCloseTo(40, 6)
  })

  test("a growing message counts its last line, across runs too", () => {
    const root = projects()
    const file = join(root, "grow.jsonl")
    writeFileSync(file, line({ at: "2026-11-05T10:00:00Z", id: "msg_g", output: M / 10 }))
    const first = run(root)
    expect(first.weekly).toBeCloseTo(2, 6)
    appendFileSync(file, line({ at: "2026-11-05T10:00:01Z", id: "msg_g", output: M / 2 }))
    expect(run(root, first.s, NOW + 60_000).weekly).toBeCloseTo(10, 6)
  })

  test("a 1-hour cache write takes the 1-hour rate and a 5-minute one its own", () => {
    const root = projects()
    writeFileSync(
      join(root, "cache.jsonl"),
      line({ at: "2026-11-05T10:00:00Z", id: "msg_1h", w1h: M }) +
        line({ at: "2026-11-05T10:00:00Z", id: "msg_5m", w5m: M }),
    )
    // Opus 5.5: $8 per million 1-hour writes, $5 per million 5-minute writes
    expect(run(root).weekly).toBeCloseTo(13, 6)
  })

  test("fast mode takes fast mode's rates, cache reads scaled with input", () => {
    const root = projects()
    writeFileSync(
      join(root, "fast.jsonl"),
      line({ at: "2026-11-05T10:00:00Z", fast: true, id: "msg_f", input: M, output: M, read: M }),
    )
    // Opus 5.5 fast: $8 input, $40 output, cache reads at 0.05x of $8
    expect(run(root).weekly).toBeCloseTo(8 + 40 + 0.4, 6)
  })

  test("a replaced or shortened file is read again from 0, adding only what is new", () => {
    const root = projects()
    const file = join(root, "swap.jsonl")
    const old = line({ at: "2026-11-05T10:00:00Z", id: "msg_old", output: M })
    writeFileSync(file, old + line({ at: "2026-11-05T10:00:00Z", id: "msg_cut", output: M }))
    const first = run(root)
    expect(first.weekly).toBeCloseTo(40, 6)
    const temp = join(root, "swap.tmp")
    writeFileSync(temp, old + line({ at: "2026-11-05T10:30:00Z", id: "msg_new", output: M }))
    const ino = statSync(file).ino
    renameSync(temp, file)
    expect(statSync(file).ino).not.toBe(ino)
    const second = run(root, first.s, NOW + 60_000)
    expect(second.weekly).toBeCloseTo(60, 6)
    writeFileSync(file, line({ at: "2026-11-05T11:00:00Z", id: "msg_short", output: M }))
    expect(run(root, second.s, NOW + 120_000).weekly).toBeCloseTo(80, 6)
  })

  test("a copy of a message already counted, made after its hold, adds nothing", () => {
    const root = projects()
    writeFileSync(
      join(root, "first.jsonl"),
      line({ at: "2026-11-05T06:00:00Z", id: "msg_h", output: M }),
    )
    const first = run(root)
    writeFileSync(
      join(root, "fork.jsonl"),
      line({ at: "2026-11-05T06:00:00Z", id: "msg_h", output: M }),
    )
    expect(run(root, first.s, NOW + 60_000).weekly).toBeCloseTo(20, 6)
  })

  test("the week starts at local midnight 6 days back, in the zone given", () => {
    // 12:00Z on 5 Nov is 17:30 in Asia/Kolkata, so the week starts at 00:00 on 30 Oct there, 18:30Z on 29 Oct
    expect(new Date(localMidnight(NOW, 6, "Asia/Kolkata")).toISOString()).toBe(
      "2026-10-29T18:30:00.000Z",
    )
    const root = projects()
    writeFileSync(
      join(root, "edge.jsonl"),
      line({ at: "2026-10-29T18:29:00Z", id: "msg_before", output: M }) +
        line({ at: "2026-10-29T18:31:00Z", id: "msg_after", output: M }),
    )
    expect(run(root, emptyState(), NOW, "Asia/Kolkata").weekly).toBeCloseTo(20, 6)
    expect(run(root, emptyState(), NOW, UTC).weekly).toBeCloseTo(0, 6)
  })

  test("the last 24 hours prorate the oldest quarter hour and leave the week's older days out", () => {
    const root = projects()
    writeFileSync(
      join(root, "day.jsonl"),
      line({ at: "2026-11-04T12:05:00Z", id: "msg_edge", output: M }) +
        line({ at: "2026-11-04T09:00:00Z", id: "msg_out", output: M }) +
        line({ at: "2026-11-05T11:00:00Z", id: "msg_in", output: M }),
    )
    // at 12:10Z the window opens at 12:10Z on 4 Nov, so the 12:00Z bucket lies 5 of its 15 minutes inside
    const got = run(root, emptyState(), NOW + 10 * 60_000)
    expect(got.day24).toBeCloseTo(20 + (20 * 5) / 15, 6)
    expect(got.weekly).toBeCloseTo(60, 6)
  })

  test("a model with no price counts as unpriced and adds no $", () => {
    const root = projects()
    writeFileSync(
      join(root, "other.jsonl"),
      line({ at: "2026-11-05T10:00:00Z", id: "msg_x", model: "made-up-model", output: M }) +
        line({ at: "2026-11-05T10:00:00Z", id: "msg_s", model: "<synthetic>" }),
    )
    const got = run(root)
    expect(got.weekly).toBe(0)
    expect(got.unpriced).toBe(1)
  })

  test("the CLI writes the three cache files at mode 600 and its state, then reads only new bytes", () => {
    const root = projects()
    writeFileSync(
      join(root, "cli.jsonl"),
      line({ at: "2026-11-05T10:00:00Z", id: "msg_c", output: M }),
    )
    const base = join(root, "..", "..")
    const cache = join(base, "cache")
    const state = join(base, "data", "ops", "statusline-cost.json")
    const args = [
      "bun",
      cli,
      "--cache",
      cache,
      "--now",
      "2026-11-05T12:00:00Z",
      "--root",
      join(root, ".."),
      "--state",
      state,
    ]
    const env = { ...process.env, TZ: "UTC" }
    const first = Bun.spawnSync(args, { env })
    expect(first.exitCode).toBe(0)
    expect(JSON.parse(first.stdout.toString())).toEqual({
      bytes: expect.any(Number),
      day24: 20,
      unpriced: 0,
      weekly: 20,
    })
    for (const name of ["weekly_retail", "daily24_retail", "retail_unpriced"])
      expect(statSync(join(cache, name)).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(cache, "weekly_retail"), "utf8")).toBe("20")
    expect(statSync(state).mode & 0o777).toBe(0o600)
    const again = Bun.spawnSync(args, { env })
    expect(JSON.parse(again.stdout.toString()).bytes).toBe(0)
  })

  test("a state file of another shape starts again from 0, rather than failing every run", () => {
    const root = projects()
    writeFileSync(
      join(root, "shape.jsonl"),
      line({ at: "2026-11-05T10:00:00Z", id: "msg_shape", output: M }),
    )
    const base = join(root, "..", "..")
    const state = join(base, "shape-state.json")
    for (const wrong of ["{}", "[]", "null", '{"lastRun":1}']) {
      writeFileSync(state, wrong)
      const args = [
        "bun",
        cli,
        "--cache",
        join(base, "shape-cache"),
        "--now",
        "2026-11-05T12:00:00Z",
        "--root",
        join(root, ".."),
        "--state",
        state,
      ]
      const got = Bun.spawnSync(args, { env: { ...process.env, TZ: "UTC" } })
      expect(got.exitCode).toBe(0)
      expect(JSON.parse(got.stdout.toString()).weekly).toBe(20)
    }
  })

  test("on a day the clocks change, the week still starts at that day's midnight", () => {
    // Melbourne left summer time at 03:00 on 6 Apr 2025, so that day's midnight was 13:00Z on 5 Apr, at +11
    expect(
      new Date(
        localMidnight(Date.parse("2025-04-12T02:00:00Z"), 6, "Australia/Melbourne"),
      ).toISOString(),
    ).toBe("2025-04-05T13:00:00.000Z")
  })

  test("an unpriced message whose first line holds no tokens counts once its tokens arrive", () => {
    const root = projects()
    writeFileSync(
      join(root, "late.jsonl"),
      line({ at: "2026-11-05T10:00:00Z", id: "msg_late", model: "made-up-model" }) +
        line({ at: "2026-11-05T10:00:01Z", id: "msg_late", model: "made-up-model", output: M }) +
        line({ at: "2026-11-05T10:00:02Z", id: "msg_late", model: "made-up-model", output: 2 * M }),
    )
    expect(run(root).unpriced).toBe(1)
  })

  test("an older model with a dated id takes its row", () => {
    const root = projects()
    writeFileSync(
      join(root, "older.jsonl"),
      line({
        at: "2026-11-05T10:00:00Z",
        id: "msg_old_model",
        model: "claude-sonnet-4-5-20250929",
        output: M,
      }),
    )
    // Sonnet 4.5: $15 per million output
    expect(run(root).weekly).toBeCloseTo(15, 6)
  })
})
