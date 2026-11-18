import { describe, expect, test } from "bun:test"

import {
  type ChoicePreview,
  type InboxItem,
  choicesOf,
  orderInboxItems,
  progressItems,
  rankBetween,
  rowOfAnswer,
} from "../../../../packages/config/src/inbox"

describe("choicesOf", () => {
  test("a typed decision is a yes or no over its own default labels (#873)", () => {
    for (const [preview, labels] of [
      [
        { key: "end-of-day", kind: "skill", type: "accept" },
        ["Accept the skill end-of-day", "Leave it unaccepted"],
      ],
      [
        { key: "end-of-day", kind: "skill", more: [{}, {}], type: "accept" },
        ["Accept the skill end-of-day and 2 more", "Leave them unaccepted"],
      ],
      [{ app: "Notes", change: "add", type: "apps" }, ["Add Notes", "Keep the list as it is"]],
      [
        { app: "Notes", change: "remove", type: "apps" },
        ["Remove Notes", "Keep the list as it is"],
      ],
      [{ amount: "$40", type: "budget" }, ["Spend $40", "Do not spend it"]],
      [{ type: "delete" }, ["Delete it", "Keep it"]],
      [
        { permission: "accessibility", type: "grant" },
        ["Open the accessibility settings", "Not now"],
      ],
      [
        { key: "pat@example.com", own: true, type: "own" },
        ["Mark pat@example.com as your own account", "Keep it as it is"],
      ],
      [
        { key: "pat@example.com", own: false, type: "own" },
        ["Unmark pat@example.com as your own account", "Keep it as it is"],
      ],
      [{ type: "schema" }, ["Apply this schema", "Do not apply it"]],
      [{ sha: "3f9a2c1d", type: "ship" }, ["Ship 3f9a2c1 to main", "Hold the ship"]],
      [{ to: "@Merritt", type: "slack" }, ["Send it to @Merritt", "Do not send it"]],
      [{ team: "ACME", type: "ticket" }, ["File it in ACME", "Do not file it"]],
    ] as [ChoicePreview, string[]][]) {
      const choices = choicesOf(preview)
      expect(choices?.shape).toBe("yes-no")
      expect(choices?.rows.map((row) => [row.letter, row.label, row.go])).toEqual([
        ["A", labels[0], true],
        ["B", labels[1], false],
      ])
    }
  })

  test("a secret has no rows, since it takes a value", () => {
    expect(choicesOf({ type: "secret" })).toBeNull()
  })
})

describe("rowOfAnswer", () => {
  const ask: ChoicePreview = {
    options: [{ label: "Port it" }, { label: "Hotfix main" }, { label: "Wait" }],
    type: "ask",
  }

  test("a go answer takes the row its option names, the first when it names none, and a deny the no-go row", () => {
    expect(rowOfAnswer(ask, { choice: "approve", option: 1 })?.label).toBe("Hotfix main")
    expect(rowOfAnswer(ask, { choice: "approve" })?.letter).toBe("A")
    expect(rowOfAnswer(ask, { choice: "deny" })).toMatchObject({
      label: "None of these",
      letter: "D",
    })
  })

  test("an option past the rows, or a secret, picks nothing", () => {
    expect(rowOfAnswer(ask, { choice: "approve", option: 3 })).toBeNull()
    expect(rowOfAnswer({ type: "secret" }, { choice: "approve" })).toBeNull()
  })
})

