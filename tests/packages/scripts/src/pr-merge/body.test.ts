import { describe, expect, test } from "bun:test"

import { bodyRefusal, templateBody } from "../../../../../packages/scripts/src/pr-merge/body"
import { SKILL_BODY } from "./bodies"

describe("templateBody", () => {
  test("takes a TL;DR of 2 sentences first, then Summary, Evidence, Merge Danger and Links in order", () => {
    expect(templateBody(SKILL_BODY)).toBe(true)
    expect(templateBody(`${SKILL_BODY}\n\n🤖 Generated with Claude Code`)).toBe(true)
    expect(templateBody(SKILL_BODY.replace("The board", "Outcome: The board"))).toBe(true)
  })

  test("takes a TL;DR of bullets, 2 sentences or more across them, with or without a closing stop, and no upper count", () => {
    const bullets = (...items: string[]) =>
      SKILL_BODY.replace(
        "The board shows each PR once. You see one row for each PR.",
        items.join("\n"),
      )
    expect(
      templateBody(bullets("- The board shows each PR once", "- You see one row for each PR.")),
    ).toBe(true)
    expect(templateBody(bullets("- One.", "- Two.", "- Three.", "- Four.", "- Five."))).toBe(true)
    expect(
      templateBody(bullets("Outcome: The board reads right.", "", "- It shows each PR once")),
    ).toBe(true)
    expect(templateBody(bullets("- The board shows each PR once"))).toBe(false)
    const crlf = bullets("- The board shows each PR once", "- You see one row for each PR")
    expect(templateBody(crlf.replace(/\n/g, "\r\n"))).toBe(true)
  })

  test("reads a heading inside a code fence as a sample, and takes ## TLDR as ## TL;DR", () => {
    const sample = SKILL_BODY.replace(
      "The board reads each PR once.",
      "The board reads each PR once.\n\n```markdown\n## Links\n## Summary\n```",
    )
    expect(templateBody(sample)).toBe(true)
    expect(templateBody(SKILL_BODY.replace("## TL;DR", "## TLDR"))).toBe(true)
  })

  test("refuses a short TL;DR, anything above it, a missing section, or the sections out of order", () => {
    expect(templateBody(SKILL_BODY.replace(" You see one row for each PR.", ""))).toBe(false)
    expect(templateBody(`Outcome: one. Two.\n\n${SKILL_BODY}`)).toBe(false)
    expect(templateBody(SKILL_BODY.replace("## TL;DR\n\n", ""))).toBe(false)
    expect(templateBody(SKILL_BODY.replace("## Links", "## See also"))).toBe(false)
    const swapped = SKILL_BODY.replace("## Evidence", "## X")
      .replace("## Merge Danger", "## Evidence")
      .replace("## X", "## Merge Danger")
    expect(templateBody(swapped)).toBe(false)
  })
})

describe("bodyRefusal", () => {
  test("takes a PR template body, its TL;DR in prose or bullets", () => {
    expect(bodyRefusal(SKILL_BODY)).toBeNull()
    const bulletsOnly = SKILL_BODY.replace(
      "The board shows each PR once. You see one row for each PR.",
      "- The board shows each PR once\n- You see one row for each PR",
    )
    expect(bodyRefusal(bulletsOnly)).toBeNull()
  })

  test("refuses a body that is not the template, a labelled paragraph included", () => {
    expect(bodyRefusal("Outcome: One. Two.\n")).toContain("needs the PR template")
    expect(bodyRefusal("## What changes\n- a.")).toContain("needs the PR template")
  })

  test("refuses an Outcome label line in the TL;DR, naming it", () => {
    expect(bodyRefusal(SKILL_BODY.replace("The board", "Outcome: The board"))).toContain(
      'labelled "Outcome:"',
    )
    expect(bodyRefusal(SKILL_BODY.replace("The board", "**Outcome:** The board"))).toContain(
      'labelled "Outcome:"',
    )
    const bullet = SKILL_BODY.replace(
      "The board shows each PR once. You see one row for each PR.",
      "- Outcome: the board reads right\n- It shows each PR once",
    )
    expect(bodyRefusal(bullet)).toContain("extensions/core/skills/pr/SKILL.md")
    for (const line of [
      "> Outcome: The board",
      "1. Outcome: The board",
      "### Why\n\nOutcome: The board",
    ]) {
      expect(bodyRefusal(SKILL_BODY.replace("The board", line))).toContain('labelled "Outcome:"')
    }
  })

  test("takes a label outside the TL;DR, and prose that only starts like one", () => {
    expect(
      bodyRefusal(SKILL_BODY.replace("The board reads each PR once.", "Outcome: one row.")),
    ).toBeNull()
    expect(bodyRefusal(SKILL_BODY.replace("The board", "Outcomes vary. The board"))).toBeNull()
  })
})
