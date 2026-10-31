import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Channel, Message } from "@packages/message"

process.env.BETTER_AUTH_SECRET ||= "yard-inbound-test-secret-not-for-use-anywhere"
const { inboundCard, pendingCard, pollMentions, untrusted } =
  await import("../../../../../../api/hono/src/lib/yard/inbound")
const { inboxInputSchema } = await import("../../../../../../api/hono/src/lib/dashboard/inbox")
type Card = import("../../../../../../api/hono/src/lib/yard/inbound").Card
type YardClient = import("../../../../../../api/hono/src/lib/yard/client").YardClient

const DIR = mkdtempSync(join(tmpdir(), "yard-inbound-"))
afterAll(() => rmSync(DIR, { force: true, recursive: true }))

const channel = (over: Partial<Channel> = {}): Channel => ({
  id: "c1",
  joined: true,
  kind: "channel",
  lastMessageAt: "2026-10-31T10:00:00.000Z",
  mentions: 1,
  name: "ops",
  peer: null,
  postRule: "members",
  topic: null,
  unread: 1,
  ...over,
})
const message = (over: Partial<Message> = {}): Message => ({
  at: "2026-10-31T10:00:00.000Z",
  channel: "c1",
  from: { device: "studio", login: "bo" },
  id: "m1",
  kind: "question",
  text: "@owner can you look?",
  ...over,
})

describe("a message that calls on the owner becomes one Inbox card", () => {
  test("a mention in a channel or a DM, as untrusted words the Inbox takes", () => {
    for (const kind of ["channel", "dm"] as const) {
      const card = inboundCard(
        message(),
        channel({ kind, peer: { id: "u", image: null, login: "bo", name: "Bo" } }),
        "Owner",
      )
      expect(card?.title).toBe(
        kind === "dm" ? "@bo mentioned you in a DM with @bo" : "@bo mentioned you in #ops",
      )
      expect(inboxInputSchema.safeParse(card).success).toBe(true)
    }
  })

  test("nothing for a message naming someone else, the owner's own post, or one not sent", () => {
    expect(inboundCard(message({ text: "@bo and @di" }), channel(), "owner")).toBeNull()
    expect(
      inboundCard(message({ from: { device: "web", login: "owner" } }), channel(), "owner"),
    ).toBeNull()
    expect(inboundCard(message({ status: "pending" }), channel(), "owner")).toBeNull()
  })

  test("its words and links sit in a fence longer than any inside, so nothing renders or opens", () => {
    const text = untrusted(
      message({ links: ["https://example.com/x"], text: "see ~~~\n[click](https://evil.example)" }),
      channel(),
    )
    expect(text).toContain(
      "~~~~text\nsee ~~~\n[click](https://evil.example)\nhttps://example.com/x\n~~~~",
    )
  })
})

describe("the owner's own pending post", () => {
  test("its card's Approve opens Yard's approve page on the hosted web", () => {
    const card = pendingCard(
      message({ id: "m 9", kind: "steps", status: "pending" }),
      channel(),
      "https://yard.example",
    )
    expect(card.preview.approve).toBe("https://yard.example/yard/approve/m%209")
    expect(card.title).toBe("Your steps post in #ops waits for your approval on Yard")
    expect(inboxInputSchema.safeParse(card).success).toBe(true)
  })
})

describe("the mention poll", () => {
  const client = (channels: Channel[], messages: Message[]) =>
    ({
      channels: async () => channels,
      me: async () => ({ login: "owner", owner: true }),
      messages: async () => ({ hasMore: false, messages }),
    }) as unknown as YardClient

  test("cards nothing on its first run, then each new mention once", async () => {
    const file = join(DIR, "marks.json")
    const cards: Card[] = []
    const post = async (card: Card) => void cards.push(card)
    const old = message({ at: "2026-10-31T09:00:00.000Z" })
    expect(
      await pollMentions(
        client([channel({ lastMessageAt: old.at })], [old]),
        post,
        file,
        new Date("2026-10-31T09:30:00Z"),
      ),
    ).toBe(0)
    const fresh = message({ at: "2026-10-31T10:00:00.000Z", id: "m2" })
    expect(await pollMentions(client([channel()], [old, fresh]), post, file)).toBe(1)
    expect(await pollMentions(client([channel()], [old, fresh]), post, file)).toBe(0)
    expect(cards.map((c) => c.title)).toEqual(["@bo mentioned you in #ops"])
  })
})
