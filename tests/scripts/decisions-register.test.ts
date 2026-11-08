import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")

// A link is an issue number that parses, or a repo-relative path to a file that exists, an ADR's included.
const linkHolds = (target: string): boolean =>
  /^#\d+$/.test(target)
    ? Number(target.slice(1)) > 0
    : !target.startsWith("/") && !target.split("/").includes("..") && existsSync(join(root, target))

const lines = (await Bun.file(join(root, ".agents", "decisions.md")).text())
  .split("\n")
  .filter((line) => line.startsWith("- "))

describe(".agents/decisions.md, the decisions register", () => {
  test("the register holds at least one entry", () => {
    expect(lines.length).toBeGreaterThan(0)
  })

  test("every entry's link target holds (an issue number that parses, or a repo doc that exists, an ADR's included)", () => {
    for (const line of lines) {
      expect(line, line).toContain(" -> ")
      const target = line.split(" -> ").at(-1)?.trim()
      expect(target, line).toBeTruthy()
      expect(linkHolds(target!), line).toBe(true)
    }
  })

  test("a link to a repo doc holds while the doc exists, and fails once it is gone", () => {
    expect(linkHolds("extensions/core/rules/usage.md")).toBe(true)
    expect(linkHolds(".agents/dashboard/messages.md")).toBe(true)
    expect(linkHolds("extensions/core/rules/no-such-rule.md")).toBe(false)
    expect(linkHolds("../outside.md")).toBe(false)
    expect(linkHolds("/AGENTS.md")).toBe(false)
  })
})
