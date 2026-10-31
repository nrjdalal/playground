import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  approveHref,
  canPost,
  catchUp,
  channelHref,
  channelTitle,
  inviteRequests,
  landingChannel,
  messagesQuery,
  retryDelay,
  socketUrl,
  upsertMessage,
  type YardChannel,
  type YardMessage,
  yardBadge,
  yardGate,
  yardGroups,
} from "../../../../../web/next/src/lib/yard"

const web = join(import.meta.dir, "../../../../../web/next")
const { QueryClient } = (await import(Bun.resolveSync("@tanstack/react-query", web))) as {
  QueryClient: new () => Parameters<typeof catchUp>[0] & {
    getQueryState: (key: readonly unknown[]) => { isInvalidated: boolean } | undefined
    setQueryData: (key: readonly unknown[], data: unknown) => void
  }
}

const channel = (over: Partial<YardChannel> = {}): YardChannel => ({
  id: "c1",
  joined: true,
  kind: "channel",
  lastMessageAt: null,
  mentions: 0,
  name: "general",
  peer: null,
  postRule: "members",
  topic: null,
  unread: 0,
  ...over,
})

const dm = channel({
  id: "d1",
  kind: "dm",
  name: "dm:u1:u2",
  peer: { id: "u2", image: null, login: "octocat", name: "Octo Cat" },
})

const message = (over: Partial<YardMessage> = {}): YardMessage => ({
  at: "2026-10-31T09:00:00Z",
  channel: "c1",
  from: { device: "macbook", login: "octo-sample" },
  id: "m1",
  kind: "text",
  text: "hello",
  ...over,
})

describe("socketUrl", () => {
  test("opens on the API's own host, even where the browser's calls go through the web's /api rewrite, which forwards no upgrade", () => {
    const env = {
      NEXT_PUBLIC_API_URL: "https://api.example.test",
      NEXT_PUBLIC_APP_URL: "https://web.example.test",
      NEXT_PUBLIC_IS_PRIVATE: "true",
    }
    expect(socketUrl(env, "a b/c")).toBe(
      "wss://api.example.test/api/v1/yard/socket?token=a%20b%2Fc",
    )
  })

  test("turns a local http API into ws", () => {
    expect(socketUrl({ NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000" }, "t")).toBe(
      "ws://127.0.0.1:4000/api/v1/yard/socket?token=t",
    )
  })
})

describe("retryDelay", () => {
  test("waits 2s, doubling with each failed try, to a minute at most", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000,
    ])
  })
})

describe("upsertMessage", () => {
  test("keeps a message that arrives twice once, in time order, so a post approved later stays where it was made", () => {
    const early = message({ at: "2026-10-31T09:00:00Z", id: "m1", text: "first" })
    const late = message({ at: "2026-10-31T10:00:00Z", id: "m2" })
    const approved = { ...early, text: "again" }
    expect(upsertMessage([early, late], approved).map((row) => [row.id, row.text])).toEqual([
      ["m1", "again"],
      ["m2", late.text],
    ])
    expect(upsertMessage([early], late).map((row) => row.id)).toEqual(["m1", "m2"])
  })
})

describe("the sidebar's rows", () => {
  test("split into the joined Channels and every Direct message, each in the API's order", () => {
    const random = channel({ id: "c2", name: "random" })
    const unjoined = channel({ id: "c3", joined: false, name: "builds" })
    expect(yardGroups([channel(), dm, unjoined, random])).toEqual({
      channels: [channel(), random],
      dms: [dm],
    })
  })

  test("a channel reads #name and a DM its other member's login", () => {
    expect(channelTitle(channel())).toBe("#general")
    expect(channelTitle(dm)).toBe("octocat")
  })

  test("a row opens under /yard on the hosted app and in the dashboard's chat pane locally", () => {
    expect(channelHref(dm, true)).toBe("/yard/c/d1")
    expect(channelHref(dm, false)).toBe("/dashboard/yard/d1")
  })

  test("a channel's id is escaped in its link, as the approve and invite paths escape theirs", () => {
    expect(channelHref({ id: "../tokens" }, true)).toBe("/yard/c/..%2Ftokens")
    expect(channelHref({ id: "../tokens" }, false)).toBe("/dashboard/yard/..%2Ftokens")
  })

  test("a pending post links to its approve page on the hosted app alone, since a local stack serves no /yard page", () => {
    expect(approveHref({ id: "m4" }, true)).toBe("/yard/approve/m4")
    expect(approveHref({ id: "m4" }, false)).toBeNull()
  })

  test("the badge is absent once read, the count past 99 reads 99+, and a mention marks it", () => {
    expect(yardBadge(channel())).toBeNull()
    expect(yardBadge(channel({ unread: 3 }))).toEqual({ label: "3", mention: false })
    expect(yardBadge(channel({ unread: 142 }))).toEqual({ label: "99+", mention: false })
    expect(yardBadge(channel({ mentions: 1, unread: 2 }))).toEqual({ label: "2", mention: true })
  })
})

