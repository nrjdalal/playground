import { describe, expect, test } from "bun:test"

import { pullsUrlOf } from "../../../../../../api/hono/src/lib/dashboard/repo"

describe("pullsUrlOf", () => {
  test("a GitHub origin over https or ssh opens its pull requests, with or without .git", () => {
    const pulls = "https://github.com/acme/widgets/pulls"
    expect(pullsUrlOf("https://github.com/acme/widgets.git")).toBe(pulls)
    expect(pullsUrlOf("https://github.com/acme/widgets")).toBe(pulls)
    expect(pullsUrlOf("https://github.com/acme/widgets/")).toBe(pulls)
    expect(pullsUrlOf("git@github.com:acme/widgets.git")).toBe(pulls)
    expect(pullsUrlOf("git@github.com:acme/widgets")).toBe(pulls)
    expect(pullsUrlOf("ssh://git@github.com/acme/widgets.git")).toBe(pulls)
    expect(pullsUrlOf("  https://github.com/acme/widgets.git\n")).toBe(pulls)
  })

  test("an origin off GitHub, a malformed one or none links nowhere", () => {
    expect(pullsUrlOf("https://gitlab.com/acme/widgets.git")).toBeNull()
    expect(pullsUrlOf("git@bitbucket.org:acme/widgets.git")).toBeNull()
    expect(pullsUrlOf("https://github.com.evil.example/acme/widgets")).toBeNull()
    expect(pullsUrlOf("https://github.com/acme")).toBeNull()
    expect(pullsUrlOf("/srv/git/widgets.git")).toBeNull()
    expect(pullsUrlOf("")).toBeNull()
    expect(pullsUrlOf(null)).toBeNull()
  })
})
