import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chainStart as start, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a chain that commits with a step off the closed list counts as a build: a process substitution runs its command, and a subshell runs before the cd
describe("a chain that commits with a step off the list counts as a build", () => {
  for (const steps of [
    // review round 5: a process substitution runs its command
    "cd ROOT && git commit -m x <(bun run build)",
    "cd ROOT && git commit -m x>(bun run build)",
    "(bun run build) && cd ROOT && git commit -m x",
    "cd ROOT && git commit -m x |& bun run build",
  ])
    test(`a chain that commits with a step off the list counts as a build: ${steps}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await start(m, steps).waits()).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })
})
