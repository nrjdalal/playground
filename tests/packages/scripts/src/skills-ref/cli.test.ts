import { describe, expect, test } from "bun:test"

import { specOnly } from "../../../../../packages/scripts/src/skills-ref/cli"

const SKILL = [
  "---",
  "name: tidy",
  "description: Tidy a folder.",
  "disable-model-invocation: true",
  "hooks:",
  "  Stop:",
  "    - command: echo done",
  "license: Complete terms in NOTICE",
  "source: upstream",
  "---",
  "",
  "# Tidy",
  "",
].join("\n")

describe("the skills-ref step's copy", () => {
  test("drops each Claude Code key with the lines nested under it, and keeps every other key", () => {
    expect(specOnly(SKILL)).toBe(
      [
        "---",
        "name: tidy",
        "description: Tidy a folder.",
        "license: Complete terms in NOTICE",
        "source: upstream",
        "---",
        "",
        "# Tidy",
        "",
      ].join("\n"),
    )
  })

  test("drops the upstream keys only in the zerostarter bucket, so a core or org skill holding one still fails", () => {
    expect(specOnly(SKILL, "skills/zerostarter/tidy/SKILL.md")).not.toContain("source:")
    expect(specOnly(SKILL, "skills/playground/tidy/SKILL.md")).toContain("source: upstream")
    expect(specOnly(SKILL, "extensions/core/skills/tidy/SKILL.md")).toContain("source: upstream")
    expect(specOnly(SKILL, "extensions/acme/skills/tidy/SKILL.md")).toContain("source: upstream")
  })

  test("leaves a file with no frontmatter as it is", () => {
    expect(specOnly("# Tidy\n")).toBe("# Tidy\n")
  })
})
