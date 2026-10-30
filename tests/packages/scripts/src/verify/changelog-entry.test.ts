import { describe, expect, test } from "bun:test"

import { drawerResult } from "../../../../../packages/scripts/src/verify/changelog-entry"

const ENTRY = "Long messages wrap inside their bubble."

describe("drawerResult", () => {
  test("passes a drawer open on the linked change whose close drops ?entry=", () => {
    const result = drawerResult("c", { closedSearch: "", openedText: `Change${ENTRY}` }, ENTRY)
    expect(result.ok).toBe(true)
  })

  test("fails a first load with ?entry= that opens no drawer (#265)", () => {
    const result = drawerResult("c", { closedSearch: "?entry=pr-209", openedText: null }, ENTRY)
    expect(result).toEqual({ check: "c", detail: "?entry= opened no drawer", ok: false })
  })

  test("fails a drawer open on another change, as the newest one the page falls back to", () => {
    const result = drawerResult(
      "c",
      { closedSearch: "", openedText: "The sidebar counts the changes you have not read yet." },
      ENTRY,
    )
    expect(result.detail).toBe("the drawer opened on another change")
    expect(result.ok).toBe(false)
  })

  test("fails a close that leaves ?entry= in the URL, beside other parameters", () => {
    const result = drawerResult(
      "c",
      { closedSearch: "?kind=fix&entry=pr-209", openedText: ENTRY },
      ENTRY,
    )
    expect(result.detail).toBe("closing the drawer left ?entry= in the URL")
    expect(result.ok).toBe(false)
  })
})
