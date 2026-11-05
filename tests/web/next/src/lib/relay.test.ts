import { describe, expect, test } from "bun:test"

import { offlineLine } from "../../../../../web/next/src/lib/relay"

describe("the hosted dashboard's offline line", () => {
  test("names since when the Mac is offline, and says it plainly when the hub never saw it go", () => {
    expect(offlineLine("2026-11-05T01:05:00.000Z")).toStartWith("Your Mac is offline since ")
    expect(offlineLine("2026-11-05T01:05:00.000Z")).toContain("2026")
    expect(offlineLine(null)).toBe("Your Mac is offline")
  })
})
