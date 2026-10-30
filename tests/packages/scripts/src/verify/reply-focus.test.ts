import { describe, expect, test } from "bun:test"

import { clickFocus, focusResult } from "../../../../../packages/scripts/src/verify/reply-focus"

describe("focusResult", () => {
  test("passes focus in the box the moment Chat about it is clicked", () => {
    expect(focusResult("f", "composer").ok).toBe(true)
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

// A page whose card draws at once and whose box mounts later, as on a loaded host: the click finds the box only once it is there.
const lateBox = () => {
  let mounted = false
  const mount = Bun.sleep(50).then(() => {
    mounted = true
  })
  return {
    eval: async <T>() => (mounted ? "composer" : "body") as T,
    run: async (...args: string[]) => {
      if (args[0] === "wait" && args[1] === "#composer") await mount
      return {}
    },
    viewport: async () => {},
    visit: async () => {},
  }
}

describe("clickFocus", () => {
  test("waits for the box before it clicks, so a box that mounts after the card still takes focus (#2373)", async () => {
    expect((await clickFocus(lateBox(), "http://dashboard", "f", "#i1")).ok).toBe(true)
  })
})
