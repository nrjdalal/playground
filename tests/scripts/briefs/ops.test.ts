import { expect, test } from "bun:test"
import { join } from "node:path"

// an extension's job raises the signal, and Ops turns it into the stop and the all-clear
test("the Ops brief raises the stop and the all-clear from the extension's signal", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/ops.md")).text()
  const line = text.split("\n").find((l) => l.startsWith("**stop**:")) ?? ""
  expect(line).toContain("the extension's signal")
  expect(line).toContain("raise the stop")
  expect(line).toContain("raise the all-clear")
})

// for an urgent ticket the owner wants everything else stopped, so the stop gives the ticket's session focus and preempts the runs already in a slot
test("the Ops brief's stop gives the ticket's session focus, preempts, and ends focus at the all-clear", async () => {
  const text = await Bun.file(join(import.meta.dir, "../../../scripts/briefs/ops.md")).text()
  const line = text.split("\n").find((l) => l.startsWith("**stop**:")) ?? ""
  expect(line).toContain("playground focus on --session")
  expect(line).toContain("run-slot.sh preempt")
  expect(line).toContain("playground focus off")
})
