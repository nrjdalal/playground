import { describe, expect, test } from "bun:test"

import { type RowBoxes, rowsFitResult } from "../../../../../packages/scripts/src/verify/row-fit"

describe("rowsFitResult", () => {
  const box = (
    cut = 0,
    top = 0,
    bottom = 32,
    name = "OpsDashboard",
    over = 0,
    chevron: number | null = null,
    labelCut = false,
  ): RowBoxes[number] => ({ bottom, chevron, cut, height: bottom - top, labelCut, name, over, top })

  test("passes when every row fits its box and none covers another", () => {
    expect(rowsFitResult("rows", [[box(), box(0, 32, 64, "OpsIngest")]])).toEqual({
      check: "rows",
      detail: "2 rows drawn, each menu row 32px, none cut, none past its edge, none overlapping",
      ok: true,
    })
  })

  test("passes when a row reads a pixel tall, since whole-pixel heights round", () => {
    expect(rowsFitResult("rows", [[box(1)]]).ok).toBe(true)
  })

  test("fails when a row's content is taller than its box, naming it", () => {
    expect(rowsFitResult("rows", [[box(24)]])).toEqual({
      check: "rows",
      detail: '"OpsDashboard" draws 24.0px more than its box holds, so its words are cut',
      ok: false,
    })
  })

  test("fails when a row's words run past its padded edge, naming it", () => {
    expect(rowsFitResult("rows", [[box(0, 0, 32, "OpsReport (at 11rem)", 108)]])).toEqual({
      check: "rows",
      detail: '"OpsReport (at 11rem)" runs its words 108.0px past its padded edge, so they are cut',
      ok: false,
    })
  })

  test("fails when a row cuts its label at the stock width, naming it", () => {
    expect(
      rowsFitResult("rows", [[box(0, 0, 32, "PG-843#843-work… Chat scroll fix", 0, null, true)]]),
    ).toEqual({
      check: "rows",
      detail:
        '"PG-843#843-work… Chat scroll fix" cuts its label at the stock width, so the title did not give way first',
      ok: false,
    })
  })

  test("passes when a part reaches its padded edge within a pixel, since edges round", () => {
    expect(rowsFitResult("rows", [[box(0, 0, 32, "OpsReport", 1)]]).ok).toBe(true)
  })

  test("fails when one row covers the next, naming both", () => {
    expect(rowsFitResult("rows", [[box(0, 0, 32), box(0, 20, 52, "OpsIngest")]])).toEqual({
      check: "rows",
      detail: '"OpsDashboard" and "OpsIngest" overlap by 12.0px',
      ok: false,
    })
  })

  test("passes over rows of different lists, which never cover each other", () => {
    expect(rowsFitResult("rows", [[box(0, 0, 32)], [box(0, 16, 48, "OpsIngest")]]).ok).toBe(true)
  })

  // a sidebar row keeps the stock height, never a taller one
  test("fails when a menu row is not the stock 32px, naming its height", () => {
    expect(rowsFitResult("rows", [[box(0, 0, 42)]])).toEqual({
      check: "rows",
      detail: '"OpsDashboard" is 42.0px tall, not the stock 32px',
      ok: false,
    })
    expect(rowsFitResult("rows", [[box(0, 0, 32.4)]]).ok).toBe(true)
  })

  // the chevron sits in the row's middle
  test("fails when a row's chevron sits off its middle, and passes within half a pixel", () => {
    expect(rowsFitResult("rows", [[box(0, 0, 32, "OpsDashboard", 0, 5)]])).toEqual({
      check: "rows",
      detail: '"OpsDashboard" draws its chevron 5.0px off its middle',
      ok: false,
    })
    expect(rowsFitResult("rows", [[box(0, 0, 32, "OpsDashboard", 0, -0.4)]]).ok).toBe(true)
  })

  test("fails when no row was drawn", () => {
    expect(rowsFitResult("rows", [])).toEqual({
      check: "rows",
      detail: "no sidebar row was drawn",
      ok: false,
    })
  })

  test("names every fault, cuts and overlaps together", () => {
    const result = rowsFitResult("rows", [
      [box(24), box(0, 32, 64, "OpsIngest"), box(0, 56, 88, "OpsSweep")],
    ])
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('"OpsDashboard" draws 24.0px more')
    expect(result.detail).toContain('"OpsIngest" and "OpsSweep" overlap by 8.0px')
  })
})
