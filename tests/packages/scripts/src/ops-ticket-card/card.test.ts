import { describe, expect, test } from "bun:test"

import { ASK_CODE_COLUMNS } from "../../../../../packages/config/src/inbox"
import {
  cardOf,
  clockOf,
  dayOf,
  type Inputs,
  inWindow,
  type Line,
  linesOf,
  stepLinesOf,
} from "../../../../../packages/scripts/src/ops-ticket-card/card"

// Thursday 5 Nov 2026, 10:00 UTC, inside a 04:00 to 12:00 window on weekdays; every id and org is made up.
const NOW = Date.parse("2026-11-05T10:00:00Z")
const MIN = 60_000
const WINDOW = { days: [1, 2, 3, 4, 5], end: "12:00", start: "04:00" }
const line = (id: string, over: Partial<Line> = {}): Line => ({
  id,
  mine: false,
  open: true,
  shownAt: NOW - 30 * MIN,
  urgency: "Medium",
  ...over,
})
const inputs = (over: Partial<Inputs> = {}): Inputs => ({
  approvals: 2,
  deployedStates: ["Done (Prod)"],
  lines: [line("ABC-1")],
  linkBase: "",
  prs: {},
  reopened: {},
  skips: {},
  verdicts: {},
  window: WINDOW,
  zone: "UTC",
  ...over,
})
const PR = {
  approvals: 0,
  checks: "pending" as const,
  draft: true,
  merged: false,
  url: "https://github.com/example/app/pull/7",
}
const block = (text: string, id: string) =>
  text
    .split("```")
    .find((b) => b.trimStart().startsWith(id))!
    .trim()
    .split("\n")

