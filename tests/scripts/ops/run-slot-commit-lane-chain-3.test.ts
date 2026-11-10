import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { chainLane as lane, chainStart as start, LEFTHOOK, log, repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// the chain's add reads its own folder, so an add beside a cd decides the lane by what git finds there
describe("a sh -c chain of git steps: where the add runs", () => {
  // review round 8: from a subfolder, git ls-files prints an untracked file relative to it unless --full-name
  test("a chain on the list that adds an untracked web/next file from inside web/next waits as a big run", async () => {
    const m = repo({ idle: 30 }, [], [], LEFTHOOK, ["web/next/src/app/new.tsx"])
    mkdirSync(join(m.root, "web/next/src/app"), { recursive: true })
    m.hold("run-slot", 3, "big")
    expect(await start(m, "cd ROOT/web/next && git add . && git commit -m x").waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  // review round 9: git add -A, --all and :/ stage the whole tree from any folder, untracked files outside it included
  test("a chain on the list that adds the whole tree from docs, with an untracked web/next file, waits as a big run", async () => {
    const m = repo({ idle: 30 }, [], [], LEFTHOOK, ["web/next/src/app/new.tsx"])
    mkdirSync(join(m.root, "docs"), { recursive: true })
    m.hold("run-slot", 3, "big")
    expect(await start(m, "cd ROOT/docs && git add -A && git commit -m x").waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  // review round 10: an add reads its paths from its own folder, so one in another folder than the commit counts as a build
  test("a chain on the list whose add runs in another folder than its commit waits as a big run", async () => {
    const m = repo({ idle: 30 }, [], ["web/next/src/app/page.tsx"])
    mkdirSync(join(m.root, "web"), { recursive: true })
    m.hold("run-slot", 3, "big")
    const steps = "git -C ROOT/web add next/src/app/page.tsx && git -C ROOT commit -m x"
    expect(await start(m, steps).waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  test("while one whose add names only a Markdown file takes run-slot-commit", async () => {
    const m = repo({ idle: 30 }, [], ["docs/notes.md", "web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(await lane(m, "cd ROOT && git add docs/notes.md && git commit -m x")).toBe(
      "run-slot-commit",
    )
  })
})
