import { expect, test } from "bun:test"
import { join } from "node:path"

// Ops raises an urgent ticket's stop and all-clear, and the Builder carries each to every worker and checker
test("the Builder's brief relays the stop to every worker and checker, then the all-clear", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/builder.md")).text()
  const line = text.split("\n").find((l) => l.startsWith("**stop**:")) ?? ""
  expect(line).toContain("send it to every worker and checker")
  expect(line).toContain("all-clear")
  expect(line).toContain("the urgent ticket's own session and its checkers keep working")
})
