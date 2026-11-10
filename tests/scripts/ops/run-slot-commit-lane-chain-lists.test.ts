import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chainLane as lane, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a chain whose every step is on the closed list takes the commit lane: the list itself, read as sh reads it, in sh and dash
describe("a chain on the closed list takes run-slot-commit", () => {
  test("a chain whose every step is on the closed list takes run-slot-commit beside a big run", async () => {
    for (const steps of [
      "cd ROOT && git add . && git commit -m x && git push origin",
      "git -C ROOT add . && git -C ROOT commit -m x && git -C ROOT push origin",
      "bun run precommit:light && cd ROOT && git commit -m x",
      // review round 13: a quoted ( in a conventional commit message stays a word
      'cd ROOT && git commit -m "docs(PG-899): x"',
      "cd ROOT && git commit -m 'fix(PG-899): x'",
    ]) {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect([steps, await lane(m, steps)]).toEqual([steps, "run-slot-commit"])
    }
  })

  // review round 1 of #1132: a dash chain is read as a sh one, for its lane and for its build
  test("a dash chain on the closed list takes run-slot-commit beside a big run", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    expect(await lane(m, "cd ROOT && git commit -m x", false, "dash")).toBe("run-slot-commit")
  })
})
