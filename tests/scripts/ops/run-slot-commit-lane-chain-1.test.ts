import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { chainLane as lane, chainStart as start, LEFTHOOK, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 4 Nov: a commit inside a sh -c chain counts as the bare commit would, so one that runs next build still waits as a big run
// builder, 5 Nov: three review rounds each found one more form that a reading of cd, ~ or env let through, so a chain takes the commit lane only when every step is a form on a closed list, and any other form in a chain that commits counts as a build; a chain starts outside the repo unless it is given the repo, where a bare git step runs in run-slot's own folder
describe("a sh -c chain of git steps", () => {
  test("while a dash chain whose commit takes a web/next file waits as a big run", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"], [], LEFTHOOK)
    m.hold("run-slot", 3, "big")
    expect(await start(m, "cd ROOT && git commit -m x", false, "dash").waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  // builder, 5 Nov: a bare git step runs in run-slot's own folder, so the chain the issue names takes the commit lane from inside the repo
  test("a chain of bare git steps run from the repo takes run-slot-commit beside a big run", async () => {
    const steps = "git add . && git commit -m x && git push origin"
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    expect(await lane(m, steps, true)).toBe("run-slot-commit")
  })

  // review round 7: an env word before the shell, such as BASH_ENV or PATH, changes what the shell runs
  test("a chain behind an env word counts as a build", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    const outside = join(m.root, "outside")
    mkdirSync(outside, { recursive: true })
    const argv = ["env", "BASH_ENV=/dev/null", "sh", "-c", `cd ${m.root} && git commit -m x`]
    expect(await m.start("worker-x", {}, undefined, argv, outside).waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  // builder, 5 Nov: from the repo too, where a bare git step alone is on the list, one after a cd - or a relative cd still counts as a build
  for (const steps of [
    "cd - && git add . && git commit -m x",
    "cd docs && git add . && git commit -m x",
  ])
    test(`a bare git step after a cd off the list, run from the repo, counts as a build: ${steps}`, async () => {
      const m = repo({ idle: 30 }, ["docs/notes.md"])
      m.hold("run-slot", 3, "big")
      expect(await start(m, steps, true).waits()).toBe(true)
      expect(log(m)).not.toContain("run-slot-commit")
    })
})
