import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chainStart as start, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a chain that commits with a step off the closed list counts as a build: a cd a command names, an option word, and a step that runs
describe("a chain that commits with a step off the list counts as a build", () => {
  for (const steps of [
    "cd - && git commit -m x",
    "cd `echo ROOT` && git commit -m x",
    "git -c user.name=x -C ROOT commit -m x",
    "cd ROOT && bun run test && git commit -m x",
  ])
    test(`a chain that commits with a step off the list counts as a build: ${steps}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await start(m, steps).waits()).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })
})