describe("a ticket's block", () => {
  test("an untaken ticket reads not taken, with every step still to do and none in flight", () => {
    expect(block(cardOf(inputs(), {}, NOW).text, "ABC-1")).toEqual([
      "ABC-1 · Medium · not taken",
      "⬜ taken",
      "⬜ cause found",
      "⬜ PR open",
      "⬜ CI green",
      "⬜ approvals",
      "⬜ merged",
      "⬜ deployed",
    ])
  })

  test("taken with a verdict shows both done at the time first seen, and the next step in flight", () => {
    const { seen, text } = cardOf(
      inputs({
        lines: [line("ABC-1", { mine: true })],
        verdicts: { "ABC-1": { at: "2026-11-05T09:50:00Z", kind: "code" } },
      }),
      {},
      NOW,
    )
    expect(block(text, "ABC-1").slice(0, 4)).toEqual([
      "ABC-1 · Medium · yours",
      "✅ taken       10:00 am",
      "✅ cause found 10:00 am",
      "⏳ PR open",
    ])
    expect(seen).toEqual({
      "ABC-1": { "cause found": new Date(NOW).toISOString(), taken: new Date(NOW).toISOString() },
    })
  })

  test("a step keeps the time it was first seen across later beats", () => {
    const first = cardOf(inputs({ lines: [line("ABC-1", { mine: true })] }), {}, NOW)
    const later = cardOf(
      inputs({ lines: [line("ABC-1", { mine: true })] }),
      first.seen,
      NOW + 30 * MIN,
    )
    expect(block(later.text, "ABC-1")[1]).toBe("✅ taken       10:00 am")
  })

  test("a draft PR is open with CI in flight; green checks and one of two approvals put approvals in flight", () => {
    const draft = block(
      cardOf(inputs({ lines: [line("ABC-1", { mine: true })], prs: { "ABC-1": PR } }), {}, NOW)
        .text,
      "ABC-1",
    )
    expect(draft.slice(3, 6)).toEqual([
      "✅ PR open     draft, 10:00 am",
      "⏳ CI green",
      "⬜ approvals   0/2",
    ])
    const one = block(
      cardOf(
        inputs({
          lines: [line("ABC-1", { mine: true })],
          prs: { "ABC-1": { ...PR, approvals: 1, checks: "green", draft: false } },
        }),
        {},
        NOW,
      ).text,
      "ABC-1",
    )
    expect(one.slice(3, 6)).toEqual([
      "✅ PR open     10:00 am",
      "✅ CI green    10:00 am",
      "⏳ approvals   1/2",
    ])
  })

  test("red checks say so", () => {
    const red = block(
      cardOf(
        inputs({
          lines: [line("ABC-1", { mine: true })],
          prs: { "ABC-1": { ...PR, checks: "red" } },
        }),
        {},
        NOW,
      ).text,
      "ABC-1",
    )
    expect(red[4]).toBe("⏳ CI green    red")
  })

  test("a merged PR whose ticket's state is one of deployedStates reads merged and deployed", () => {
    const pr = { ...PR, approvals: 2, checks: "green" as const, draft: false, merged: true }
    const { seen, text } = cardOf(
      inputs({
        lines: [line("ABC-1", { mine: true, open: false, state: "Done (Prod)" })],
        prs: { "ABC-1": pr },
      }),
      {},
      NOW,
    )
    expect(block(text, "ABC-1").slice(5)).toEqual([
      "✅ approvals   2/2, 10:00 am",
      "✅ merged      10:00 am",
      "✅ deployed    10:00 am",
    ])
    expect(stepLinesOf({}, seen, "UTC").at(-1)).toBe("- 10:00 am ABC-1 deployed")
  })

  test("a line closed on a state deployedStates does not name reads closed, never deployed, with nothing in flight", () => {
    for (const [state, deployedStates] of [
      ["Canceled", ["Done (Prod)"]],
      ["Duplicate", ["Done (Prod)"]],
      [undefined, ["Done (Prod)"]],
      ["Done (Prod)", []],
    ] as const) {
      const { seen, text } = cardOf(
        inputs({
          deployedStates: [...deployedStates],
          lines: [line("ABC-1", { mine: true, open: false, state })],
        }),
        {},
        NOW,
      )
      expect(block(text, "ABC-1").slice(1)).toEqual([
        "✅ taken       10:00 am",
        "⬜ cause found",
        "⬜ PR open",
        "⬜ CI green",
        "⬜ approvals",
        "⬜ merged",
        "✅ closed      10:00 am",
      ])
      expect(seen["ABC-1"]).not.toHaveProperty("deployed")
      expect(stepLinesOf({}, seen, "UTC").at(-1)).toBe("- 10:00 am ABC-1 closed")
    }
  })

  test("a skipped ticket names its area, and a colleague's names no one", () => {
    const text = cardOf(
      inputs({
        lines: [line("ABC-2"), line("ABC-3", { theirs: true })],
        skips: { "ABC-2": "voice" },
      }),
      {},
      NOW,
    ).text
    expect(block(text, "ABC-2")).toEqual(["ABC-2 · skipped, voice"])
    expect(block(text, "ABC-3")).toEqual(["ABC-3 · a colleague's"])
  })

  test("a reopened ticket carries its reopen time under its head", () => {
    const text = cardOf(
      inputs({
        lines: [line("ABC-1", { mine: true })],
        reopened: { "ABC-1": "2026-11-05T09:40:00Z" },
      }),
      {},
      NOW,
    ).text
    expect(block(text, "ABC-1")[1]).toBe("↩️ reopened    9:40 am")
  })
})

