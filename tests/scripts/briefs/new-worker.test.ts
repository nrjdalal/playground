import { expect, test } from "bun:test"
import { join } from "node:path"

test("the worker template opens the draft before waiting on CI, and cites a run by its id or link", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/new-worker.md")).text()
  const line =
    text.split("\n").find((l) => l.includes("open your draft PR before you wait on CI")) ?? ""
  expect(line).toContain("only on a pull request into `canary`")
  expect(line).toContain("by its run id or link")
})
