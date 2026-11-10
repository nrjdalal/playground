import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 04:05Z, 3 Nov: a commit whose pre-commit runs next build counts a staged web/next file through every form git reads it
describe("a commit whose pre-commit runs next build: the forms git reads", () => {
  test("staging a Python file under packages waits as a big run, since lefthook skips only tests/'s", async () => {
    const m = repo({ idle: 30 }, ["packages/scripts/src/tool.py"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).waits()).toBe(true)
  })

  test("git -C <dir> commit -C <rev> reads the rev as the message's commit and still counts a staged web/next file", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(
      await m
        .start("worker-x", {}, undefined, ["git", "-C", m.root, "commit", "-C", "HEAD"])
        .waits(),
    ).toBe(true)
  })

  test("git commit --pathspec-from-file counts a web/next file it may commit", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"], ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    const argv = [
      "git",
      "-C",
      m.root,
      "commit",
      "-m",
      "x",
      `--pathspec-from-file=${m.root}/list.txt`,
    ]
    expect(await m.start("worker-x", {}, undefined, argv).waits()).toBe(true)
  })

  // review round 11: --work-tree's value is not the verb, so the commit after it is still read
  test("git --work-tree <dir> commit -am counts the web/next file it stages", async () => {
    const m = repo({ idle: 30 }, [], ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    const argv = ["git", "--work-tree", m.root, "commit", "-am", "x"]
    expect(await m.start("worker-x", {}, undefined, argv).waits()).toBe(true)
  })
})