describe("the card", () => {
  test("Urgent first, then High and Medium, oldest first in each, a colleague's last; yesterday's closed line goes, an open one stays", () => {
    const shown = linesOf(
      [
        line("ABC-5", { theirs: true }),
        line("ABC-4", { urgency: "High" }),
        line("ABC-3", { shownAt: NOW - 60 * MIN }),
        line("ABC-2", { urgency: "Urgent" }),
        line("ABC-1"),
        line("ABC-6", { open: false, shownAt: NOW - 1440 * MIN }),
        line("ABC-7", { shownAt: NOW - 1440 * MIN }),
      ],
      NOW,
      "UTC",
    ).map((l) => l.id)
    expect(shown).toEqual(["ABC-2", "ABC-4", "ABC-7", "ABC-3", "ABC-1", "ABC-5"])
  })

  test("the watch block names the window and the count, and the bullets link each ticket and PR", () => {
    const text = cardOf(
      inputs({
        lines: [line("ABC-1", { mine: true })],
        linkBase: "https://tracker.example/issue/",
        prs: { "ABC-1": PR },
      }),
      {},
      NOW,
    ).text
    expect(text).toContain("```\nWATCH 4:00 am → 12:00 pm\ntickets today  1\n```")
    expect(text).toContain("- 🕐 Updated {now}. I edit this card on every change.")
    expect(text).toContain(
      "- 🔗 [ABC-1](https://tracker.example/issue/ABC-1), [ABC-1 PR](https://github.com/example/app/pull/7)",
    )
  })

  test("with no tickets the card says so", () => {
    expect(
      cardOf(inputs({ lines: [] }), {}, NOW).text.startsWith("```\nno tickets yet today\n```"),
    ).toBe(true)
  })

  test("every code line fits the card's narrowest column, a long head or skip area cut with an ellipsis", () => {
    const pr = { ...PR, approvals: 1, checks: "red" as const }
    const text = cardOf(
      inputs({
        lines: [
          line("ABCDEFG-123456", { mine: true, urgency: "Urgent" }),
          line("ABC-2"),
          line("ABC-3", { theirs: true }),
          line("ABCDEFG-654321", { urgency: undefined }),
          line("ABC-4"),
        ],
        prs: { "ABCDEFG-123456": pr },
        reopened: { "ABCDEFG-123456": "2026-11-05T09:40:00Z" },
        skips: { "ABC-2": "devops", "ABC-4": "a made-up area with a long name" },
      }),
      {},
      NOW,
    ).text
    const code = text
      .split("```")
      .filter((_, i) => i % 2 === 1)
      .flatMap((b) => b.trim().split("\n"))
    for (const row of code) expect([row, row.length <= ASK_CODE_COLUMNS]).toEqual([row, true])
    expect(code.filter((row) => row.endsWith("…"))).toEqual([
      "ABC-4 · skipped, a made-up area with…",
      "ABCDEFG-654321 · no urgency · not ta…",
    ])
  })
})

describe("time", () => {
  test("a clock time reads in the owner's zone, and so does the day", () => {
    expect(clockOf("2026-11-05T19:00:00Z", "Asia/Kolkata")).toBe("12:30 am")
    expect([
      dayOf(Date.parse("2026-11-05T19:00:00Z"), "Asia/Kolkata"),
      dayOf(Date.parse("2026-11-05T19:00:00Z"), "UTC"),
    ]).toEqual(["2026-11-06", "2026-11-05"])
  })

  test("the window holds its hours on its days alone", () => {
    expect(inWindow(WINDOW, NOW)).toBe(true)
    expect(inWindow(WINDOW, Date.parse("2026-11-05T12:00:00Z"))).toBe(false)
    expect(inWindow(WINDOW, Date.parse("2026-11-07T10:00:00Z"))).toBe(false)
    expect(
      inWindow(
        { days: [0, 1, 2, 3, 4, 5, 6], end: "24:00", start: "00:00" },
        Date.parse("2026-11-07T23:59:00Z"),
      ),
    ).toBe(true)
  })

  test("each step first seen gives one steps-file line, and a step seen before gives none", () => {
    const at = new Date(NOW).toISOString()
    expect(
      stepLinesOf(
        { "ABC-1": { taken: at } },
        { "ABC-1": { "PR open": at, taken: at }, "ABC-2": { taken: at } },
        "UTC",
      ),
    ).toEqual(["- 10:00 am ABC-1 PR open", "- 10:00 am ABC-2 taken"])
  })
})
