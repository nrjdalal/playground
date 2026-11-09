import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { chainStart as start, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// a chain that commits with a step off the closed list counts as a build: the forms three review rounds measured slipping through, and the ones beside them
describe("a chain that commits with a step off the list counts as a build", () => {
  for (const steps of [
    "cd ~ && git add . && git commit -m x",
    "cd $HOME && git add . && git commit -m x",
    "cd ROOT && env A=1 git add . && env A=1 git commit -m x",
    "cd .. && git commit -m x",
    "cd - && git commit -m x",
    "cd `echo ROOT` && git commit -m x",
    "git -c user.name=x -C ROOT commit -m x",
    "cd ROOT && bun run test && git commit -m x",
    // review round 5: a # that sh reads as a comment, and a brace sh expands
    "cd ROOT && git commit -m z#1 && bun run build",
    "cd ROOT && git add . && git commit -m x\n# c\nbun run build",
    "cd ROOT && git add web/next/src/app/{a,b}.tsx && git commit -m x",
    // review round 5: a process substitution runs its command
    "cd ROOT && git add <(bun run build) && git commit -m x",
    "cd ROOT && git commit -m x <(bun run build)",
    "cd ROOT && git commit -m x>(bun run build)",
    "(bun run build) && cd ROOT && git commit -m x",
    // zsh runs the command after |& or &|
    "cd ROOT && git commit -m x |& bun run build",
    "cd ROOT && git commit -m x &| bun run build",
    // builder, 5 Nov: a git add flag outside the list, such as -f, which stages ignored files
    "cd ROOT && git add -f docs/notes.md && git commit -m x",
    // review round 10: an add option cluster
    "cd ROOT && git add -Av && git commit -m x",
    // review round 7: a cd beside |, &, || or in a subshell does not carry to the next step
    "cd ROOT | git commit -m x",
    "cd ROOT & git commit -m x",
    "(cd ROOT); git commit -m x",
    // review round 1 of the cached-commit change: sh joins a \ line break before it reads a # line as a comment
    "cd ROOT && git commit -m x\\\n#;bun run build",
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
