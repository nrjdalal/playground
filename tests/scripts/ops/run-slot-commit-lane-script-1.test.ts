import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 5 Nov: a `bash <script>` whose only steps were commits was never read, so it queued as a general job; its lines go through the same closed list
describe("a bash script file", () => {
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

  test("whose every line is on the closed list takes run-slot-commit beside a big run", async () => {
    const m = repo({ idle: 30 }, [], ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    // the fake appends its marker as the script's argument, which only a $ word could read
    await m.start("worker-x", {}, undefined, ["bash", script(m, COMMITS)]).p.exited
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  // #1321: the read drops each line's trailing comment, so a chain whose comment hides nothing runs as the shell runs it
  test("whose last step's trailing comment reads dropped takes run-slot-commit beside a big run", async () => {
    const m = repo({ idle: 30 }, [], ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    await m.start("worker-x", {}, undefined, [
      "bash",
      script(m, [...COMMITS, "git push origin # done"]),
    ]).p.exited
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  for (const [what, lines] of [
    ["a build step", [...COMMITS.slice(0, 4), "bun run build", ...COMMITS.slice(4)]],
    ["a variable", ["S=x", ...COMMITS]],
    ["a set that sets arguments", ["set -- a", ...COMMITS]],
    [
      "a line break into a # line",
      [...COMMITS.slice(0, 5), "git commit -m x\\", "#;bun run build", ...COMMITS.slice(6)],
    ],
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
