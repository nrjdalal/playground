import { describe, expect, test } from "bun:test"

import { type ChoicePreview, choicesOf, rowOfAnswer } from "../../../../packages/config/src/inbox"

describe("choicesOf", () => {
  test("a typed decision is a yes or no over its own default labels (#873)", () => {
    for (const [preview, labels] of [
      [
        { key: "end-of-day", kind: "skill", type: "accept" },
        ["Accept the skill end-of-day", "Leave it unaccepted"],
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
