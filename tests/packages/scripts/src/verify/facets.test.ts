import { describe, expect, test } from "bun:test"

import { facetResult } from "../../../../../packages/scripts/src/verify/facets"

describe("facetResult", () => {
  test("passes when every facet's counts end at one x", () => {
    const result = facetResult("f", [
      { facet: "Status", rights: [180, 180, 180.4] },
      { facet: "Project", rights: [180, 180] },
    ])
    expect(result.ok).toBe(true)
  })

  test("fails a facet whose counts end at different x, naming it and the spread", () => {
    const result = facetResult("f", [
      { facet: "Status", rights: [180, 180] },
      { facet: "Project", rights: [164, 171, 180] },
    ])
    expect(result).toEqual({
      check: "f",
      detail: "Project's counts end 16px apart",
      ok: false,
    })
  })

  test("fails when no facet was found, so an empty page never passes", () => {
    expect(facetResult("f", []).ok).toBe(false)
  })

  test("fails when no facet shows two counts, since nothing was compared", () => {
    expect(facetResult("f", [{ facet: "Status", rights: [180] }]).ok).toBe(false)
  })
})
