import { expect, test } from "bun:test"
import { join } from "node:path"

// an urgent ticket gets the Mac: every other session idles on the lead's stop until the all-clear
test("the reviewer template carries the stop: stop your own slot tasks, go idle, and carry on at the all-clear", async () => {
  const text = await Bun.file(
    join(import.meta.dir, "../../../scripts/briefs/new-reviewer.md"),
  ).text()
  const line = text.split("\n").find((l) => l.startsWith("**stop**:")) ?? ""
  expect(line).toContain("stop your own queued and running slot tasks by their own handle")
  expect(line).toContain("go idle, with no new round, merge or spawn")
  expect(line).toContain("all-clear, carry on where you stopped")
  expect(line).toContain("the urgent ticket's own session and its checkers keep working")
})
