import { describe, expect, test } from "bun:test"

import { offlineLine, relayedBase } from "../../../../../web/next/src/lib/relay"

describe("the hosted dashboard's offline line", () => {
  test("names since when the Mac is offline, and says it plainly when the hub never saw it go", () => {
    expect(offlineLine("2026-11-05T01:05:00.000Z")).toStartWith("Your Mac is offline since ")
    expect(offlineLine("2026-11-05T01:05:00.000Z")).toContain("2026")
    expect(offlineLine(null)).toBe("Your Mac is offline")
  })
})

describe("where the web's API calls go", () => {
  test("the hosted build sends the dashboard's reads through the relay, and a local stack straight to its API", () => {
    expect(relayedBase("https://api.example.com", true)).toBe(
      "https://api.example.com/api/v1/yard/relay",
    )
    expect(relayedBase("https://api.example.com", false)).toBe("https://api.example.com")
  })

  // the session read went through the relay too, so the hosted owner read as signed out and got the 404
  test("the session read stays on the API's own base", async () => {
    const source = await Bun.file("web/next/src/lib/auth/index.ts").text()
    expect(source).toContain('ownApiClient.auth["get-session"]')
    expect(source).not.toMatch(/\bapiClient\b/)
  })
})
