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
