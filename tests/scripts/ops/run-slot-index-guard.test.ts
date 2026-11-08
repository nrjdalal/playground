import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// issue 1487: a lane test named the running checkout in a git -C word and the checkout's index answered for its fixture, so a staged packages/ file failed it; every test under tests/scripts/ops/ names a repo of its own instead, and this guard holds them to that
const here = import.meta.dir
const files = readdirSync(here).filter(
  (f) => f.endsWith(".test.ts") && f !== "run-slot-index-guard.test.ts",
)

test("no test under tests/scripts/ops names the running checkout in a git -C word", () => {
  const hits: string[] = []
  for (const f of files) {
    const lines = readFileSync(join(here, f), "utf8").split("\n")
    // a binding whose value derives the checkout the file runs in, on the assignment's own line, as the bug wrote it
    const bound = new Set<string>()
    for (const line of lines) {
      const made = line.match(/(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(.+)$/)
      if (made && /import\.meta\.dir|process\.cwd\(\)/.test(made[2])) bound.add(made[1])
    }
    for (const [n, line] of lines.entries()) {
      if (!line.includes("git -C")) continue
      const direct = /import\.meta\.dir|process\.cwd\(\)/.test(line)
      const used = [...bound].filter((name) => line.includes(`\${${name}}`))
      if (direct || used.length > 0) hits.push(`${f}:${n + 1}`)
    }
  }
  expect(hits).toEqual([])
})
