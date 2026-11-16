import { describe, expect, test } from "bun:test"

import { swapDetail } from "../../../../../../web/next/src/components/dashboard/system-panel"

describe("swapDetail", () => {
  test("macOS keeps its line: it grows swap as it needs it", () => {
    expect(swapDetail("darwin")).toBe("macOS grows swap as it needs it")
  })

  test("Linux says its swap stays at a set size, never macOS's line", () => {
    expect(swapDetail("linux")).toBe("Linux keeps swap at a set size")
  })
})
