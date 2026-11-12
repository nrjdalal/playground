import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { parseRule } from "../../../../scripts/hooks/rules"

const rule = async () =>
  parseRule(
    "public",
    await Bun.file(join(import.meta.dir, "../../../../extensions/core/rules/public.md")).text(),
  )

describe("the public rule (PG-1288)", () => {
  test("its glance line keeps a public post's draft to the owner's own words, and its body names the check bun run ask new runs", async () => {
    const { decisions, glance, text } = await rule()
    expect(glance).toBe(
      "A public post's draft holds only what the owner asked to say: no work figure (a PR, commit or session count) and no repo, ticket, colleague, tool or session name.",
    )
    expect(decisions).toEqual(["i460"])
    expect(text).toContain("`bun run ask new` and `edit` refuse a draft with no link")
    expect(text).toContain("`noLink`")
  })
})
