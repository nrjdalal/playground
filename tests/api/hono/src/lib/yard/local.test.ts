import { describe, expect, test } from "bun:test"

import type { Channel, Message } from "../../../../../../packages/message/src/index"

process.env.BETTER_AUTH_SECRET ||= "yard-local-test-secret-not-for-use-anywhere"
const { localYard } = await import("../../../../../../api/hono/src/lib/yard/local")
const { YardError } = await import("../../../../../../api/hono/src/lib/yard/client")
type YardClient = import("../../../../../../api/hono/src/lib/yard/client").YardClient
type Keychain = import("../../../../../../api/hono/src/lib/yard/keychain").Keychain

const CHANNEL: Channel = {
  id: "c1",
  joined: true,
  kind: "channel",
  lastMessageAt: null,
  mentions: 0,
  name: "ops",
  peer: null,
  postRule: "members",
  topic: null,
  unread: 0,
}
const posted = (status: Message["status"]): Message => ({
  at: "2026-10-31T10:00:00.000Z",
  channel: "c1",
  from: { device: "studio", login: "owner" },
  id: "m1",
  kind: "steps",
  status,
  text: "run it",
})

// A fake hosted Yard and Keychain, so nothing reaches either for real.
const setUp = (
  over: { api?: string; token?: string | null; post?: () => Promise<Message> } = {},
) => {
  const tokens: string[] = []
  const yard = localYard({
    api: "api" in over ? over.api : "https://api.yard.example",
    client: (_, token) => {
      tokens.push(token)
      return {
        channels: async () => [CHANNEL],
        me: async () => ({ login: "owner", owner: true }),
        post: over.post ?? (async () => posted("sent")),
      } as unknown as YardClient
    },
    keychain: {
      read: async () => ("token" in over ? over.token : "yard_mac"),
    } as unknown as Keychain,
  })
  return { tokens, yard }
}

const refusal = (run: Promise<unknown>) =>
  run.then(
    () => null,
    (error: { message: string; status: number }) => [error.status, error.message],
  )

describe("the local Yard routes", () => {
  test("answer 404 with the reason while Yard is not set up or no token is in the Keychain, so the sidebar hides", async () => {
    expect(await refusal(setUp({ api: undefined }).yard.channels())).toEqual([
      404,
      "Yard is not set up on this Playground: set YARD_API_URL",
    ])
    expect(await refusal(setUp({ token: null }).yard.channels())).toEqual([
      404,
      "Yard has no token on this Mac: sign in with playground yard login",
    ])
  })

  test("call the hosted Yard with the Keychain's token", async () => {
    const { tokens, yard } = setUp()
    expect(await yard.channels()).toEqual({ channels: [CHANNEL] })
    expect(tokens).toEqual(["yard_mac"])
  })

  test("a post returns what Yard answered, a held one included, which the poll cards", async () => {
    const held = setUp({ post: async () => posted("pending") })
    expect((await held.yard.post("c1", { kind: "steps", text: "run it" })).message.status).toBe(
      "pending",
    )
  })

  test("Yard's rate limit and size refusals pass on as themselves, never a server fault", async () => {
    for (const status of [409, 413, 429]) {
      const { yard } = setUp({
        post: async () => {
          throw new YardError(status, "said Yard")
        },
      })
      expect(await refusal(yard.post("c1", { kind: "text", text: "hi" }))).toEqual([
        status,
        "said Yard",
      ])
    }
  })

  test("a token Yard no longer takes reads as signed out", async () => {
    const { yard } = setUp({
      post: async () => {
        throw new YardError(401, "Unauthorized")
      },
    })
    expect((await refusal(yard.post("c1", { kind: "text", text: "hi" })))?.[0]).toBe(404)
  })
})
