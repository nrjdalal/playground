import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "apps-router-test-secret-not-for-use-anywhere"
const { appsRouter, deleteLimiter, orderBodySchema, orderLimiter, servePreview } =
  await import("../../../../../api/hono/src/routers/apps")
const { readPreview } = await import("../../../../../api/hono/src/lib/apps/previews")
const { Hono } = await import("../../../../../api/hono/node_modules/hono")
const { env } = await import("../../../../../packages/env/dist/api-hono.mjs")
// Resolved from the API's own source, so the test holds the same auth instance the middlewares do.
const { auth } = await import(
  Bun.resolveSync(
    "@packages/auth",
    new URL("../../../../../api/hono/src", import.meta.url).pathname,
  )
)

// Validated, the setting is a list; with validation skipped, as in CI, it is the raw comma-separated string.
const trusted = (): string => {
  const origins: unknown = env.HONO_TRUSTED_ORIGINS
  return Array.isArray(origins) ? String(origins[0]) : String(origins).split(",")[0]!.trim()
}

// Stands in for the Bun server hono/bun reads the peer from; with none, the peer is unknown.
const peer = (address: string) => ({
  requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 50000 }),
})

// The router on its own, at its own root (the API mounts it at /api/v1/apps).
const request = (path: string) => appsRouter.request(`http://127.0.0.1${path}`)

const reorder = (headers: Record<string, string>, server?: ReturnType<typeof peer>) =>
  appsRouter.request(
    "http://127.0.0.1/plan/order",
    {
      body: JSON.stringify({ lanes: { easy: ["F2", "F3"] } }),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    },
    server,
  )

// A page's delete, as the Pages tab sends it.
const remove = (name: string, headers: Record<string, string>, server?: ReturnType<typeof peer>) =>
  appsRouter.request(`http://127.0.0.1/previews/${name}`, { headers, method: "DELETE" }, server)

// Stands in for Better Auth's session read: authMiddleware asks with returnHeaders and takes { headers, response }, requireConsoleRole asks without and takes the session.
const signedIn = (role: string) =>
  spyOn(auth.api, "getSession").mockImplementation((async (options: {
    returnHeaders?: boolean
  }) => {
    const session = {
      session: { id: "s-pages", userId: `u-${role}` },
      user: { banned: false, id: `u-${role}`, role },
    }
    return options.returnHeaders ? { headers: new Headers(), response: session } : session
  }) as never)

let spy: { mockRestore: () => void } | null = null
afterEach(() => {
  spy?.mockRestore()
  spy = null
})

describe("the apps routes", () => {
  test("every route turns away a request with no session", async () => {
    for (const path of ["/plan", "/previews", "/previews/spinner-preview.html", "/usage"]) {
      expect((await request(path)).status).toBe(401)
    }
  })

  test("a board order from any origin but the dashboard's own is refused before the session is read", async () => {
    expect((await reorder({}, peer("127.0.0.1"))).status).toBe(403)
    expect((await reorder({ origin: "http://evil.localhost" }, peer("127.0.0.1"))).status).toBe(403)
  })

  test("a board order from another machine is refused, and so is one whose peer cannot be read", async () => {
    expect((await reorder({ origin: trusted() }, peer("192.168.1.20"))).status).toBe(403)
    expect((await reorder({ origin: trusted() })).status).toBe(403)
  })

  test("a board order from the dashboard's own page on this machine still needs a session", async () => {
    expect((await reorder({ origin: trusted() }, peer("127.0.0.1"))).status).toBe(401)
  })
})

