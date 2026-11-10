import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { chain, repo, takes } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 5 Nov: the shell a chain runs on reads as sh -c does, so its form rules hold there too, and a wrapper before the shell is a step off the list
describe("commit-lane chains on other shells and behind wrappers", () => {
  // dash -c and ksh -c chains read as sh -c does, so the merge form and its add-or-commit rule hold there too, and a wrapper before the shell is a step off the list
  for (const [shell, steps, lane] of [
    [
      "dash",
      "cd ROOT && git merge --no-edit origin/canary && git push origin x",
      "run-slot-commit",
    ],
    ["ksh", "cd ROOT && git merge --no-edit origin/canary; git add -A; git commit -m x", "waited"],
  ] as const)
    test(`${shell} -c with ${steps} ${lane === "waited" ? "waits off the commit lane" : "takes run-slot-commit"}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await takes(m, chain(m, steps, shell))).toBe(lane)
    })

  test("nice sh -c with a merge and its push waits off the commit lane", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    const argv = [
      "nice",
      ...chain(m, "cd ROOT && git merge --no-edit origin/canary && git push origin x"),
    ]
    expect(await takes(m, argv)).toBe("waited")
  })

  // 8: bash -c reads -e, -u, -x, -v and -o pipefail as options before its script, which zsh -c runs as sh does
  for (const argv of [
    ["bash", "-c", "-x", "cd ROOT && git commit -m x"],
    ["bash", "-c", "-eu", "-o", "pipefail", "cd ROOT && git commit -m x"],
    ["zsh", "-c", "cd ROOT && git commit -m x"],
  ])
    test(`${argv.join(" ")} takes run-slot-commit beside a big run`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(
        await takes(
          m,
          argv.map((a) => a.replaceAll("ROOT", m.root)),
        ),
      ).toBe("run-slot-commit")
    })

  // 13: precommit:light runs the script of the repo it runs in, so after a cd to another repo it is off the list
  test("a chain with bun run precommit:light after a cd to another repo waits", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    mkdirSync(join(m.root, "other"), { recursive: true })
    m.hold("run-slot", 3, "big")
    const steps = "cd ROOT/other && bun run precommit:light && cd ROOT && git commit -m x"
    expect(await takes(m, chain(m, steps), m.root)).toBe("waited")
  })

  test("while one after a cd inside run-slot's own repo takes run-slot-commit", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    mkdirSync(join(m.root, "docs"), { recursive: true })
    m.hold("run-slot", 3, "big")
    const steps = "cd ROOT/docs && bun run precommit:light && git commit -m x"
    expect(await takes(m, chain(m, steps), m.root)).toBe("run-slot-commit")
  })

  // 13: a cd after && that a ; follows may not have run when the commit does
  test("a chain whose cd joins by && and then ; waits", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    const steps = "git -C ROOT add docs/notes.md && cd ROOT ; git commit -m x"
    expect(await takes(m, chain(m, steps), m.root)).toBe("waited")
  })
})
