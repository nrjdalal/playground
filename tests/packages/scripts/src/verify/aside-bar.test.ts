import { describe, expect, test } from "bun:test"

import {
  clearResult,
  menuResult,
  paneResult,
  reachResult,
  topResult,
} from "../../../../../packages/scripts/src/verify/aside-bar"

const bar = { bottom: 888, left: 1088, right: 1200, top: 846 }

const edge = 846

describe("paneResult", () => {
  test("passes when the pane's last line ends above the aside's bottom edge, where the bar hides", () => {
    const result = paneResult(
      "aside-bar 1440 Inbox",
      edge,
      { contentBottom: 832, scrolled: true, selected: 0 },
      0,
    )
    expect(result.ok).toBe(true)
    expect(result.detail).toBe(
      "its last line ends 14px above the aside's edge, scrolled to its end",
    )
  })

  test("fails when the clipped aside cuts off the pane's last line", () => {
    const result = paneResult(
      "aside-bar 1440 Inbox",
      edge,
      { contentBottom: 880, scrolled: true, selected: 0 },
      0,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toBe(
      "the aside's edge cuts off 34px of its last line, scrolled to its end",
    )
  })

  test("fails when the square clicked is not the one selected, so no pane is checked under another's name", () => {
    const result = paneResult(
      "aside-bar 1440 Pages",
      edge,
      { contentBottom: 600, scrolled: false, selected: 0 },
      1,
    )
    expect(result).toEqual({
      check: "aside-bar 1440 Pages",
      detail: "square 1 is selected after a click on square 2",
      ok: false,
    })
    expect(
      paneResult("x", edge, { contentBottom: 600, scrolled: false, selected: -1 }, 1).detail,
    ).toBe("no square is selected after a click on square 2")
  })

  test("fails when no pane shows", () => {
    expect(paneResult("aside-bar 1440 Inbox", edge, null, 0).ok).toBe(false)
  })
})

describe("topResult", () => {
  test("passes while the bar answers over the pane's highest layer, and fails when a layer covers it (#2115)", () => {
    expect(topResult("aside-bar 1440 Changelog on top", true).ok).toBe(true)
    expect(topResult("aside-bar 1440 Changelog on top", false)).toEqual({
      check: "aside-bar 1440 Changelog on top",
      detail: "the pane's highest layer paints over the bar",
      ok: false,
    })
    expect(topResult("aside-bar 1440 Changelog on top", null).detail).toBe("no pane shows")
  })
})

// the owner: "on mobile menu can join the toolbar"
describe("menuResult", () => {
  test("passes while Menu is a square in the phone's bar, and fails without it", () => {
    expect(menuResult("aside-bar 390 menu", true)).toEqual({
      check: "aside-bar 390 menu",
      detail: "Menu sits in the bar",
      ok: true,
    })
    expect(menuResult("aside-bar 390 menu", false).ok).toBe(false)
  })
})

describe("clearResult", () => {
  test("passes when the bar touches neither box", () => {
    const result = clearResult("aside-bar 390 chat", bar, {
      composer: { bottom: 780, left: 16, right: 374, top: 680 },
      "send button": { bottom: 820, left: 280, right: 360, top: 788 },
    })
    expect(result.ok).toBe(true)
  })

  test("fails on a box it cannot find, rather than calling it cleared", () => {
    expect(clearResult("aside-bar 390 chat", bar, { composer: null, "send button": null })).toEqual(
      {
        check: "aside-bar 390 chat",
        detail: "no composer and send button shows",
        ok: false,
      },
    )
  })

  test("names each box the bar covers", () => {
    const result = clearResult("aside-bar 390 chat", bar, {
      composer: { bottom: 870, left: 1000, right: 1300, top: 800 },
      "send button": { bottom: 860, left: 1150, right: 1250, top: 840 },
    })
    expect(result).toEqual({
      check: "aside-bar 390 chat",
      detail: "the bar covers the composer and send button",
      ok: false,
    })
  })
})

describe("reachResult", () => {
  const measure = {
    bar,
    firstInOrder: true,
    names: ["Inbox", "Pages", "Apps"],
    reachable: true,
  }

  test("passes when every square is named and the bar comes before the panes", () => {
    expect(reachResult("aside-bar 1440 squares", measure).ok).toBe(true)
  })

  test("fails on a square with no name", () => {
    expect(reachResult("x", { ...measure, names: ["Inbox", ""] }).detail).toBe(
      "1 square(s) have no name",
    )
  })

  test("fails when no pane follows the bar, a missing pane included", () => {
    expect(reachResult("x", { ...measure, firstInOrder: false }).ok).toBe(false)
  })

  test("fails when no square takes focus", () => {
    expect(reachResult("x", { ...measure, reachable: false }).ok).toBe(false)
  })

  test("fails when there is no bar", () => {
    expect(reachResult("x", null).ok).toBe(false)
  })
})

// a tester: the bar hides as a dock does, so the on-top probe read a hidden bar and failed every pane
describe("the on-top probe", () => {
  test("calls the hidden bar up as a pointer near the aside's bottom does, waits out its slide, then probes", async () => {
    const source = await Bun.file(
      `${import.meta.dir}/../../../../../packages/scripts/src/verify/aside-bar.ts`,
    ).text()
    expect(source).toContain('new PointerEvent("pointermove", { bubbles: true')
    expect(source).toContain("clientY: box.bottom - 10 }")
    const show = source.indexOf("await browser.eval(SHOW)")
    expect(show).toBeGreaterThan(0)
    expect(source.indexOf("await browser.eval<boolean | null>(ON_TOP)")).toBeGreaterThan(show)
  })
})
