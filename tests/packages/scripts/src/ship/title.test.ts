import { describe, expect, test } from "bun:test"

import { titleRefusal } from "../../../../../packages/scripts/src/ship/title"

// `gh release view <tag> --json name,tagName` as GitHub prints it, read live as {"name":"v0.0.129","tagName":"v0.0.129"}.
const view = (name: string, tagName: string) => JSON.stringify({ name, tagName })

describe("ship:title reads a new version's name against its tag (#2234)", () => {
  test("a version named by its tag passes", () => {
    expect(titleRefusal(view("v0.0.130", "v0.0.130"))).toBeNull()
  })

  test("a version named by its commit's subject fails, with the fix line", () => {
    expect(titleRefusal(view("Merge pull request #2271 from nrjdalal/canary", "v0.0.130"))).toBe(
      'ship:title: v0.0.130 is named "Merge pull request #2271 from nrjdalal/canary", not its tag: run gh release edit v0.0.130 --title v0.0.130',
    )
  })
})