describe("progressItems", () => {
  test("reads one item a line, its fields trimmed, a blank line skipped and a % taken (PG-2617)", () => {
    expect(
      progressItems(
        "Mac reads | 100 | Reads every Mac | 9:10 pm\n\nYard channel|40%|Posts land |\n",
      ),
    ).toEqual({
      items: [
        { eta: "9:10 pm", name: "Mac reads", percent: 100, state: "done", text: "Reads every Mac" },
        { eta: "", name: "Yard channel", percent: 40, text: "Posts land" },
      ],
      ok: true,
    })
    expect(progressItems("Edge | 0 | Not started | 1:00 am")).toMatchObject({ ok: true })
    expect(progressItems("Half | 12.5 | Some | soon")).toMatchObject({
      items: [{ percent: 12.5 }],
    })
  })

  test("a 4-field line reads as before, with no state", () => {
    expect(progressItems("Sign-in | 40 | Next | 2:00 pm")).toEqual({
      items: [{ eta: "2:00 pm", name: "Sign-in", percent: 40, text: "Next" }],
      ok: true,
    })
  })

  test("an optional 5th field is the row's state, one of active, done, held or waiting (PG-2730)", () => {
    for (const state of ["active", "done", "held", "waiting"] as const)
      expect(progressItems(`Sign-in | 40 | Next | 2:00 pm | ${state}`)).toEqual({
        items: [{ eta: "2:00 pm", name: "Sign-in", percent: 40, state, text: "Next" }],
        ok: true,
      })
    expect(progressItems("Sign-in | 40 | Next | 2:00 pm | ")).toEqual({
      items: [{ eta: "2:00 pm", name: "Sign-in", percent: 40, text: "Next" }],
      ok: true,
    })
  })

  test("a row at 100 that names no state reads as done, and one that names a state keeps it", () => {
    expect(progressItems("A | 100 | x | y")).toMatchObject({ items: [{ state: "done" }] })
    expect(progressItems("A | 100% | x | y | ")).toMatchObject({ items: [{ state: "done" }] })
    expect(progressItems("A | 100 | x | y | active")).toMatchObject({
      items: [{ state: "active" }],
    })
  })

  test("names a line whose state is none of the four, and the state itself", () => {
    expect(progressItems("A | 10 | x | y\nB | 20 | x | y | busy")).toEqual({
      fault: { kind: "state", line: 2, state: "busy", text: "B | 20 | x | y | busy" },
      ok: false,
    })
  })

  test("names the first line with other than 4 or 5 fields, counting from 1 inside the block", () => {
    expect(progressItems("A | 10 | x | y\nB | 20 | no eta")).toEqual({
      fault: { count: 3, kind: "fields", line: 2, text: "B | 20 | no eta" },
      ok: false,
    })
    expect(progressItems("A | 10 | x | y | active | z")).toEqual({
      fault: { count: 6, kind: "fields", line: 1, text: "A | 10 | x | y | active | z" },
      ok: false,
    })
  })

  test("names a percent outside 0 to 100, or one that is no number", () => {
    for (const percent of ["101", "-1", "150%", "half", "", "1e2"])
      expect(progressItems(`A | 10 | x | y\nB | ${percent} | x | y`)).toEqual({
        fault: { kind: "percent", line: 2, text: `B | ${percent} | x | y` },
        ok: false,
      })
  })

  test("refuses a block with no item", () => {
    expect(progressItems("\n  \n")).toEqual({
      fault: { kind: "empty", line: 0, text: "" },
      ok: false,
    })
  })
})

describe("orderInboxItems", () => {
  // A card's ref is its stable sequence, newest first, so it is today's order.
  const card = (
    ref: number,
    pinnedAt: string | null = null,
    rank: string | null = null,
  ): InboxItem => ({ pinnedAt, rank, ref })

  test("a pinned card leads a newer unpinned one, then today's order, newest first by ref", () => {
    expect(
      orderInboxItems([card(4), card(1), card(2, "2020", "a"), card(3, "2020", "b")]).map(
        (row) => row.ref,
      ),
    ).toEqual([2, 3, 4, 1])
  })

  test("pinned cards order by their rank's code point, not their ref", () => {
    expect(
      orderInboxItems([card(1, "2020", "c"), card(2, "2020", "a"), card(3, "2020", "b")]).map(
        (row) => row.ref,
      ),
    ).toEqual([2, 3, 1])
  })

  test("unpinned cards keep today's order, newest first by their ref", () => {
    expect(orderInboxItems([card(1), card(3), card(2)]).map((row) => row.ref)).toEqual([3, 2, 1])
  })
})

const betweenKeys = (prev: string | null, key: string, next: string | null): boolean =>
  (prev === null || key > prev) && (next === null || key < next)

describe("rankBetween", () => {
  test("a fractional key sits strictly between two neighbours", () => {
    const key = rankBetween("aa", "ac")
    expect(betweenKeys("aa", key, "ac")).toBe(true)
  })

  test("a fractional key leads the tab when its lower bound is none", () => {
    const key = rankBetween(null, "c")
    expect(betweenKeys(null, key, "c")).toBe(true)
  })

  test("a fractional key ends the tab when its upper bound is none", () => {
    const key = rankBetween("a", null)
    expect(betweenKeys("a", key, null)).toBe(true)
  })

  test("a fractional key sits between two keys that are next to each other", () => {
    const key = rankBetween("a", "b")
    expect(betweenKeys("a", key, "b")).toBe(true)
  })
})
