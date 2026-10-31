import { expect, test } from "bun:test"
import { join } from "node:path"

const dispatch = () =>
  Bun.file(
    join(import.meta.dir, "../../../../../extensions/core/skills/playbook/DISPATCH.md"),
  ).text()

test("a worker merging canary or a stack's parent in keeps the merge plain and commits each edit after it on its own", async () => {
  const text = await dispatch()
  const line =
    text.split("\n").find((l) => l.includes("keeps the merge commit a plain merge")) ?? ""
  expect(line).toContain("merges `canary` or its stack's parent into its PR")
  expect(line).toContain("each edit after it as a commit of its own")
  expect(line).toContain("an edit inside a merge as blocking")
})
