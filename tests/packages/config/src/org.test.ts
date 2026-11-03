import { describe, expect, test } from "bun:test"

import { orgOf } from "../../../../packages/config/src/org"

describe("orgOf", () => {
  test("with nothing set, every value is a generic default, and no integration is read", () => {
    expect(orgOf({})).toEqual({
      owner: { name: "Owner" },
      work: { label: "Work", org: undefined },
    })
  })

  test("a full config reads every key", () => {
    expect(
      orgOf({
        PLAYGROUND_OWNER_NAME: "Merritt",
        WORK_GITHUB_ORG: "example",
        WORK_LABEL: "Day job",
      }),
    ).toEqual({
      owner: { name: "Merritt" },
      work: { label: "Day job", org: "example" },
    })
  })

  test("an empty value reads as unset", () => {
    expect(
      orgOf({
        PLAYGROUND_OWNER_NAME: "",
        WORK_GITHUB_ORG: "",
      }),
    ).toMatchObject({
      owner: { name: "Owner" },
      work: { org: undefined },
    })
  })

  test("a work org that is not a GitHub login is refused, so it adds nothing to the search", () => {
    expect(() => orgOf({ WORK_GITHUB_ORG: "example is:closed" })).toThrow()
  })
})
