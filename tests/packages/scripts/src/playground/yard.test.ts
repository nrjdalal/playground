import { describe, expect, test } from "bun:test"

import type { Channel, Message } from "../../../../../packages/message/src/index"
import { runYard, type YardIo } from "../../../../../packages/scripts/src/playground/yard"

type YardClient = import("../../../../../api/hono/src/lib/yard/client").YardClient
const { YardError } = await import("../../../../../api/hono/src/lib/yard/client")

const OPS: Channel = {
  id: "c1",
  joined: true,
  kind: "channel",
  lastMessageAt: null,
  mentions: 1,
  name: "ops",
  peer: null,
  postRule: "members",
  topic: null,
  unread: 2,
}
const DM: Channel = {
  ...OPS,
  id: "dm1",
  kind: "dm",
  name: "dm:a:b",
  peer: { id: "b", image: null, login: "Bo", name: "Bo" },
}
const MESSAGE: Message = {
  at: "2026-10-31T10:00:00.000Z",
  channel: "c1",
  from: { device: "studio", login: "bo" },
  id: "m1",
  kind: "question",
  text: "anyone up?",
}

// A fake hosted Yard, Keychain and terminal, so nothing reaches any of them for real.
const setUp = (
  over: Partial<YardIo> & {
    token?: string | null
    status?: Message["status"]
    me?: () => Promise<unknown>
  } = {},
) => {
  const lines: string[] = []
  const calls: unknown[][] = []
  const stored: string[] = []
  const io: YardIo = {
    api: "https://api.yard.example",
    client: (base, token) => {
      calls.push(["client", base, token])
      return {
        channels: async () => [OPS, DM],
        me: over.me ?? (async () => ({ login: "owner", owner: true })),
        messages: async (id: string) => (
          calls.push(["messages", id]),
          { hasMore: false, messages: [MESSAGE] }
        ),
        post: async (id: string, post: unknown) => (
          calls.push(["post", id, post]),
          { ...MESSAGE, id: "m9", status: over.status ?? "sent" }
        ),
        read: async (id: string) => (calls.push(["read", id]), { lastReadAt: MESSAGE.at }),
      } as unknown as YardClient
    },
    err: (line) => lines.push(`err: ${line}`),
    keychain: {
      read: async () => ("token" in over ? over.token : "yard_mac"),
      remove: async () => void stored.push("removed"),
      write: async (token: string) => void stored.push(token),
    } as YardIo["keychain"],
    out: (line) => lines.push(line),
    readSecret: async () => "yard_pasted\n",
    web: "https://yard.example",
    ...over,
  }
  return { calls, io, lines, stored }
}

describe("playground yard", () => {
  test("login checks the pasted token with Yard before the Keychain keeps it", async () => {
    const ok = setUp()
    expect(await runYard(["login"], ok.io)).toBe(0)
    expect(ok.stored).toEqual(["yard_pasted"])
    expect(ok.lines).toEqual(["Signed in to Yard as @owner; the token is in the Keychain"])
    const refused = setUp({
      me: async () => {
        throw new YardError(401, "Unauthorized")
      },
    })
    expect(await runYard(["login"], refused.io)).toBe(1)
    expect(refused.stored).toEqual([])
  })

  test("channels lists channels and DMs with their counts", async () => {
    const { io, lines } = setUp()
    expect(await runYard(["channels"], io)).toBe(0)
    expect(lines).toEqual(["#ops\t2 unread\t1 mentions\tc1", "@Bo\t2 unread\t1 mentions\tdm1"])
  })

  test("read finds a channel by #name or a DM by @login, prints its messages and marks it read", async () => {
    const { calls, io, lines } = setUp()
    expect(await runYard(["read", "#ops"], io)).toBe(0)
    expect(lines).toEqual(["2026-10-31T10:00:00.000Z @bo (studio) [question]: anyone up?"])
    expect(calls.slice(1)).toEqual([
      ["messages", "c1"],
      ["read", "c1"],
    ])
    expect(await runYard(["read", "@bo"], io)).toBe(0)
    expect(calls.at(-1)).toEqual(["read", "dm1"])
  })

  test("post sends as its --kind, and names Yard's approve page when Yard holds it", async () => {
    const sent = setUp()
    expect(await runYard(["post", "ops", "hello there"], sent.io)).toBe(0)
    expect(sent.calls.at(-1)).toEqual(["post", "c1", { kind: "text", text: "hello there" }])
    expect(sent.lines).toEqual(["Posted to #ops"])
    const held = setUp({ status: "pending" })
    expect(await runYard(["post", "ops", "run it", "--kind", "steps"], held.io)).toBe(0)
    expect(held.calls.at(-1)).toEqual(["post", "c1", { kind: "steps", text: "run it" }])
    expect(held.lines).toEqual(["Held for your approval: https://yard.example/yard/approve/m9"])
    expect(await runYard(["post", "ops", "x", "--kind", "shout"], held.io)).toBe(2)
  })

  test("says what is missing: no Yard set up, no token, no such channel", async () => {
    const off = setUp({ api: undefined })
    expect(await runYard(["channels"], off.io)).toBe(1)
    expect(off.lines[0]).toContain("Yard is not set up here")
    const out = setUp({ token: null })
    expect(await runYard(["channels"], out.io)).toBe(1)
    expect(out.lines).toEqual(["err: No Yard token on this Mac: run playground yard login"])
    const lost = setUp()
    expect(await runYard(["read", "#nope"], lost.io)).toBe(1)
  })
})
