import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")

const lines = (await Bun.file(join(root, ".agents", "decisions.md")).text())
  .split("\n")
  .filter((line) => line.startsWith("- "))

describe(".agents/decisions.md, the decisions register", () => {
  test("the register holds at least one entry", () => {
    expect(lines.length).toBeGreaterThan(0)
  })

  test("every entry's link target exists (an ADR file, or an issue number that parses)", () => {
    for (const line of lines) {
      expect(line, line).toContain(" -> ")
      const target = line.split(" -> ").at(-1)?.trim()
      expect(target, line).toBeTruthy()
      if (target!.startsWith(".agents/adr/")) {
        expect(existsSync(join(root, target!)), line).toBe(true)
      } else {
        expect(target!.match(/^#\d+$/), line).toBeTruthy()
        expect(Number(target!.slice(1))).toBeGreaterThan(0)
      }
    }
  })
})
