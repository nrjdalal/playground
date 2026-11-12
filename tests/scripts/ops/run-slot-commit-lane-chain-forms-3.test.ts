import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chainStart as start, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a chain that commits with a step off the closed list counts as a build: the words sh reads as its own, a # it reads as a comment, and a brace it expands
describe("a chain that commits with a step off the list counts as a build", () => {
  for (const steps of [
    // review round 5: a # that sh reads as a comment, and a brace sh expands
    "cd ROOT && git commit -m z#1 && bun run build",
    "cd ROOT && git add . && git commit -m x\n# c\nbun run build",
    "cd ROOT && git add web/next/src/app/{a,b}.tsx && git commit -m x",
    "cd ROOT && git add <(bun run build) && git commit -m x",
  ])
    test(`a chain that commits with a step off the list counts as a build: ${steps}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await start(m, steps).waits()).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })
})
