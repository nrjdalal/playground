import { describe, expect, test } from "bun:test"

import { USAGE } from "../../../../../packages/scripts/src/machine-record/cli"

describe("record add's usage (PG-2697)", () => {
  test("the usage holds one line: an undo with a delete word comes in through --stdin", () => {
    const line = USAGE.split("\n").find((l) => /docker rm/.test(l) && /--stdin/.test(l))
    expect(line).toBeDefined()
    expect(line).toContain("rmdir")
    expect(line).toContain("--undo")
  })
})
