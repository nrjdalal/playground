import { describe, expect, test } from "bun:test"

import {
  MENU_ROWS,
  menuResult,
  type MenuMeasure,
} from "../../../../../packages/scripts/src/verify/slash-menu"

const ROW = 32
const names = Array.from({ length: 12 }, (_, i) => `skill-${i}`)
// a list showing six and a half rows, scrolled so the row at `at` sits `offset` px below the list's top
const measure = (at: number, offset = 0, overrides: Partial<NonNullable<MenuMeasure>> = {}) => ({
  bottom: 100 + offset + ROW,
  boxLeft: 0,
  boxRight: 600,
  left: 400,
  listBottom: 100 + 6.5 * ROW,
  listTop: 100,
  names,
  right: 560,
  rowHeights: names.map(() => ROW),
  selected: names[at] ?? null,
  top: 100 + offset,
  ...overrides,
})

describe("menuResult", () => {
  test("passes a compact menu whose selected row is whole inside it", () => {
    expect(menuResult("m", measure(11, 5 * ROW), "skill-11").ok).toBe(true)
  })

  test("fails a selected row the list cuts off at either edge, shown only partly in the view", () => {
    const below = menuResult("m", measure(11, 6 * ROW), "skill-11")
    expect(below.ok).toBe(false)
    expect(below.detail).toContain("16px of /skill-11 is cut off")
    expect(menuResult("m", measure(0, -6), "skill-0").ok).toBe(false)
  })

  test("fails a menu that runs past the composer's edge, since it stays over the place being typed in", () => {
    const past = menuResult("m", measure(0, 0, { left: 480, right: 640 }), "skill-0")
    expect(past.ok).toBe(false)
    expect(past.detail).toContain("40px past the composer's right edge")
    expect(menuResult("m", measure(0, 0, { left: -3 }), "skill-0").detail).toContain("3px past")
  })

  test(`fails a menu taller than ${MENU_ROWS} rows, since a taller one crowds the chat`, () => {
    const tall = menuResult("m", measure(0, 0, { listBottom: 100 + 9 * ROW }), "skill-0")
    expect(tall.ok).toBe(false)
    expect(tall.detail).toContain("288px tall")
  })

  test("fails rows of different heights, an arrow that lands elsewhere, a menu that does not scroll, and no menu", () => {
    const heights = names.map((_, i) => (i === 3 ? 2 * ROW : ROW))
    expect(menuResult("m", measure(0, 0, { rowHeights: heights }), "skill-0").ok).toBe(false)
    expect(menuResult("m", measure(1), "skill-11").detail).toContain(
      "/skill-1 is selected, not /skill-11",
    )
    const few = names.slice(0, 3)
    expect(
      menuResult("m", measure(0, 0, { names: few, rowHeights: few.map(() => ROW) }), "skill-0")
        .detail,
    ).toContain("does not scroll")
    expect(menuResult("m", null, "skill-0").detail).toBe("typing / opened no menu")
  })
})
