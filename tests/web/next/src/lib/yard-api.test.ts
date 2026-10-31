import { afterEach, describe, expect, test } from "bun:test"

import { config } from "../../../../../web/next/src/lib/config"
import { channelsEvery, yardApi } from "../../../../../web/next/src/lib/yard-api"

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
})

// Each call the page makes, by its URL and init, answering the invite the API would.
const calls: { init: RequestInit | undefined; url: string }[] = []
const answer = (status: string) => {
  calls.length = 0
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ init, url })
    return Response.json({ data: { invite: { code: "c0de", id: "i1", status } } })
  }) as typeof fetch
}

describe("an invite request's page", () => {
  test("approves it through the owner's web session, and gets the code back", async () => {
    answer("open")
    const { invite } = await yardApi.approveInvite("i1")
    expect(invite.code).toBe("c0de")
    expect(calls).toEqual([
      {
        init: expect.objectContaining({ credentials: "include", method: "POST" }),
        url: `${config.api.url}/api/v1/yard/invites/i1/approve`,
      },
    ])
  })

  test("denies it the same way", async () => {
    answer("revoked")
    const { invite } = await yardApi.denyInvite("i1")
    expect(invite.status).toBe("revoked")
    expect(calls).toEqual([
      {
        init: expect.objectContaining({ credentials: "include", method: "POST" }),
        url: `${config.api.url}/api/v1/yard/invites/i1/deny`,
      },
    ])
  })
})

describe("the sidebar's channel reads", () => {
  test("read again every 30s on a local stack while Yard answers, and stop on a refusal or hosted", () => {
    expect(channelsEvery(false, false)).toBe(30_000)
    expect(channelsEvery(false, true)).toBe(false)
    expect(channelsEvery(true, false)).toBe(false)
  })
})
