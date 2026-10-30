import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { storeWith } from "../../../../scripts/hooks/render-set"

// Every pr-merge suite reads the factory's files under this run's scratch config folder, never the real one: a suite opts in by importing this module.
const scratch = mkdtempSync(join(tmpdir(), "pr-merge-config-"))
process.env.CLAUDE_CONFIG_DIR = scratch
process.env.PLAYGROUND_DATA_DIR = join(scratch, "playground")
// factory.repo set in its store to the repo the suites' fixtures name, so no suite reads the checkout's origin or asks gh, which a box run has neither of
storeWith(process.env.PLAYGROUND_DATA_DIR, {}, { "factory.repo": "acme/factory" })
process.on("exit", () => rmSync(scratch, { force: true, recursive: true }))

test("pr-merge reads this run's scratch config folder, never the real one", () => {
  expect(process.env.CLAUDE_CONFIG_DIR).toBe(scratch)
  expect(process.env.PLAYGROUND_DATA_DIR).toBe(join(scratch, "playground"))
  expect(scratch.startsWith(join(homedir(), ".claude"))).toBe(false)
})
