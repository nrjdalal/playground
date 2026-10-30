import { describe, expect, test } from "bun:test"

const { apiReference, SCALAR_BUNDLE_PATH, serveScalarBundle } =
  await import("../../../../../api/hono/src/lib/api-reference")
const { Hono } = await import("../../../../../api/hono/node_modules/hono")

const app = new Hono().get("/api/docs", apiReference).get(SCALAR_BUNDLE_PATH, serveScalarBundle)

describe("apiReference", () => {
  test("loads Scalar from our own origin, never a CDN", async () => {
    const html = await (await app.request("/api/docs")).text()
    expect(html).toContain(`src="${SCALAR_BUNDLE_PATH}"`)
    expect(html).not.toMatch(/https?:\/\/[^"']*(jsdelivr|unpkg|scalar\.com)/)
  })

  test("sends a CSP of script-src 'self' plus a fresh nonce that every script carries", async () => {
    const first = await app.request("/api/docs")
    const second = await app.request("/api/docs")
    const csp = first.headers.get("content-security-policy") ?? ""
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1] ?? ""
    expect(nonce).toBeTruthy()
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}';`)
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    const html = await first.text()
    const nonces = [...html.matchAll(/<script[^>]*nonce="([^"]+)"/g)].map((m) => m[1] ?? "")
    expect(nonces.length).toBeGreaterThan(0)
    expect(new Set(nonces)).toEqual(new Set([nonce]))
    expect(second.headers.get("content-security-policy")).not.toContain(`'nonce-${nonce}'`)
  })

  test("turns off Scalar's hosted tools, its client link and telemetry", async () => {
    const html = await (await app.request("/api/docs")).text()
    const config = html.match(/createApiReference\('#app', ([\s\S]*?)\)\s*<\/script>/)?.[1] ?? ""
    expect(config).toMatch(/"agent":\s*\{\s*"disabled":\s*true\s*\}/)
    expect(config).toMatch(/"mcp":\s*\{\s*"disabled":\s*true\s*\}/)
    expect(config).toMatch(/"showDeveloperTools":\s*"never"/)
    expect(config).toMatch(/"telemetry":\s*false/)
    expect(config).toMatch(/"hideClientButton":\s*true/)
  })

  test("serves the installed standalone bundle as JavaScript", async () => {
    const res = await app.request(SCALAR_BUNDLE_PATH)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("javascript")
    const body = await res.text()
    expect(body.length).toBeGreaterThan(100_000)
    expect(body).toContain("createApiReference")
  })

  test("answers a matching If-None-Match with 304", async () => {
    const etag = (await app.request(SCALAR_BUNDLE_PATH)).headers.get("etag")
    expect(etag).toBeTruthy()
    const again = await app.request(SCALAR_BUNDLE_PATH, { headers: { "If-None-Match": etag! } })
    expect(again.status).toBe(304)
  })
})
