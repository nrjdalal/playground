import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { log, repo, step } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

// commit-slot.ts hands run-slot its steps: the build counts as the commit's own, the type checks keep their size
describe("a commit whose pre-commit runs next build: commit-slot.ts's steps", () => {
  test("git commit -uno reads its n as the untracked mode, not -n, and still counts a staged web/next file", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(
      await m.start("worker-x", {}, undefined, ["git", "commit", "-uno", "-m", "x"]).waits(),
    ).toBe(true)
  })

  test("commit-slot.ts's build for a worktree staging a web/next file counts as big", async () => {
    const m = repo({}, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 2, "medium")
    expect(await m.start("commit-wt", {}, undefined, step("build")).waits()).toBe(true)
  })

  // commit-slot.ts also runs a staged tree's type check as commit-<worktree>, which builds nothing
  test("commit-slot.ts's type check for that worktree keeps its own size", async () => {
    const m = repo({}, ["packages/scripts/src/x.ts"])
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 2, "medium")
    expect(await m.start("commit-wt", {}, undefined, step("check-types")).ran()).toBe(true)
  })

  // commit-slot.ts marks each step it hands run-slot RUN_SLOT_COMMIT_STEP=1, which sends it to run-slot-commit, but for a build that runs next build
  test("commit-slot.ts's marked build for it still waits as a big run, off run-slot-commit", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    const run = m.start("commit-wt", { RUN_SLOT_COMMIT_STEP: "1" }, undefined, step("build"))
    expect(await run.waits()).toBe(true)
    expect(log(m)).not.toContain("run-slot-commit")
  })

  test("while its marked type check takes run-slot-commit", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(
      await m
        .start("commit-wt", { RUN_SLOT_COMMIT_STEP: "1" }, undefined, step("check-types"))
        .ran(),
    ).toBe(true)
    expect(log(m)).toMatch(/ start commit-wt \d+ run-slot-commit waited=/)
  })
})
