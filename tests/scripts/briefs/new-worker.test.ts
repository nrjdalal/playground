import { expect, test } from "bun:test"
import { join } from "node:path"

test("the worker template opens the draft before waiting on CI, and cites a run by its id or link", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/new-worker.md")).text()
  const line =
    text.split("\n").find((l) => l.includes("open your draft PR before you wait on CI")) ?? ""
  expect(line).toContain("only on a pull request into `canary`")
  expect(line).toContain("by its run id or link")
})

// an urgent ticket gets the Mac: every other session idles on the lead's stop until the all-clear
test("the worker template carries the stop: commit, stop your own slot tasks, go idle, and carry on at the all-clear", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/new-worker.md")).text()
  const line = text.split("\n").find((l) => l.startsWith("**stop**:")) ?? ""
  expect(line).toContain("commit your work")
  expect(line).toContain("stop your own queued and running slot tasks by their own handle")
  expect(line).toContain("go idle, with no new round, merge or spawn")
  expect(line).toContain("on your lead's all-clear, carry on where you stopped")
  expect(line).toContain("the urgent ticket's own session and its checkers keep working")
})

// a runner's job (a dev server, the live dashboard) stays up through the stop, and only its heavy upkeep waits
test("the worker template, which runners read too, keeps a runner's job up through the stop", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/new-worker.md")).text()
  const line = text.split("\n").find((l) => l.startsWith("A runner keeps")) ?? ""
  expect(line).toContain("keeps its long-running job up through an urgent stop")
  expect(line).toContain(
    "only its heavy upkeep (an install, a build, a clone) waits for the all-clear",
  )
})

// issue 2030: a checker's account goes through $acct, and a Python worktree takes its own venv
test("a worker's start script resolves its checker's account into $acct and makes its own venv", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/new-worker.md")).text()
  expect(text).toContain(
    '`acct=$(bun packages/scripts/src/playground/cli.ts accounts list | grep -o "<pattern>" | head -1)`',
  )
  expect(text).toContain("no call's input holds a full email address")
  expect(text).toContain("`uv sync --frozen`")
  expect(text).toContain("never borrows another worktree's")
})

// issue 2166: the Builder's standing brief lines live here, so a lead's brief adds only its item's own steps
test("the worker template's Standing lines hold the lead's standing brief rules", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/new-worker.md")).text()
  const standing = text.slice(text.indexOf("## Standing lines"))
  expect(text).toContain("## Standing lines")
  expect(standing).toContain("as a count and a one-line class, and the lead files it")
  expect(standing).toContain("retry every 2 minutes and tell your lead once")
  expect(standing).toContain("by its seat name or `$acct`")
  expect(standing).toContain(
    "a test stubs the live dashboard, its database, a live session's pane and a real token",
  )
  expect(standing).toContain("Every commit and push runs its hooks")
  expect(standing).toContain("-handoff.md` (mode 600) with every push")
  expect(standing).toContain("**signal** and **slots** rules")
})
