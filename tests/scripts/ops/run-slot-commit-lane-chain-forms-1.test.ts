import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chainStart as start, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a chain that commits with a step off the closed list counts as a build: the cd forms, whose reading of ~, .., - and a command let heavy steps through
describe("a chain that commits with a step off the list counts as a build", () => {
  for (const steps of [
    "cd ~ && git add . && git commit -m x",
    "cd $HOME && git add . && git commit -m x",
    "cd ROOT && env A=1 git add . && env A=1 git commit -m x",
    "cd .. && git commit -m x",
  ])
    test(`a chain that commits with a step off the list counts as a build: ${steps}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await start(m, steps).waits()).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })
})
