import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { WRAPPER_NAMES } from "../../../scripts/hooks/shell"
import { SCRIPT } from "./run-slot-fake"

// chain_steps reads past the wrapper words the hooks' shell reader reads past, so the two readers agree on which chain a wrapper runs
test("chain_steps's wrapper set is shell.ts's WRAPPERS", () => {
  const line = readFileSync(SCRIPT, "utf8").match(/^CHAIN_WRAPPERS="([^"]*)"$/m)
  expect(line?.[1].split(" ")).toEqual([...WRAPPER_NAMES])
})
