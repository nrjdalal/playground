import { expect, test } from "bun:test"
import { join } from "node:path"

test("every brief's stop stays generic: it names no tracker or channel, since the signal comes from an extension", async () => {
  for (const name of [
    "builder.md",
    "new-reviewer.md",
    "new-tester.md",
    "new-worker.md",
    "ops.md",
  ]) {
    const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs", name)).text()
    const line = text.split("\n").find((l) => l.startsWith("**stop**:")) ?? ""
    expect(line).not.toBe("")
    expect(line).not.toMatch(/linear|slack|jira|pagerduty|zendesk|\bsla\b/i)
  }
})
