import { describe, expect, test } from "bun:test"
import { hostname } from "node:os"

import { FIXTURE_MACHINE, machineName, thisMachine } from "../../../../../web/next/src/lib/machine"

describe("machineName", () => {
  test("drops macOS's .local suffix", () => {
    expect(machineName("Studio-Mac.local")).toBe("Studio-Mac")
    expect(machineName("Studio-Mac.LOCAL")).toBe("Studio-Mac")
    expect(machineName("Studio-Mac")).toBe("Studio-Mac")
  })

  test("an empty host name reads This Mac", () => {
    expect(machineName(".local")).toBe("This Mac")
    expect(machineName("")).toBe("This Mac")
  })
})

const health = (dashboard: string) => ({ data: { dashboard } })

describe("thisMachine", () => {
  test("a fixture stack names its made-up Mac, so no real name reaches a screenshot", () => {
    expect(thisMachine(health("fixture"))).toBe(FIXTURE_MACHINE)
  })

  test("only a stack whose API says it reads this machine names it", () => {
    expect(thisMachine(health("live"))).toBe(machineName(hostname()))
  })

  test("a health read that failed, timed out or was refused names no Mac, since a fixture stack under load lands here too", () => {
    expect(thisMachine(undefined)).toBe("This Mac")
    expect(thisMachine(null)).toBe("This Mac")
    expect(thisMachine(health("refused"))).toBe("This Mac")
  })
})
