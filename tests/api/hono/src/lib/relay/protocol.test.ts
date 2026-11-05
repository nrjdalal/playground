import { describe, expect, test } from "bun:test"

import {
  cardOf,
  pathOn,
  RELAY_ANSWER_KINDS,
  RELAY_GETS,
  RELAY_WRITES,
  relayAllowed,
} from "../../../../../../api/hono/src/lib/relay/protocol"

describe("the relay's allowlist", () => {
  test("carries the dashboard's reads, a query included", () => {
    for (const target of [
      "/api/health",
      "/api/v1/board",
      "/api/v1/inbox",
      "/api/v1/workers",
      "/api/v1/workers/abc-123/transcript?before=10",
      "/api/v1/sessions/s1/entries?page=2",
      "/api/v1/settings/clock.ownerZone",
    ])
      expect(relayAllowed("GET", target)).toBe(true)
  })

  test("refuses every first-run and onboarding route, the passwordless sign-in among them", () => {
    for (const target of [
      "/api/v1/onboard/sign-in",
      "/api/v1/onboard/finish",
      "/api/v1/onboard/checks",
      "/api/v1/onboard/fix/x",
    ])
      expect(relayAllowed("GET", target)).toBe(false)
    expect(RELAY_GETS.filter((route) => /onboard|setup|sign-in/.test(route))).toEqual([])
  })

  test("refuses every write, on a read's own path too", () => {
    for (const method of ["DELETE", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"])
      expect(relayAllowed(method, "/api/v1/workers")).toBe(false)
  })

  test("refuses a path a server might read as another: a dot segment, an encoded slash or a backslash", () => {
    for (const target of [
      "/api/v1/workers/../onboard/sign-in",
      "/api/v1/workers/./transcript",
      "/api/v1/sessions/a%2F..%2Fonboard",
      "/api/v1/sessions/a%5conboard",
      "/api/v1/sessions/a\\b",
      "api/v1/workers",
      "//api/v1/workers",
    ])
      expect(relayAllowed("GET", target)).toBe(false)
  })

  test("refuses a route it does not list, and a listed one with a segment more", () => {
    expect(relayAllowed("GET", "/api/v1/accounts")).toBe(false)
    expect(relayAllowed("GET", "/api/v1/inbox/extra")).toBe(false)
    expect(relayAllowed("GET", "/api/v1/user")).toBe(false)
  })

  test("lists its routes A to Z", () => {
    expect([...RELAY_GETS]).toEqual([...RELAY_GETS].sort())
  })
})

describe("the relay's write list", () => {
  test("lists only the composer's send, an Inbox card's answer, and the Later, Archive and Done its shelves call, A to Z", () => {
    expect([...RELAY_WRITES]).toEqual([
      "/api/v1/inbox/:id/answer",
      "/api/v1/inbox/:id/schedule",
      "/api/v1/inbox/dismiss",
      "/api/v1/messages",
    ])
  })

  test("keeps every first-run, onboarding, sign-in, delete, secret and settings route on the Mac", () => {
    for (const target of [
      "/api/setup/container",
      "/api/v1/onboard/finish",
      "/api/agents/sign-in-as",
      "/api/v1/inbox/abc/secret",
      "/api/v1/remote/approve",
      "/api/v1/remote/revoke",
      "/api/v1/settings/privacy",
      "/api/v1/apps/previews/abc",
    ])
      expect(pathOn(RELAY_WRITES, target)).toBe(false)
  })

  test("shares no route with the reads, which stay GET-only", () => {
    expect(
      RELAY_WRITES.filter((route) => (RELAY_GETS as readonly string[]).includes(route)),
    ).toEqual([])
    for (const route of RELAY_WRITES) expect(relayAllowed("POST", route)).toBe(false)
  })
})

describe("the Inbox cards a relayed answer may reach", () => {
  test("are exactly the kinds whose poster carries out the answer, A to Z", () => {
    expect([...RELAY_ANSWER_KINDS]).toEqual([
      "ask",
      "budget",
      "draft",
      "schema",
      "ship",
      "slack",
      "ticket",
      "update",
    ])
  })

  test("leave every Approve the Mac carries out itself, a delete and a secret ask on the Mac", () => {
    for (const kind of ["accept", "apps", "delete", "grant", "secret"])
      expect((RELAY_ANSWER_KINDS as readonly string[]).includes(kind)).toBe(false)
  })
})

describe("cardOf, the card a relayed answer names", () => {
  test("reads the id from an answer's path, its query aside", () => {
    expect(cardOf("/api/v1/inbox/0b9c6f1e-1111-4111-8111-000000000001/answer?x=1")).toBe(
      "0b9c6f1e-1111-4111-8111-000000000001",
    )
  })

  test("names no card for any other write or a path that only looks like an answer", () => {
    for (const path of [
      "/api/v1/inbox/abc/schedule",
      "/api/v1/inbox/dismiss",
      "/api/v1/messages",
      "/api/v1/inbox/../answer",
      "/api/v1/inbox/a%2Fb/answer",
      "/api/v1/inbox/abc/answer/more",
    ])
      expect([path, cardOf(path)]).toEqual([path, null])
  })
})
