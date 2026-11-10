import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { repo } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// 04:05Z, 3 Nov: the forms that point git at another repo or another path still count the staged web/next file
describe("a commit whose pre-commit runs next build: other repos and paths", () => {
  // review round 12: an env word other than NODE_ENV or RUN_SLOT_HERE, such as GIT_DIR, can point git at another repo
  test("env GIT_DIR=<repo> git -C <docs> commit counts as a build", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    mkdirSync(join(m.root, "docs"), { recursive: true })
    m.hold("run-slot", 3, "big")
    const argv = [
      "env",
      `GIT_DIR=${m.root}/.git`,
      "git",
      "-C",
      `${m.root}/docs`,
      "commit",
      "-m",
      "x",
    ]
    expect(await m.start("worker-x", {}, undefined, argv).waits()).toBe(true)
  })

  test("git commit -- <path> counts the web/next path it commits", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"], ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(
      await m
        .start("worker-x", {}, undefined, [
          "git",
          "commit",
          "-m",
          "x",
          "--",
          "web/next/src/app/page.tsx",
        ])
        .waits(),
    ).toBe(true)
  })

  test("git commit <folder> counts a build file git finds under the folder it names", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"], ["packages/env/src/data-dir.ts"])
    m.hold("run-slot", 3, "big")
    expect(
      await m.start("worker-x", {}, undefined, ["git", "commit", "-m", "x", "packages"]).waits(),
    ).toBe(true)
  })
})
