import { describe, expect, test } from "bun:test"

import {
  HOVER_SLACK_MS,
  hoverResult,
  nativeResult,
  OPEN_LIMIT_MS,
  openResult,
} from "../../../../../packages/scripts/src/verify/tooltips"
import { TOOLTIP_DELAY_MS } from "../../../../../web/next/src/lib/tooltip"

describe("nativeResult", () => {
  test("a page with no native title box passes, and one with any fails naming them", () => {
    expect(nativeResult("/dashboard", []).ok).toBe(true)
    const failed = nativeResult("/dashboard", ['span "worker-greed"'])
    expect(failed.ok).toBe(false)
    expect(failed.detail).toBe('1 native title box: span "worker-greed"')
  })
})

describe("openResult", () => {
  test("passes a tooltip that opens on focus within the limit with its words", () => {
    expect(openResult("focus", { ms: 16, text: "System\nAll good" }, "System").ok).toBe(true)
  })

  test("fails one that opens late, says other words or never opens", () => {
    expect(openResult("focus", { ms: OPEN_LIMIT_MS + 1, text: "System" }, "System").ok).toBe(false)
    expect(openResult("focus", { ms: 100, text: "Other" }, "System").detail).toContain("Other")
    expect(openResult("focus", { ms: null, text: null }, "System").detail).toBe("no tooltip opened")
  })
})

// Tooltips wait on hover for one second, so a sweep of the pointer down the sidebar opens none.
describe("hoverResult", () => {
  test("passes a tooltip that waits the shared delay, then opens with its words", () => {
    expect(TOOLTIP_DELAY_MS).toBe(1000)
    expect(hoverResult("hover", { ms: 1040, text: "Claude usage" }, "Claude usage").ok).toBe(true)
  })

  test("fails one that opens before the delay, long after it, with other words or never", () => {
    expect(hoverResult("hover", { ms: 160, text: "Claude usage" }, "Claude usage").detail).toBe(
      "opened in 160ms, before the 1000ms delay",
    )
    expect(
      hoverResult("hover", { ms: TOOLTIP_DELAY_MS + HOVER_SLACK_MS + 1, text: "x" }, "x").ok,
    ).toBe(false)
    expect(hoverResult("hover", { ms: 1040, text: "Other" }, "Claude usage").ok).toBe(false)
    expect(hoverResult("hover", { ms: null, text: null }, "x").detail).toBe("no tooltip opened")
  })
})
