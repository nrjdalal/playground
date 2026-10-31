import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Channel, Message } from "../../../../../../packages/message/src/index"

process.env.BETTER_AUTH_SECRET ||= "yard-inbound-test-secret-not-for-use-anywhere"
const { inboundCard, pendingCard, pollWaiting, untrusted } =
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

  test("its sender line, words and links sit in a fence longer than any inside, so nothing renders or opens", () => {
    const text = untrusted(
      message({ links: ["https://example.com/x"], text: "see ~~~\n[click](https://evil.example)" }),
      channel(),
    )
    expect(text).toBe(
      "~~~~text\n@bo (studio) in #ops, as question:\nsee ~~~\n[click](https://evil.example)\nhttps://example.com/x\n~~~~",
    )
  })

  test("a token name holding markdown stays inside the fence", () => {
    const text = untrusted(
      message({ from: { device: "mac\n# Approve me", login: "bo" } }),
      channel(),
    )
    expect(text.startsWith("~~~text\n@bo (mac\n# Approve me)")).toBe(true)
    expect(text.endsWith("\n~~~")).toBe(true)
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

  test("with no YARD_WEB_URL its card still says so, with no Approve", () => {
    const card = pendingCard(message({ status: "pending" }), channel(), undefined)
    expect(card.preview.approve).toBeUndefined()
    expect(inboxInputSchema.safeParse(card).success).toBe(true)
  })
})

describe("the poll", () => {
  // A fake hosted Yard whose /waiting answers what the real one does: every mention after since, a reply included, and the owner's held posts, oldest first by when each showed.
  const client = (channels: Channel[], mentions: Message[], held: Message[] = []) => {
    const asked: string[] = []
    return {
      asked,
      yard: {
        channels: async () => channels,
        me: async () => ({ login: "owner", owner: true }),
        waiting: async (since: string) => (
          asked.push(since),
          [
            ...held.map((message) => ({ held: true, message, shownAt: message.at })),
            ...mentions.map((message) => ({ held: false, message, shownAt: message.at })),
          ]
            .filter((item) => item.shownAt > since)
            .sort((a, b) => a.shownAt.localeCompare(b.shownAt))
        ),
      } as unknown as YardClient,
    }
  }
  const WEB = "https://yard.example"

  test("cards nothing on its first run, then each new mention once, a thread reply included", async () => {
    const file = join(DIR, "marks.json")
    const cards: Card[] = []
    const post = async (card: Card) => void cards.push(card)
    const old = message({ at: "2026-10-31T09:00:00.000Z" })
    const first = client([channel()], [old])
    expect(await pollWaiting(first.yard, post, WEB, file, new Date("2026-10-31T09:30:00Z"))).toBe(0)
    expect(first.asked).toEqual([])
    const reply = message({ at: "2026-10-31T10:00:00.000Z", id: "m2", parent: "m0" })
    const later = client([channel()], [old, reply])
    expect(await pollWaiting(later.yard, post, WEB, file)).toBe(1)
    expect(later.asked).toEqual(["2026-10-31T09:30:00.000Z"])
    expect(await pollWaiting(later.yard, post, WEB, file)).toBe(0)
    expect(cards.map((c) => c.title)).toEqual(["@bo mentioned you in #ops"])
  })

  test("a post Yard holds, from the terminal or the sidebar, gets one card with Approve, in time order with mentions", async () => {
    const file = join(DIR, "marks-held.json")
    await pollWaiting(
      client([channel()], []).yard,
      async () => {},
      WEB,
      file,
      new Date("2026-10-31T09:00:00Z"),
    )
    const held = message({
      at: "2026-10-31T10:00:00.000Z",
      from: { device: "studio", login: "owner" },
      id: "h1",
      kind: "steps",
      status: "pending",
    })
    const mention = message({ at: "2026-10-31T10:01:00.000Z", id: "m3" })
    const cards: Card[] = []
    expect(
      await pollWaiting(
        client([channel()], [mention], [held]).yard,
        async (c) => void cards.push(c),
        WEB,
        file,
      ),
    ).toBe(2)
    expect(cards.map((c) => [c.title, c.preview.approve])).toEqual([
      [
        "Your steps post in #ops waits for your approval on Yard",
        "https://yard.example/yard/approve/h1",
      ],
      ["@bo mentioned you in #ops", undefined],
    ])
  })

  test("a post that fails leaves its message to the next poll, and the ones before it carded once", async () => {
    const file = join(DIR, "marks-retry.json")
    await pollWaiting(
      client([channel()], []).yard,
      async () => {},
      WEB,
      file,
      new Date("2026-10-31T09:00:00Z"),
    )
    const a = message({ at: "2026-10-31T10:00:00.000Z", id: "a" })
    const b = message({ at: "2026-10-31T10:01:00.000Z", id: "b" })
    const yard = client([channel()], [a, b]).yard
    const posted: string[] = []
    let down = true
    const post = async (card: Card) => {
      if (down && posted.length === 1) throw new Error("down")
      posted.push(card.preview.text)
    }
    await expect(pollWaiting(yard, post, WEB, file)).rejects.toThrow("down")
    down = false
    expect(await pollWaiting(yard, post, WEB, file)).toBe(1)
    expect(posted).toHaveLength(2)
    expect(posted[1]).toBe(untrusted(b, channel()))
  })
})
