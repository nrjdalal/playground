import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 5 Nov: a bash script's line joins, read line by line as sh reads them
describe("a bash script file: joins", () => {
  const COMMITS = [
    "#!/bin/bash",
    "# commit and push the docs",
    "set -euo pipefail",
    "cd ROOT",
    "git add docs/notes.md",
    "git commit -m x",
    "git push origin",
  ]
  const script = (m: ReturnType<typeof repo>, lines: string[]) => {
    const path = join(m.root, "outside", "chain.sh")
    mkdirSync(join(m.root, "outside"), { recursive: true })
    writeFileSync(path, lines.join("\n").replaceAll("ROOT", m.root) + "\n")
    return path
  }

  for (const [what, lines] of [
    [
      "an even run of \\ before a line break",
      [...COMMITS.slice(0, 5), "git commit -m a\\\\", "bun run build", ...COMMITS.slice(6)],
    ],
    [
      "a # line ending in \\",
      [...COMMITS.slice(0, 5), "# note \\", "bun run build", ...COMMITS.slice(5)],
    ],
    ["a set -k", ["set -k", ...COMMITS]],
  ] as const)
    test(`with ${what} waits and never takes run-slot-commit`, async () => {
      const m = repo({ idle: 30 }, [], ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(
        await m.start("worker-x", {}, undefined, ["bash", script(m, [...lines])]).waits(),
      ).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })
})
