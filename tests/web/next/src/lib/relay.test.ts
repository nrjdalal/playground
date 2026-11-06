import { describe, expect, test } from "bun:test"

import {
  confirmedStatus,
  gateView,
  offlineLine,
  relayedBase,
  whenVisible,
} from "../../../../../web/next/src/lib/relay"

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

describe("the hosted dashboard's offline gate", () => {
  const ONLINE = { online: true, since: null }
  const OFFLINE = { online: false, since: null }

  // one offline answer from an instance still connecting to Redis put the whole page on "Your Mac is offline"
  test("an offline answer or a failed read is read once more before it counts", async () => {
    const answers = [OFFLINE, ONLINE]
    let reads = 0
    expect(await confirmedStatus(async () => answers[reads++]!, 0)).toEqual(ONLINE)
    expect(reads).toBe(2)
    let tries = 0
    const flaky = async () => {
      if (tries++ === 0) throw new Error("503")
      return ONLINE
    }
    expect(await confirmedStatus(flaky, 0)).toEqual(ONLINE)
    expect(await confirmedStatus(async () => OFFLINE, 0)).toEqual(OFFLINE)
    let once = 0
    await confirmedStatus(async () => (once++, ONLINE), 0)
    expect(once).toBe(1)
  })

  // a tab back from hidden showed the offline line its throttled reads had left, until a reload
  test("an offline answer read before the tab came back shows nothing until a fresh read lands", () => {
    expect(gateView({ data: OFFLINE, error: null, readAt: 100, visibleAt: 200 })).toBe("wait")
    expect(gateView({ data: OFFLINE, error: null, readAt: 300, visibleAt: 200 })).toEqual({
      line: "Your Mac is offline",
    })
    expect(gateView({ data: ONLINE, error: null, readAt: 100, visibleAt: 200 })).toBe("dashboard")
    expect(gateView({ data: undefined, error: null, readAt: 0, visibleAt: 0 })).toBe("wait")
    expect(gateView({ data: undefined, error: new Error("x"), readAt: 5, visibleAt: 0 })).toEqual({
      line: "Your Mac cannot be reached",
    })
  })

  test("a tab that becomes visible calls back at once, and a hidden one does not", () => {
    const listeners: (() => void)[] = []
    const doc = {
      addEventListener: (_: string, listener: () => void) => void listeners.push(listener),
      removeEventListener: () => void listeners.pop(),
      visibilityState: "hidden" as DocumentVisibilityState,
    }
    const seen: number[] = []
    const stop = whenVisible(doc as never, (at) => void seen.push(at))
    listeners[0]!()
    expect(seen).toEqual([])
    doc.visibilityState = "visible"
    listeners[0]!()
    expect(seen.length).toBe(1)
    stop()
    expect(listeners).toEqual([])
  })

  test("the gate reads the status again when the tab comes back, through the confirmed read alone", async () => {
    const source = await Bun.file("web/next/src/components/dashboard/relay-gate.tsx").text()
    expect(source).toContain("whenVisible(document")
    expect(source).toContain("confirmedStatus(readRelayStatus)")
    expect(source).toContain("refetchOnWindowFocus: false")
  })
})
