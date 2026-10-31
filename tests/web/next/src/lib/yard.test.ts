import { describe, expect, test } from "bun:test"

import {
  approveHref,
  canPost,
  channelHref,
  channelTitle,
  SOCKET_ROUTE,
  socketUrl,
  type YardChannel,
  yardBadge,
  yardGate,
  yardGroups,
} from "../../../../../web/next/src/lib/yard"

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

describe("socketUrl", () => {
  test("turns the API's https into wss and carries the token in the query", () => {
    expect(socketUrl("https://api.example.test", SOCKET_ROUTE, "a b/c")).toBe(
      "wss://api.example.test/api/v1/yard/socket?token=a%20b%2Fc",
    )
  })

  test("turns a local http API into ws", () => {
    expect(socketUrl("http://127.0.0.1:4000", SOCKET_ROUTE, "t")).toBe(
      "ws://127.0.0.1:4000/api/v1/yard/socket?token=t",
    )
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

describe("canPost", () => {
  test("an owner-only channel takes the owner's posts alone", () => {
    const releases = channel({ name: "releases", postRule: "owner" })
    expect(canPost(releases, "member")).toBe(false)
    expect(canPost(releases, "owner")).toBe(true)
    expect(canPost(channel(), "member")).toBe(true)
  })
})
