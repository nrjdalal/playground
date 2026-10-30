import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../../../..")
const SKILL = join(ROOT, "extensions/core/skills/pr")
const UPSTREAM = join(import.meta.dir, "upstream")

const TLDR = "## TL;DR\n\n- <a few short ASD-STE100 bullet points: what changes, and why>\n\n"
const LINKS = "\n\n## Links\n\n<tickets, issues it closes, docs, related PRs>"

// The skill is upstream's whole, with only a TL;DR and a Links block added, so every edit beyond them is drift. The pinned copy is upstream's at the commit upstream/SOURCE names, so the test needs no network.
describe("the pr skill", () => {
  test("is upstream's SKILL.md with a TL;DR block on top of the template and a Links block at its end, nothing else", async () => {
    const upstream = await Bun.file(join(UPSTREAM, "SKILL.md")).text()
    const top = "```markdown\n## Summary"
    const end = "<optional: potential ramifications of merge>\n```"
    expect(upstream.split(top)).toHaveLength(2)
    expect(upstream.split(end)).toHaveLength(2)
    const expected = upstream
      .replace(top, `\`\`\`markdown\n${TLDR}## Summary`)
      .replace(end, `<optional: potential ramifications of merge>${LINKS}\n\`\`\``)
    expect(await Bun.file(join(SKILL, "SKILL.md")).text()).toBe(expected)
  })

  test("keeps upstream's CREDITS.md byte for byte", async () => {
    expect(await Bun.file(join(SKILL, "CREDITS.md")).text()).toBe(
      await Bun.file(join(UPSTREAM, "CREDITS.md")).text(),
    )
  })

  test("names no ticket scheme in its Links line", async () => {
    const text = await Bun.file(join(SKILL, "SKILL.md")).text()
    expect(text).not.toMatch(/PLAT|#n\b/)
  })
})
