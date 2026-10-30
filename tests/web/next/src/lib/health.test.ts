import { describe, expect, test } from "bun:test"

import { dispatcherSlotsOf } from "../../../../../web/next/src/lib/health"

// verify cls: a stored sidebar's header draws as many dispatcher rows as the API says it will draw
describe("dispatcherSlotsOf", () => {
  test("the dispatcher rows /api/health names, a whole count of 1 or more", () => {
    expect(dispatcherSlotsOf({ data: { dispatcherSlots: 2 } })).toBe(2)
    expect(dispatcherSlotsOf({ data: { dispatcherSlots: 1 } })).toBe(1)
  })

  test("a failed read, or a count that is not a whole number of 1 or more, is the primary's row alone", () => {
    for (const health of [
      undefined,
      null,
      {},
      { data: {} },
      { data: { dispatcherSlots: 0 } },
      { data: { dispatcherSlots: 1.5 } },
      { data: { dispatcherSlots: "2" } },
    ])
      expect(dispatcherSlotsOf(health)).toBe(1)
  })
})
