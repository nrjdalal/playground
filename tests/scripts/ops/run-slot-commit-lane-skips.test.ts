import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { log, repo, step } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

describe("a commit that stages no web/next file", () => {
  test("still takes run-slot-commit at once, beside a big run", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).ran()).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  test("nor does git commit -n, whose pre-commit never runs, though it stages one", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit", "-n", "-m", "x"]).ran()).toBe(
      true,
    )
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  test("nor does git commit -S<keyid> whose key id holds an a, which reads no -a", async () => {
    const m = repo({ idle: 30 }, ["docs/notes.md"], ["web/next/src/app/page.tsx"])
    m.hold("run-slot", 3, "big")
    expect(
      await m.start("worker-x", {}, undefined, ["git", "commit", "-Sabc", "-m", "x"]).ran(),
    ).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  // lefthook's build step skips a commit whose every staged file is Markdown or a Python test under tests/, so it runs no next build
  test("nor does one staging only Markdown under api/hono and packages", async () => {
    const m = repo({ idle: 30 }, ["api/hono/README.md", "packages/env/README.md"])
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).ran()).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  test("and commit-slot.ts's build for it stays small", async () => {
    const m = repo({}, ["docs/notes.md"])
    m.hold("run-slot", 3, "big")
    m.hold("run-slot-2", 2, "medium")
    expect(await m.start("commit-wt", {}, undefined, step("build")).ran()).toBe(true)
  })
})

// the dispatcher, 4 Nov: a commit in another repo, whose pre-commit ran lint-staged and commitlint with no build, sat 65 minutes in the big-run queue for a 1-second job
describe("a commit in a repo whose lefthook.yml pre-commit runs no build", () => {
  const OTHER = `pre-commit:
  commands:
    lint-staged:
      run: bunx lint-staged
pre-push:
  commands:
    build:
      run: bun run build
commit-msg:
  commands:
    commitlint:
      run: bunx commitlint --edit {1}
`
  test("takes run-slot-commit at once with a web/next file staged, beside a big run", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx", "packages/env/src/x.ts"], [], OTHER)
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).ran()).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })

  test("while one whose pre-commit lists its build as a quoted job still waits as a big run", async () => {
    const jobs = `pre-commit:\n  jobs:\n    - run: "bun run build"\n`
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"], [], jobs)
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).waits()).toBe(true)
  })

  test("but one in a repo with no lefthook.yml takes run-slot-commit at once too", async () => {
    const m = repo({ idle: 30 }, ["web/next/src/app/page.tsx"], [], null)
    m.hold("run-slot", 3, "big")
    expect(await m.start("worker-x", {}, undefined, ["git", "commit"]).ran()).toBe(true)
    expect(log(m)).toMatch(/ start worker-x \d+ run-slot-commit waited=/)
  })
})
