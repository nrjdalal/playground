import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const DISPATCH = join(import.meta.dir, "../../../../../extensions/core/skills/playbook/DISPATCH.md")

describe("DISPATCH.md", () => {
  test("files an org's or a person's ask in that extension's repo, and only the factory's own in the factory repo (PG-83)", async () => {
    const text = await Bun.file(DISPATCH).text()
    const lines = text.split("\n")
    const at = lines.findIndex((l) =>
      l.includes("It files an issue in the repo where the work lives"),
    )
    const line = lines[at] ?? ""
    expect(line).toContain("the factory's own work in the factory repo")
    expect(lines[at + 1]).toContain("Before it files one, it searches that repo's open issues")
    expect(line).toContain(
      "an org's in that org's extension repo and a person's in their login extension ([ADR 0016](",
    )
  })
})
