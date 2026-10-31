import { expect, test } from "bun:test"
import { join } from "node:path"

const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/optimizer.md")).text()
const steps = text.split("\n").filter((line) => /^\d+\. /.test(line))

test("the optimizer's brief template loads the playbook, ends every step on a completion criterion and carries the signal rule", () => {
  expect(steps[0]).toContain("Load the playbook skill")
  expect(steps.length).toBeGreaterThanOrEqual(7)
  for (const step of steps) expect(step).toMatch(/ Done when [^.]+\.$/)
  expect(text).toContain("**signal**: signal only processes you started")
})

test("its retro runs on ops-tick's two beats, reads the table script, and keeps a failed run's error text when first seen", () => {
  expect(text).toContain("`optimizer tick`")
  expect(text).toContain("`optimizer daily`")
  expect(text).toContain("packages/scripts/src/retro/table.ts")
  expect(text).toContain("--log-failed")
})

test("a first retro with no state file has a since and a ship to start from", () => {
  expect(text).toContain("With no state file")
})

test("the daily beat's threshold sits under its own day, and its reads go through REST as the github rule says", () => {
  expect(text).toContain("20 hours old or more")
  expect(text).toContain('gh api "repos/{owner}/{repo}/pulls?base=main&state=closed')
  expect(text).not.toMatch(/gh pr (list|view)/)
})
