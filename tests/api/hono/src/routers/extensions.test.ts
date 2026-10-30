import { describe, expect, test } from "bun:test"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "extensions-router-test-secret-not-for-use-anywhere"
const { extensionsRouter } = await import("../../../../../api/hono/src/routers/extensions")
const { Hono } = await import("../../../../../api/hono/node_modules/hono")
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

const app = new Hono().route("/api/v1/extensions", extensionsRouter)

const URL = "http://127.0.0.1/api/v1/extensions"
const json = (method: string, body: unknown) => ({
  body: JSON.stringify(body),
  headers: { "content-type": "application/json" },
  method,
})

const WRITES: [string, RequestInit][] = [
  [URL, json("POST", { name: "acme", yes: true })],
  [`${URL}/order`, json("PUT", { names: ["acme"] })],
  [`${URL}/acme/links`, json("POST", { org: "acme" })],
  [`${URL}/acme/links/acme`, { method: "DELETE" }],
  [`${URL}/acme/sync`, { method: "POST" }],
  [`${URL}/acme`, { method: "DELETE" }],
  [`${URL}/init`, { method: "POST" }],
]

const send = (
  [url, init]: [string, RequestInit],
  headers: Record<string, string>,
  server?: ReturnType<typeof peer>,
) =>
  app.request(
    url,
    { ...init, headers: { ...(init.headers as Record<string, string>), ...headers } },
    server,
  )

describe("the extensions routes", () => {
  test("the list, Why, Add's check and Set up settings' check turn away a request with no session", async () => {
    expect((await app.request(URL)).status).toBe(401)
    expect((await app.request(`${URL}/why?skill=end-of-day`)).status).toBe(401)
    expect((await app.request(`${URL}/check?name=acme`)).status).toBe(401)
    expect((await app.request(`${URL}/init/check`)).status).toBe(401)
  })

  test("a write from another origin or off this machine is refused before the session is read", async () => {
    for (const write of WRITES) {
      expect((await send(write, {}, peer("127.0.0.1"))).status).toBe(403)
      expect(
        (await send(write, { origin: "http://evil.localhost" }, peer("127.0.0.1"))).status,
      ).toBe(403)
      expect((await send(write, { origin: trusted() }, peer("192.168.1.20"))).status).toBe(403)
      expect((await send(write, { origin: trusted() })).status).toBe(403)
      expect((await send(write, { origin: trusted() }, peer("127.0.0.1"))).status).toBe(401)
    }
  })
})