describe("who reaches the hosted app", () => {
  test("a signed-out visitor goes to sign-in", () => {
    expect(yardGate(null)).toBe("sign-in")
    expect(yardGate(undefined)).toBe("sign-in")
  })

  test("a user without an invite goes to the invite page", () => {
    expect(yardGate({ role: "user" })).toBe("invite")
    expect(yardGate({ role: null })).toBe("invite")
  })

  test("a member, an admin and the owner reach the app", () => {
    for (const role of ["member", "admin", "owner"]) expect(yardGate({ role })).toBe("app")
  })
})

describe("landingChannel", () => {
  test("lands on the first joined channel, past one you have not joined, else the first DM, else nowhere", () => {
    const open = channel({ id: "c0", joined: false, name: "lobby" })
    const general = channel({ id: "c1" })
    const dm = channel({ id: "d1", kind: "dm", name: "dm:u1:u2" })
    expect(landingChannel([open, general, dm])?.id).toBe("c1")
    expect(landingChannel([open, dm])?.id).toBe("d1")
    expect(landingChannel([open])).toBeNull()
  })
})

describe("canPost", () => {
  test("an owner-only channel takes the owner's posts alone", () => {
    const releases = channel({ name: "releases", postRule: "owner" })
    expect(canPost(releases, "member")).toBe(false)
    expect(canPost(releases, "owner")).toBe(true)
    expect(canPost(channel(), "member")).toBe(true)
  })
})

describe("catchUp", () => {
  test("marks every Yard read stale, so a reopened socket's missed messages are read again", async () => {
    const client = new QueryClient()
    client.setQueryData(["yard", "channels"], [])
    client.setQueryData(["yard", "messages", "c1"], [])
    client.setQueryData(["session"], {})
    await catchUp(client)
    expect(client.getQueryState(["yard", "channels"])?.isInvalidated).toBe(true)
    expect(client.getQueryState(["yard", "messages", "c1"])?.isInvalidated).toBe(true)
    expect(client.getQueryState(["session"])?.isInvalidated).toBe(false)
  })
})

describe("the open channel's messages", () => {
  // React Query schedules no interval where there is no window (its isServer), so a fake-timer run here would need a global window, which a test beside others may not set; this holds the options it reads, and React Query's own tests hold the timing.
  test("are read again every 30 seconds while the tab shows, so a message the socket missed shows within that", () => {
    const query = messagesQuery("c1", async () => [])
    expect(query.queryKey).toEqual(["yard", "messages", "c1"])
    expect(query.refetchInterval).toBe(30_000)
    expect("refetchIntervalInBackground" in query).toBe(false)
  })
})

describe("inviteRequests", () => {
  test("keeps the requests that wait on the owner, in the API's order", () => {
    const invite = (id: string, status: "open" | "redeemed" | "requested" | "revoked") => ({
      createdAt: "2026-10-31T00:00:00Z",
      expiresAt: null,
      forLogin: "octo-sample",
      id,
      requestedBy: { login: "lark-sample" },
      status,
    })
    const list = [invite("a", "requested"), invite("b", "open"), invite("c", "requested")]
    expect(inviteRequests(list).map((row) => row.id)).toEqual(["a", "c"])
  })
})
