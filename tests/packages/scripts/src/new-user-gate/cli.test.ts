import { describe, expect, test } from "bun:test"

import {
  leftForYou,
  report,
  usageWords,
} from "../../../../../packages/scripts/src/new-user-gate/cli"

describe("the new-user gate's reads", () => {
  test("reads install.sh's Left for you lines, and none from a clean finish", () => {
    expect(
      leftForYou(
        "Playground needs git...\nLeft for you:\n  - node: brew install node\ninstall.sh exit 1",
      ),
    ).toEqual(["node: brew install node"])
    expect(leftForYou("Playground is ready.\ninstall.sh exit 0")).toEqual([])
  })

  test("takes a usage reading as shown, and No usage windows read as none", () => {
    expect(usageWords("Alpha\nClaude usage: week 12% left, 5-hour 80% left\n")).toBe(
      "week 12% left, 5-hour 80% left",
    )
    expect(usageWords("Alpha\nClaude usage: No usage windows read\n")).toBeNull()
    expect(usageWords("Alpha\nClaude usage: Not read yet\n")).toBeNull()
    expect(usageWords("Alpha")).toBeNull()
  })

  test("prints PASS or FAIL per step with its detail, then the count", () => {
    expect(
      report([
        { detail: "", name: "curl | bash exits 0", ok: true },
        { detail: "no usage reading", name: "Usage shows", ok: false },
      ]),
    ).toBe("PASS 1. curl | bash exits 0\nFAIL 2. Usage shows: no usage reading\n1 of 2 passed")
  })
})