describe("the page delete route", () => {
  // The owner's session is stubbed in the origin and machine cases, so each 403 can come only from guardWrites.
  test("refuses a request with no origin before the session is read", async () => {
    spy = signedIn("owner")
    expect((await remove("lookup.html", {}, peer("127.0.0.1"))).status).toBe(403)
  })

  test("refuses an untrusted origin before the session is read", async () => {
    spy = signedIn("owner")
    const at = { origin: "http://evil.localhost" }
    expect((await remove("lookup.html", at, peer("127.0.0.1"))).status).toBe(403)
  })

  test("refuses a request from another machine before the session is read", async () => {
    spy = signedIn("owner")
    expect((await remove("lookup.html", { origin: trusted() }, peer("192.168.1.20"))).status).toBe(
      403,
    )
  })

  test("refuses a request whose peer cannot be read", async () => {
    spy = signedIn("owner")
    expect((await remove("lookup.html", { origin: trusted() })).status).toBe(403)
  })

  test("refuses a request with no session", async () => {
    expect((await remove("lookup.html", { origin: trusted() }, peer("127.0.0.1"))).status).toBe(401)
  })

  test("refuses a session below the owner rung", async () => {
    spy = signedIn("admin")
    expect((await remove("lookup.html", { origin: trusted() }, peer("127.0.0.1"))).status).toBe(403)
  })

  test("the route passes its limiter, behind the router's guards", () => {
    const handlers = appsRouter.routes
      .filter((r) => r.method === "DELETE" && r.path === "/previews/:name")
      .map((r) => r.handler)
    expect(handlers).toContain(deleteLimiter)
  })

  test("the owner deletes a page pages.jsonl names, and a name that names no page is a 404 that leaves every file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashboard-previews-delete-"))
    const saved = {
      dir: process.env.PLAYGROUND_PREVIEWS_DIR,
      live: process.env.PLAYGROUND_LIVE_READS,
    }
    try {
      Object.assign(process.env, { PLAYGROUND_LIVE_READS: "1", PLAYGROUND_PREVIEWS_DIR: dir })
      writeFileSync(join(dir, "lookup.html"), "<p>hi</p>")
      writeFileSync(join(dir, "lookup.txt"), "Lookup\n")
      writeFileSync(join(dir, "shot.html"), "<p>not kept</p>")
      writeFileSync(
        join(dir, "pages.jsonl"),
        `${JSON.stringify({ at: "2026-11-03T10:00:00.000Z", by: "planner", file: "lookup.html", for: null, title: "Lookup" })}\n`,
      )
      spy = signedIn("owner")
      const at = { origin: trusted() }
      for (const name of ["shot.html", "missing.html", "..%2Flookup.html", "lookup.txt"]) {
        expect((await remove(name, at, peer("127.0.0.1"))).status).toBe(404)
      }
      expect(existsSync(join(dir, "shot.html"))).toBe(true)
      const deleted = await remove("lookup.html", at, peer("127.0.0.1"))
      expect(deleted.status).toBe(200)
      expect(await deleted.json()).toEqual({ data: { name: "lookup.html" } })
      expect(existsSync(join(dir, "lookup.html"))).toBe(false)
      expect(existsSync(join(dir, "lookup.txt"))).toBe(false)
      expect((await remove("lookup.html", at, peer("127.0.0.1"))).status).toBe(404)
    } finally {
      for (const [key, value] of [
        ["PLAYGROUND_PREVIEWS_DIR", saved.dir],
        ["PLAYGROUND_LIVE_READS", saved.live],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

describe("the order route's own checks", () => {
  test("the route passes its limiter, behind the router's guards", () => {
    const handlers = appsRouter.routes
      .filter((r) => r.method === "POST" && r.path === "/plan/order")
      .map((r) => r.handler)
    expect(handlers).toContain(orderLimiter)
  })

  test("lets one person reorder 30 times a minute and refuses the 31st", async () => {
    const app = new Hono<{ Variables: { session: { userId: string } } }>()
      .use("*", async (c, next) => {
        c.set("session", { userId: "u-order" })
        await next()
      })
      .use("*", orderLimiter)
      .post("/", (c) => c.text("ok"))
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) statuses.push((await app.request("/", { method: "POST" })).status)
    expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true)
    expect(statuses[30]).toBe(429)
  })

  test("takes only lanes of item ids, each id once", () => {
    expect(orderBodySchema.safeParse({ lanes: { easy: ["F2"], hard: [] } }).success).toBe(true)
    for (const body of [
      { lanes: { easy: ["F2"], medium: ["F2"] } },
      { lanes: { easy: ["F2", "F2"] } },
      { lanes: { easy: [""] } },
      { lanes: { easy: "F2" } },
      { lanes: { easy: ["F2"] }, plan: {} },
      {},
    ]) {
      expect(orderBodySchema.safeParse(body).success).toBe(false)
    }
  })
})

describe("servePreview", () => {
  test("an HTML preview is served as a sandboxed page only the dashboard may frame, and a name that finds nothing is a 404", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashboard-previews-serve-"))
    try {
      writeFileSync(join(dir, "spin.html"), "<p>hi</p>")
      const origins = ["https://playground.localhost"]
      const response = await servePreview("spin.html", (name) => readPreview(name, dir), origins)
      expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8")
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("content-security-policy")).toStartWith(
        "sandbox allow-scripts; default-src 'none'",
      )
      expect(response.headers.get("content-security-policy")).toContain(
        `frame-ancestors ${origins[0]}`,
      )
      expect(await response.text()).toBe("<p>hi</p>")
      for (const name of ["missing.png", "../spin.html", "spin.txt"]) {
        const gone = await servePreview(name, (n) => readPreview(n, dir), origins).catch(
          (thrown: { status: number }) => thrown,
        )
        expect(gone).toMatchObject({ status: 404 })
      }
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
})
