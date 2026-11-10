import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chainStart as start, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a chain that commits with a step off the closed list counts as a build: a cd a subshell or a background join strips, and the line join that hides a step
describe("a chain that commits with a step off the list counts as a build", () => {
  for (const steps of [
    "cd ROOT & git commit -m x",
    "(cd ROOT); git commit -m x",
    // review round 1 of the cached-commit change: sh joins a \ line break before it reads a # line as a comment
    "cd ROOT && git commit -m x\\\n#;bun run build",
  ])
    test(`a chain that commits with a step off the list counts as a build: ${steps}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await start(m, steps).waits()).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })
})
