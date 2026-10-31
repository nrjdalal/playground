import { describe, expect, test } from "bun:test"

import {
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
