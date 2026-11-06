import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  beat,
  linesIn,
  skipsIn,
  statePath,
} from "../../../../../packages/scripts/src/ops-ticket-card/cli"
import type { Settings } from "../../../../../packages/settings/src/settings"

// Thursday 5 Nov 2026, 10:00 UTC, inside a 04:00 to 12:00 weekday window; every id, org and URL is made up.
const NOW = Date.parse("2026-11-05T10:00:00Z")
const MIN = 60_000
const root = mkdtempSync(join(tmpdir(), "ticket-card-"))
afterAll(() => rmSync(root, { force: true, recursive: true }))

const VALUES = {
  "ticketCard.linesFile": "lines.json",
  "ticketCard.window": { days: [1, 2, 3, 4, 5], end: "12:00", start: "04:00" },
}
const settings = (values: Record<string, unknown> = VALUES) =>
  ({ schemaVersion: 1, values }) as unknown as Settings
const SEARCH = JSON.stringify([
  {
    body: "Fixes ABC-1",
    title: "fix the made-up page",
    updatedAt: "2026-11-05T09:00:00Z",
    url: "https://github.com/example/app/pull/7",
  },
])
const VIEW = JSON.stringify({
  isDraft: true,
  mergedAt: null,
  reviews: [],
  statusCheckRollup: [],
  url: "https://github.com/example/app/pull/7",
})

// A data folder with its ops folder and lines file, and a fake run that answers gh and bun run ask, recording each call
const world = (name: string) => {
  const data = join(root, name)
  const ops = join(data, "ops")
  mkdirSync(ops, { recursive: true })
  const ran: { argv: string[]; stdin?: string }[] = []
  const answers = { closed: false, id: 0 }
  const lines = (l: Record<string, unknown>) =>
    writeFileSync(join(data, "lines.json"), JSON.stringify({ lines: l }))
  lines({
    "ABC-1": {
      id: "ABC-1",
      mine: false,
      open: true,
      shownAt: NOW - 30 * MIN,
      status: "not taken",
      urgency: "Medium",
    },
  })
  const run = async (argv: string[], _t?: number, stdin?: string) => {
    ran.push({ argv, stdin })
    if (argv[0] === "gh") return { code: 0, out: argv[1] === "search" ? SEARCH : VIEW }
    if (argv.includes("edit") && answers.closed)
      return {
        code: 1,
        out: "ask: This item is closed: done, dismissed, settled, resolved or closed by its poster",
      }
    return {
      code: 0,
      out: argv.includes("new") ? `0000000${++answers.id}-0000-0000-0000-000000000000\n` : "",
    }
  }
  const go = (minute: number, values?: Record<string, unknown>, org: string | null = "example") =>
    beat(
      { now: new Date(NOW + minute * MIN), ops, repo: "/repo", run },
      { data, org: org ?? undefined, settings: settings(values) },
    )
  const asks = () => ran.filter((r) => r.argv[0] === "bun").map((r) => r.argv.slice(6).join(" "))
  const gh = () => ran.filter((r) => r.argv[0] === "gh" && r.argv[1] === "search").length
  return { answers, asks, data, gh, go, lines, ops, ran }
}

describe("the beat", () => {
  test("with no lines file set it reads and writes nothing", async () => {
    const w = world("unset")
    await w.go(0, {})
    expect([w.ran, existsSync(statePath(w.ops))]).toEqual([[], false])
  })

  test("outside its window it reads and writes nothing", async () => {
    const w = world("outside")
    await w.go(180)
    expect([w.ran, existsSync(statePath(w.ops))]).toEqual([[], false])
  })

  test("the first beat posts the card; the same text again writes nothing; a change edits that card in place", async () => {
    const w = world("edits")
    await w.go(0)
    await w.go(1)
    expect(w.asks()).toEqual(["new"])
    const posted = JSON.parse(w.ran.find((r) => r.argv.includes("new"))!.stdin!)
    expect(posted).toMatchObject({
      from: "ops",
      kind: "update",
      preview: { outcome: "finding" },
      title: "Tickets today",
    })
    expect(posted.preview.text).toContain("ABC-1 · Medium · not taken")
    w.lines({
      "ABC-1": { id: "ABC-1", mine: true, open: true, shownAt: NOW - 30 * MIN, urgency: "Medium" },
    })
    await w.go(2)
    expect(w.asks()).toEqual(["new", "edit 00000001-0000-0000-0000-000000000000"])
  })

  test("a card the owner closed gets a new card on the next change, and the kept id moves to it", async () => {
    const w = world("closed")
    await w.go(0)
    w.answers.closed = true
    w.lines({
      "ABC-1": { id: "ABC-1", mine: true, open: true, shownAt: NOW - 30 * MIN, urgency: "Medium" },
    })
    await w.go(1)
    expect(w.asks()).toEqual(["new", "edit 00000001-0000-0000-0000-000000000000", "new"])
    expect(JSON.parse(readFileSync(statePath(w.ops), "utf8")).card.id).toBe(
      "00000002-0000-0000-0000-000000000000",
    )
  })

  test("a new day gets a new card", async () => {
    const w = world("day")
    await w.go(0)
    await w.go(1440)
    expect(w.asks()).toEqual(["new", "new"])
  })

  test("GitHub is read at most once every 5 minutes a ticket, and not at all with no org", async () => {
    const w = world("github")
    await w.go(0)
    await w.go(1)
    await w.go(4)
    expect(w.gh()).toBe(1)
    await w.go(5)
    expect(w.gh()).toBe(2)
    const none = world("no-org")
    await none.go(0, VALUES, null)
    expect(none.gh()).toBe(0)
  })

  test("each step first seen goes once into the day's steps file under diaryDir", async () => {
    const w = world("steps")
    await w.go(0)
    w.lines({
      "ABC-1": { id: "ABC-1", mine: true, open: true, shownAt: NOW - 30 * MIN, urgency: "Medium" },
    })
    await w.go(1)
    await w.go(2)
    expect(readFileSync(join(w.data, "diary", "2026-11-05-steps.md"), "utf8")).toBe(
      "- 10:00 am ABC-1 PR open\n- 10:01 am ABC-1 taken\n",
    )
  })
})

describe("its readers", () => {
  test("the lines file's lines, kept to the prefixes named, none meaning every prefix", () => {
    const file = {
      lines: {
        "ABC-1": { id: "ABC-1", open: true, shownAt: 1 },
        "XYZ-2": { id: "XYZ-2", open: false, shownAt: 2, theirs: true },
      },
    }
    expect(linesIn(file, ["ABC"]).map((l) => l.id)).toEqual(["ABC-1"])
    expect(linesIn(file, [])).toEqual([
      { id: "ABC-1", mine: false, open: true, shownAt: 1 },
      { id: "XYZ-2", mine: false, open: false, shownAt: 2, theirs: true },
    ])
  })

  test("a sent record's skip keys name each skipped ticket's area, and its other keys none", () => {
    expect(
      skipsIn({ "busy-reply:ABC-1": "x", "claim-skip:ABC-2:voice": "x", "posted:eod": "x" }),
    ).toEqual({ "ABC-2": "voice" })
  })
})
