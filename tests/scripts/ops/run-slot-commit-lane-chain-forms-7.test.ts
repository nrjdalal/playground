import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chainStart as start, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a chain that commits with a step off the closed list counts as a build: the even run of \, a # line ending in \, and set -k, from the cached-commit change's review rounds
describe("a chain that commits with a step off the list counts as a build", () => {
  for (const steps of [
    // review round 2 of the cached-commit change: a line ending in an even run of \ is not joined, a # line ends at its newline, and set -k reads a later VAR=x as env
    "cd ROOT && git commit -m a\\\\\nbun run build",
    "# note \\\nbun run build\ncd ROOT && git commit -m x",
    "set -k\ncd ROOT && git commit -m x",
  ])
    test(`a chain that commits with a step off the list counts as a build: ${steps}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await start(m, steps).waits()).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })
})
