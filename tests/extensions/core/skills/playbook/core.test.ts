import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { CORE_RULES, readRules } from "../../../../../scripts/hooks/rules"

// Claude Code re-attaches a skill after a compaction cut to its first 5,000 tokens; this text runs about 3.5 characters a token, so 14,000 characters stay under the cut with room (#705).
const CUT = 14_000

const dir = join(import.meta.dir, "../../../../../extensions/core/skills/playbook")
const read = (name: string) => Bun.file(join(dir, name)).text()
const skills = join(dir, "../../../../skills")

describe("playbook keeps its pointer to the standing rules inside what a compaction re-attaches", () => {
  test("SKILL.md stays under the cut", async () => {
    expect((await read("SKILL.md")).length).toBeLessThan(CUT)
  })

  test("SKILL.md points at core's rules/ and glances no rule itself, since the rules hook renders each glance from its rule's file", async () => {
    const skill = await read("SKILL.md")
    expect(skill).toContain("[extensions/core/rules/](../../rules)")
    expect(skill).toContain("`playground rules <name>`")
    expect(existsSync(join(dir, "RULES.md"))).toBe(false)
    const rules = readRules(CORE_RULES)
    expect(rules.length).toBeGreaterThan(20)
    expect(rules.filter((rule) => !rule.glance).map((rule) => rule.name)).toEqual([])
    expect([...skill.matchAll(/^- \*\*([a-z]+(?: [a-z]+)*)\*\*:/gm)].map((m) => m[1])).toEqual([])
    expect(readdirSync(skills).filter((scope) => existsSync(join(skills, scope, "rules")))).toEqual(
      [],
    )
  })
})
