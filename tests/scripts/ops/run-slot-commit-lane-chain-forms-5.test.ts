import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chainStart as start, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a chain that commits with a step off the closed list counts as a build: the zsh separators, the add flags off the list, and a cd a pipe strips
describe("a chain that commits with a step off the list counts as a build", () => {
  for (const steps of [
    // zsh runs the command after |& or &|
    "cd ROOT && git commit -m x &| bun run build",
    // builder, 5 Nov: a git add flag outside the list, such as -f, which stages ignored files
    "cd ROOT && git add -f docs/notes.md && git commit -m x",
    // review round 10: an add option cluster
    "cd ROOT && git add -Av && git commit -m x",
    // review round 7: a cd beside |, &, || or in a subshell does not carry to the next step
    "cd ROOT | git commit -m x",
  ])
    test(`a chain that commits with a step off the list counts as a build: ${steps}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await start(m, steps).waits()).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })
})
