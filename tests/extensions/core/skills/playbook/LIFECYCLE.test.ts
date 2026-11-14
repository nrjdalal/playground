import { expect, test } from "bun:test"
import { join } from "node:path"

const LIFECYCLE = join(
  import.meta.dir,
  "../../../../../extensions/core/skills/playbook/LIFECYCLE.md",
)

// issue 2030: auto-end's beat closes a finished worker's checkers, so the worker leaves them to it
test("a worker leaves its checkers to auto-end's beat, which holds one idle under 10 minutes", async () => {
  const text = await Bun.file(LIFECYCLE).text()
  const line =
    text.split("\n").find((l) => l.includes("leaves its checkers to auto-end's beat")) ?? ""
  expect(line).toContain("does not close them itself")
  expect(line).toContain("under 10 minutes")
})
