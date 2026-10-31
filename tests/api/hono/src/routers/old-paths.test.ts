import { describe, expect, test } from "bun:test"

// The routers' auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the routers load.
process.env.BETTER_AUTH_SECRET ||= "old-paths-test-secret-not-for-use-anywhere"
const { appsRouter, dashboardRouter, inboxRouter, sessionsRouter, v1Router } =
  await import("../../../../../api/hono/src/routers")
const { mountOldPaths, OLD_PATHS, OLD_PATHS_DOC } =
  await import("../../../../../api/hono/src/routers/old-paths")
const { env } = await import("../../../../../packages/env/dist/api-hono.mjs")
const { Hono } = await import("../../../../../api/hono/node_modules/hono")

// The API's own mounts of these routers, as local.ts makes them, then the old paths beside them.
const api = new Hono()
  .basePath("/api")
  .route("/v1", dashboardRouter)
  .route("/v1/apps", appsRouter)
  .route("/v1/inbox", inboxRouter)
  .route("/v1/sessions", sessionsRouter)
  .route("/v1", v1Router)
mountOldPaths(api, {
  apps: appsRouter,
  dashboard: dashboardRouter,
  inbox: inboxRouter,
  sessions: sessionsRouter,
})

const trusted = (): string => {
  const origins: unknown = env.HONO_TRUSTED_ORIGINS
  return Array.isArray(origins) ? String(origins[0]) : String(origins).split(",")[0]!.trim()
}
const peer = (address: string) => ({
  requestIP: () => ({ address, family: "IPv4", port: 50000 }),
})
const send = (path: string, method: string, address: string) =>
  api.request(
    `http://127.0.0.1${path}`,
    {
      body: method === "GET" ? undefined : "{}",
      headers: { "content-type": "application/json", origin: trusted() },
      method,
    },
    peer(address),
  )

// One read and one write each router serves, by its old path and its new one.
const routes: Record<keyof typeof OLD_PATHS, { read: string; write?: string }> = {
  apps: { read: "/plan", write: "/plan/order" },
  dashboard: { read: "/workers", write: "/messages" },
  inbox: { read: "", write: "/dismiss" },
  sessions: { read: "" },
}
const NEW: Record<keyof typeof OLD_PATHS, string> = {
  apps: "/api/v1/apps",
  dashboard: "/api/v1",
  inbox: "/api/v1/inbox",
  sessions: "/api/v1/sessions",
}

describe("each moved router answers at its old path and its new one, guarded alike", () => {
  for (const name of Object.keys(OLD_PATHS) as (keyof typeof OLD_PATHS)[]) {
    for (const base of [`/api${OLD_PATHS[name]}`, NEW[name]]) {
      test(`${base}: a read with no owner session is refused`, async () => {
        expect((await send(`${base}${routes[name].read}`, "GET", "127.0.0.1")).status).toBe(401)
      })

      const write = routes[name].write
      if (write !== undefined)
        test(`${base}: a write from off this machine is refused before any session read`, async () => {
          const response = await send(`${base}${write}`, "POST", "192.168.1.20")
          expect(response.status).toBe(403)
        })
    }
  }

  test("user and admin under /api/v1 take none of the dashboard's guards", async () => {
    const response = await send("/api/v1/session", "POST", "192.168.1.20")
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain("Writes are taken from this machine only")
  })

  test("the OpenAPI document leaves the old paths out", () => {
    for (const path of Object.values(OLD_PATHS))
      expect(OLD_PATHS_DOC.test(`/api${path}/x`)).toBe(true)
    expect(OLD_PATHS_DOC.test("/api/v1/workers")).toBe(false)
  })
})
