import { describe, expect, test } from "bun:test"

import { RELAY_GETS, relayAllowed } from "../../../../../../api/hono/src/lib/relay/protocol"

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

describe("the relay and a secret's routes", () => {
  // a secret moves only between the Keychain and the owner's click on this Mac, so neither secret route rides the relay, whatever its method
  test("carries neither the secret ask's Submit nor a reveal card's Show", () => {
    for (const route of ["/api/v1/inbox/i1/secret", "/api/v1/inbox/i1/reveal"])
      for (const method of ["GET", "POST"]) expect(relayAllowed(method, route)).toBe(false)
    expect(RELAY_GETS.filter((path) => /secret|reveal/.test(path))).toEqual([])
  })
})
