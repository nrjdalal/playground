import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

// Claude Code re-attaches a skill after a compaction cut to its first 5,000 tokens; this text runs about 3.5 characters a token, so 14,000 characters stay under the cut with room (#705).
const CUT = 14_000

const dir = join(import.meta.dir, "../../../../../extensions/core/skills/playbook")
const read = (name: string) => Bun.file(join(dir, name)).text()
const skills = join(dir, "../../../../skills")
const scopeRules = readdirSync(skills)
  .map((scope) => join(skills, scope, "rules"))
  .filter((rules) => existsSync(rules))

describe("playbook keeps its pointer to the standing rules inside what a compaction re-attaches", () => {
  test("SKILL.md stays under the cut", async () => {
    expect((await read("SKILL.md")).length).toBeLessThan(CUT)
  })

  test("SKILL.md points at core's rules/, and its glance names only the rules a scope's own rules/ holds until the switch imports them", async () => {
    const skill = await read("SKILL.md")
    expect(skill).toContain("[extensions/core/rules/](../../rules)")
    expect(skill).toContain("`playground rules <name>`")
    expect(existsSync(join(dir, "RULES.md"))).toBe(false)
    expect(readdirSync(join(dir, "../../rules")).length).toBeGreaterThan(20)
    const glance = [...skill.matchAll(/^- \*\*([a-z]+(?: [a-z]+)*)\*\*:/gm)].map((m) => m[1])
    const waiting = scopeRules.flatMap((rules) =>
      readdirSync(rules).map((file) => file.replace(/\.md$/, "").replaceAll("-", " ")),
    )
    expect([...glance].sort()).toEqual([...waiting].sort())
  })
})
