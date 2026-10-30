import { describe, expect, test } from "bun:test"

import { sendFocusResult } from "../../../../../packages/scripts/src/verify/send-focus"

describe("sendFocusResult", () => {
  test("passes focus in the box after a send, where a paste lands", () => {
    expect(sendFocusResult("f", "composer").ok).toBe(true)
  })

  // a click on Send left focus on the button, where a dictation app's Cmd+V lands nowhere
  test("fails focus left on Send", () => {
    const left = sendFocusResult("f", "Send to Opus 5.5 High")
    expect(left.ok).toBe(false)
    expect(left.detail).toContain("focus is on Send to Opus 5.5 High")
  })

  test("fails a page with no focus at all", () => {
    expect(sendFocusResult("f", null).detail).toContain("focus is on nothing")
  })
})
