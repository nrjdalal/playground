import { expect, test } from "bun:test"
import { join } from "node:path"

test("the dispatcher's brief template loads the playbook and carries the signal rule", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/dispatcher.md")).text()
  expect(text).toContain("Load the playbook skill")
  expect(text).toContain("**signal**: signal only processes you started")
})

test("the dispatcher starts the Optimizer at its own start, so ops-tick's retro beats reach a running session", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/dispatcher.md")).text()
  expect(text).toContain("start the Optimizer with `playground optimizer`")
})
