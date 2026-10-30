import { describe, expect, test } from "bun:test"

import {
  kinds,
  overLimit,
  wrap,
  wrapLine,
} from "../../../../../packages/scripts/src/docs-wrap/wrap"

describe("wrapLine puts each sentence on its own line", () => {
  test("breaks after each sentence, keeping every character but the space", () => {
    expect(wrapLine("One. Two? Three! four")).toEqual(["One.", "Two?", "Three!", "four"])
  })

  test("breaks before a sentence that opens on a lowercase name or inline code", () => {
    expect(wrapLine("It is read. dispatcher writes it. `bun run` starts it.")).toEqual([
      "It is read.",
      "dispatcher writes it.",
      "`bun run` starts it.",
    ])
  })

  test("leaves an abbreviation, an initial and a dotted number whole", () => {
    expect(wrapLine("Use a tool, e.g. bun, i.e. fast. Ask J. Doe about v1.2 now.")).toEqual([
      "Use a tool, e.g. bun, i.e. fast.",
      "Ask J. Doe about v1.2 now.",
    ])
  })

  test("never breaks inside inline code, a link or an HTML tag", () => {
    const line = "Run `a. b` and see [one. Two](https://x.y/a. b) or <a title='x. Y'>z</a> here."
    expect(wrapLine(line)).toEqual([line])
  })

  test("keeps a bullet's later sentences inside the bullet under its marker's indent", () => {
    expect(wrapLine("- One. Two.")).toEqual(["- One.", "  Two."])
    expect(wrapLine("  1. One. Two.")).toEqual(["  1. One.", "     Two."])
    expect(wrapLine("> - One. Two.")).toEqual(["> - One.", ">   Two."])
  })

  test("never starts a line that would open a block", () => {
    expect(wrapLine("Pick one. - not a list. # not a heading. 1) not a list either.")).toEqual([
      "Pick one. - not a list. # not a heading. 1) not a list either.",
    ])
  })

  test("breaks a sentence over the limit at a clause, a semicolon or colon outside parentheses first", () => {
    const sentence = "alpha beta, gamma delta (one: two), epsilon; zeta eta, theta iota."
    const lines = wrapLine(sentence, 50)
    expect(lines).toEqual(["alpha beta, gamma delta (one: two), epsilon;", "zeta eta, theta iota."])
    for (const line of wrapLine(sentence, 30)) expect(line.length).toBeLessThanOrEqual(30)
  })

  test("leaves a line ending in a hard break as it is", () => {
    expect(wrapLine("One. Two.  ")).toEqual(["One. Two.  "])
  })
})

describe("wrap touches prose alone and is idempotent", () => {
  const doc = [
    "---",
    "description: One. Two.",
    "---",
    "",
    "# Title. Here",
    "",
    "Para one. Para two.",
    "",
    "```ts",
    "const a = 1. b",
    "```",
    "",
    "| a. b | c. d |",
    "| ---- | ---- |",
    "| e. f | g. h |",
    "",
    "<!-- note. here -->",
  ].join("\n")

  test("only the paragraph is broken", () => {
    expect(wrap(doc)).toBe(doc.replace("Para one. Para two.", "Para one.\nPara two."))
  })

  test("a second run changes nothing", () => {
    expect(wrap(wrap(doc, 20), 20)).toBe(wrap(doc, 20))
  })

  test("kinds names each line's kind", () => {
    expect(kinds(doc.split("\n"))).toEqual([
      "frontmatter",
      "frontmatter",
      "frontmatter",
      "prose",
      "html",
      "prose",
      "prose",
      "prose",
      "code",
      "code",
      "code",
      "prose",
      "table",
      "table",
      "table",
      "prose",
      "html",
    ])
  })

  test("overLimit names each prose line past the limit, never a table or code line", () => {
    const text = `${"x".repeat(12)}\n\`\`\`\n${"y".repeat(50)}\n\`\`\`\n| ${"z".repeat(50)} |\n| - |`
    expect(overLimit(text, 10)).toEqual([{ length: 12, line: 1 }])
  })
})
