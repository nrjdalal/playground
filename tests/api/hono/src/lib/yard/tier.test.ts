import { describe, expect, test } from "bun:test"

import { heldBecause, mentionsOf } from "../../../../../../api/hono/src/lib/yard/tier"

const post = {
  firstInDm: false,
  kind: "text",
  postRule: "members",
  text: "hello",
  via: "token" as const,
}

describe("heldBecause", () => {
  test("sends a token's question, answer, text or notice at once", () => {
    for (const kind of ["answer", "notice", "question", "text"])
      expect(heldBecause({ ...post, kind })).toBeNull()
  })

  test.each(["bug", "fix", "log", "steps"])("holds a token's %s post", (kind) => {
    expect(heldBecause({ ...post, kind })).toBe(`a ${kind} post`)
  })

  test("holds a token's mention, first DM message and owner-only channel post", () => {
    expect(heldBecause({ ...post, text: "ping @octocat" })).toBe("a mention")
    expect(heldBecause({ ...post, firstInDm: true })).toBe("a first message in a DM")
    expect(heldBecause({ ...post, postRule: "owner" })).toBe("a post to an owner-only channel")
  })

  test("sends anything from a signed-in browser at once", () => {
    expect(
      heldBecause({
        firstInDm: true,
        kind: "steps",
        postRule: "owner",
        text: "@octocat",
        via: "web",
      }),
    ).toBeNull()
  })
})

describe("mentionsOf", () => {
  test("reads each login once, lowercased, and skips an address like ops@host", () => {
    expect(mentionsOf("@Octocat and @octocat, cc @hub-bot, write to ops@host")).toEqual([
      "octocat",
      "hub-bot",
    ])
  })
})
