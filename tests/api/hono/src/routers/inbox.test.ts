import { describe, expect, test } from "bun:test"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "inbox-router-test-secret-not-for-use-anywhere"
const { inboxRouter } = await import("../../../../../api/hono/src/routers/inbox")
const { env } = await import("../../../../../packages/env/dist/api-hono.mjs")

// Validated, the setting is a list; with validation skipped, as in CI, it is the raw comma-separated string.
const trusted = (): string => {
  const origins: unknown = env.HONO_TRUSTED_ORIGINS
  return Array.isArray(origins) ? String(origins[0]) : String(origins).split(",")[0]!.trim()
}

// Stands in for the Bun server hono/bun reads the peer from; with none, the peer is unknown.
const peer = (address: string) => ({
  requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 50000 }),
})

// The router on its own, at its own root (the API mounts it at /api/v1/inbox).
const answer = (headers: Record<string, string>, server?: ReturnType<typeof peer>) =>
  inboxRouter.request(
    "http://127.0.0.1/0b9c6f1e-1111-4111-8111-000000000001/answer",
    {
      body: JSON.stringify({ action: "approve" }),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    },
    server,
  )

describe("the inbox routes", () => {
  test("the list turns away a request with no session", async () => {
    expect((await inboxRouter.request("http://127.0.0.1/")).status).toBe(401)
  })

  test("an answer from any origin but the dashboard's own is refused before the session is read", async () => {
    expect((await answer({}, peer("127.0.0.1"))).status).toBe(403)
    expect((await answer({ origin: "http://evil.localhost" }, peer("127.0.0.1"))).status).toBe(403)
  })

  test("an answer from another machine is refused, and so is one whose peer cannot be read", async () => {
    const refused = await answer({ origin: trusted() }, peer("192.168.1.20"))
    expect(refused.status).toBe(403)
    expect(await refused.text()).toContain("this machine only")
    expect((await answer({ origin: trusted() })).status).toBe(403)
  })

  test("an answer from the dashboard's own page on this machine still needs a session", async () => {
    expect((await answer({ origin: trusted() }, peer("127.0.0.1"))).status).toBe(401)
    expect((await answer({ origin: trusted() }, peer("::ffff:127.0.0.1"))).status).toBe(401)
    expect((await answer({ origin: trusted() }, peer("::1"))).status).toBe(401)
  })
})

describe("scheduling an item", () => {
  test("is a write, guarded like an answer, and takes the time alone", async () => {
    const schedule = (
      body: string,
      headers: Record<string, string>,
      server?: ReturnType<typeof peer>,
    ) =>
      inboxRouter.request(
        "http://127.0.0.1/0b9c6f1e-1111-4111-8111-000000000001/schedule",
        { body, headers: { "content-type": "application/json", ...headers }, method: "POST" },
        server,
      )
    const at = JSON.stringify({ at: "2026-10-08T09:00:00.000Z" })
    expect(
      (await schedule(at, { origin: "http://evil.localhost" }, peer("127.0.0.1"))).status,
    ).toBe(403)
    expect((await schedule(at, { origin: trusted() }, peer("192.168.1.20"))).status).toBe(403)
    expect((await schedule(at, { origin: trusted() }, peer("127.0.0.1"))).status).toBe(401)
    // validation runs once the write guards pass, so an unauthenticated call stops at 401, not 400
    expect(
      (await schedule(JSON.stringify({ until: at }), { origin: trusted() }, peer("127.0.0.1")))
        .status,
    ).toBe(401)
  })
})

describe("marking updates read", () => {
  test("is a write, guarded like an answer", async () => {
    const read = (headers: Record<string, string>, server?: ReturnType<typeof peer>) =>
      inboxRouter.request(
        "http://127.0.0.1/read",
        { body: "{}", headers: { "content-type": "application/json", ...headers }, method: "POST" },
        server,
      )
    expect((await read({ origin: "http://evil.localhost" }, peer("127.0.0.1"))).status).toBe(403)
    expect((await read({ origin: trusted() }, peer("192.168.1.20"))).status).toBe(403)
    expect((await read({ origin: trusted() }, peer("127.0.0.1"))).status).toBe(401)
  })
})
