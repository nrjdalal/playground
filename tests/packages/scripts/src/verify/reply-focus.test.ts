import { describe, expect, test } from "bun:test"

import {
  clickFocus,
  focusResult,
  replyButton,
} from "../../../../../packages/scripts/src/verify/reply-focus"

describe("focusResult", () => {
  test("passes focus in the card's own box the moment Reply is clicked", () => {
    expect(focusResult("f", "comment").ok).toBe(true)
  })

  test("finds the card's Reply by the aria-label the Inbox gives it", () => {
    expect(replyButton("#i1")).toBe('[aria-label="Reply to #i1"]')
  })

  test("fails focus left on the button, where a paste sent at once goes (PG-1015)", () => {
    const left = focusResult("f", "button")
    expect(left.ok).toBe(false)
    expect(left.detail).toContain("focus is on button")
  })

  test("fails a page with no focus at all", () => {
    expect(focusResult("f", null).detail).toContain("focus is on nothing")
  })
})

// A page whose card draws late, as on a loaded host: the click waits for the card's Reply.
const lateCard = () => {
  let mounted = false
  const mount = Bun.sleep(50).then(() => {
    mounted = true
  })
  return {
    eval: async <T>() => (mounted ? "comment" : "no card") as T,
    run: async (...args: string[]) => {
      if (args[0] === "wait" && args[1] === '[aria-label="Reply to #i1"]') await mount
      return {}
    },
    viewport: async () => {},
    visit: async () => {},
  }
}

describe("clickFocus", () => {
  test("waits for the card's Reply before it clicks, so a card that draws late still takes the click (#2373)", async () => {
    expect((await clickFocus(lateCard(), "http://dashboard", "f", "#i1")).ok).toBe(true)
  })
})
