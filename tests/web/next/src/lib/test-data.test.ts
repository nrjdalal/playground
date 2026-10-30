import { describe, expect, test } from "bun:test"

import { tabTitle, TEST_DATA, testDataBadge } from "../../../../../web/next/src/lib/test-data"

describe("testDataBadge", () => {
  test("a fixture stack wears the Test data badge", () => {
    expect(TEST_DATA).toBe("Test data")
    expect(testDataBadge({ data: { dashboard: "fixture", message: "ok" } })).toBe("Test data")
  })

  test("a stack reading its own machine, a refused one and a failed read wear none", () => {
    for (const health of [
      { data: { dashboard: "live" } },
      { data: { dashboard: "refused" } },
      { data: {} },
      {},
      null,
      undefined,
      "fixture",
    ]) {
      expect(testDataBadge(health)).toBeUndefined()
    }
  })
})

describe("tabTitle", () => {
  test("every page's tab reads Playground alone, a fixture stack's with its badge", () => {
    expect(tabTitle(undefined)).toBe("Playground")
    expect(tabTitle(TEST_DATA)).toBe("Test data | Playground")
  })
})
