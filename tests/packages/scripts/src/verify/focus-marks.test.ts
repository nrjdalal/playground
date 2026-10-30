import { describe, expect, test } from "bun:test"

import {
  FOCUS_PAGES,
  focusMarksResult,
} from "../../../../../packages/scripts/src/verify/focus-marks"

describe("focusMarksResult (#2353: with no ring, a control whose ring was its only mark showed no focus)", () => {
  test("passes when every focusable control shows its focus", () => {
    expect(focusMarksResult("/dashboard", { checked: 121, unmarked: [] })).toEqual({
      check: "focus-marks /dashboard",
      detail: "all 121 focusable controls show their focus",
      ok: true,
    })
  })

  test("fails naming each control that shows nothing, the first twelve then a count", () => {
    const unmarked = Array.from({ length: 14 }, (_, i) => `Row ${i} [sidebar-menu-button]`)
    const result = focusMarksResult("/dashboard/system", { checked: 131, unmarked })
    expect(result.ok).toBe(false)
    expect(result.detail).toStartWith("14 of 131 show no focus: Row 0 [sidebar-menu-button]; ")
    expect(result.detail).toEndWith("Row 11 [sidebar-menu-button] and 2 more")
  })

  test("fails when the page could not be read", () => {
    expect(focusMarksResult("/dashboard", null).ok).toBe(false)
  })

  test("reads the Dashboard and a page of each table kind", () => {
    expect(FOCUS_PAGES).toContain("/dashboard")
    expect(FOCUS_PAGES).toContain("/dashboard/system")
    expect(FOCUS_PAGES).toEqual([...FOCUS_PAGES].sort())
  })
})
