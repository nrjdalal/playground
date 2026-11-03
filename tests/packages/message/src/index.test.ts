import { describe, expect, test } from "bun:test"

import {
  approvePath,
  githubLoginSchema,
  inviteCodeSchema,
  invitePath,
  MAX_TEXT,
  MESSAGE_KINDS,
  messageSchema,
  tokenNameSchema,
  WEB_DEVICE,
} from "../../../../packages/message/src/index"

const message = {
  at: "2026-10-31T00:00:00Z",
  channel: "general",
  from: { device: "studio", login: "octocat" },
  id: "m1",
  links: ["https://github.com/octocat/hello-world/pull/1"],
  text: "Does the **sign-in** work for you?",
}

describe("messageSchema", () => {
  test.each(MESSAGE_KINDS)("parses a %s message", (kind) => {
    expect(messageSchema.parse({ ...message, kind })).toEqual({ ...message, kind })
  })

  test("parses a message with no links", () => {
    const { links: _, ...bare } = message
    expect(messageSchema.safeParse({ ...bare, kind: "text" }).success).toBe(true)
  })

  test.each(["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd"])(
    "refuses the link %s",
    (link) => {
      expect(messageSchema.safeParse({ ...message, kind: "text", links: [link] }).success).toBe(
        false,
      )
    },
  )

  test("refuses more than 10 links, and a device name past 64 characters", () => {
    const links = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`)
    expect(messageSchema.safeParse({ ...message, kind: "text", links }).success).toBe(false)
    const from = { device: "d".repeat(65), login: "octocat" }
    expect(messageSchema.safeParse({ ...message, from, kind: "text" }).success).toBe(false)
  })

  test(`takes text of ${MAX_TEXT} characters and refuses one past it`, () => {
    expect(
      messageSchema.safeParse({ ...message, kind: "text", text: "a".repeat(MAX_TEXT) }).success,
    ).toBe(true)
    expect(
      messageSchema.safeParse({ ...message, kind: "text", text: "a".repeat(MAX_TEXT + 1) }).success,
    ).toBe(false)
  })

  test("refuses a device shaped like a token", () => {
    const from = { device: "yard_3f9c1a7b", login: "octocat" }
    expect(messageSchema.safeParse({ ...message, from, kind: "text" }).success).toBe(false)
  })

  test("parses a post from a signed-in browser", () => {
    const from = { device: WEB_DEVICE, login: "octocat" }
    expect(messageSchema.safeParse({ ...message, from, kind: "text" }).success).toBe(true)
  })

  test("refuses a kind it does not know", () => {
    expect(messageSchema.safeParse({ ...message, kind: "shout" }).success).toBe(false)
  })
})

describe("tokenNameSchema", () => {
  test("takes a device name", () => {
    expect(tokenNameSchema.safeParse("studio").success).toBe(true)
  })

  test("refuses the browser's name", () => {
    expect(tokenNameSchema.safeParse(WEB_DEVICE).success).toBe(false)
  })
})

describe("the hosted web's approve pages", () => {
  test("a pending message and an invite request each have one path, its id escaped", () => {
    expect(approvePath("m4")).toBe("/yard/approve/m4")
    expect(invitePath("i 1/2")).toBe("/yard/invites/i%201%2F2")
  })
})

describe("the API's and the web's shared input rules", () => {
  test("a GitHub login is letters, digits and inner hyphens, up to 39, trimmed", () => {
    expect(githubLoginSchema.parse(" octo-sample ")).toBe("octo-sample")
    expect(githubLoginSchema.safeParse("a".repeat(39)).success).toBe(true)
    for (const bad of ["", "-octo", "a".repeat(40), "octo cat", "octo/cat"]) {
      expect(githubLoginSchema.safeParse(bad).success).toBe(false)
    }
  })

  test("an invite code is any trimmed text of 1 to 64 characters", () => {
    expect(inviteCodeSchema.parse(" YARD-7Q2M ")).toBe("YARD-7Q2M")
    expect(inviteCodeSchema.safeParse("  ").success).toBe(false)
    expect(inviteCodeSchema.safeParse("x".repeat(65)).success).toBe(false)
  })
})
