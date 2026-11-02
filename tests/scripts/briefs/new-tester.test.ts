import { expect, test } from "bun:test"
import { join } from "node:path"

test("the tester template moves the build output into the scratchpad before a cold build, which a commit's pre-commit build warms (#1762), and no-raw-delete refuses git clean -dX (#536)", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/new-tester.md")).text()
  expect(text).toContain("mv <worktree>/web/next/.next <worktree>/.turbo <scratchpad>/cold-1/")
  expect(text).not.toContain("clean -fdX")
})

test("the tester template has agent-browser written by its literal name, since no-raw-spawn refuses a program it cannot read (#1859)", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/new-tester.md")).text()
  expect(text).toContain("write `agent-browser` by its literal name")
})
