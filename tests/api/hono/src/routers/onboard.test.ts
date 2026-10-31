import { describe, expect, test } from "bun:test"

// The routers' auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "onboard-test-secret-not-for-use-anywhere"
const { onboardRoutes } = await import("../../../../../api/hono/src/routers/onboard")
const { env } = await import("../../../../../packages/env/dist/api-hono.mjs")
type Deps = import("../../../../../api/hono/src/routers/onboard").OnboardDeps

// Validated, the setting is a list; with validation skipped, as in CI, it is the raw comma-separated string.
const origins: unknown = env.HONO_TRUSTED_ORIGINS
const TRUSTED = Array.isArray(origins) ? String(origins[0]) : String(origins).split(",")[0]!.trim()

// Stands in for the Bun server hono/bun reads the peer from.
const peer = (address: string) => ({
  requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 50000 }),
})

// The owners the database holds, the done mark, and every user made and signed in, recorded.
const world = (owners: string[], enabled = true, done = false) => {
  const created: string[] = []
  const signedIn: string[] = []
  const marks = { done, writes: 0 }
  const deps: Deps = {
    createOwner: async () => {
      created.push("owner-new")
      return "owner-new"
    },
    enabled: () => enabled,
    mark: {
      read: async () => marks.done,
      write: async () => {
        marks.writes++
        marks.done = true
      },
    },
    owners: async () => owners,
    signIn: async (_c, id) => void signedIn.push(id),
  }
  return { app: onboardRoutes(deps), created, marks, signedIn }
}

type App = ReturnType<typeof onboardRoutes>
const post = (
  app: App,
  path: string,
  { address = "127.0.0.1", headers = {} as Record<string, string>, origin = TRUSTED } = {},
) =>
  app.request(
    `http://127.0.0.1${path}`,
    { headers: { origin, ...headers }, method: "POST" },
    peer(address),
  )

describe("GET /checks", () => {
  test("answers the rows with the database running, from this machine alone", async () => {
    const { app } = world([])
    const res = await app.request("http://127.0.0.1/checks")
    expect(res.status).toBe(200)
    const { checks, done } = (await res.json()).data
    expect(checks.find((c: { name: string }) => c.name === "Database").status).toBe("ok")
    expect(typeof done).toBe("boolean")
    const forwarded = await app.request("http://127.0.0.1/checks", {
      headers: { "x-forwarded-for": "100.101.102.103" },
    })
    expect(forwarded.status).toBe(403)
  })

  test("once the done mark is written, answers done with no rows and writes nothing more", async () => {
    const { app, marks } = world([], true, true)
    const res = await app.request("http://127.0.0.1/checks")
    expect((await res.json()).data).toEqual({ checks: [], done: true })
    expect(marks.writes).toBe(0)
  })

  test("with live=1, runs the checks whatever the mark says and writes nothing", async () => {
    const { app, marks } = world([], true, true)
    const res = await app.request("http://127.0.0.1/checks?live=1")
    const { checks, done } = (await res.json()).data
    expect(done).toBe(true)
    expect(checks.find((c: { name: string }) => c.name === "Database").status).toBe("ok")
    expect(marks.writes).toBe(0)
  })
})

describe("POST /finish", () => {
  test("with no owner, makes one and signs the browser in as it", async () => {
    const { app, created, signedIn } = world([])
    const res = await post(app, "/finish")
    expect([res.status, (await res.json()).data]).toEqual([200, { signedIn: true }])
    expect([created, signedIn]).toEqual([["owner-new"], ["owner-new"]])
  })

  test("with the owner made already, makes none and signs the browser in as it, so Continue goes on to the board", async () => {
    const { app, created, signedIn } = world(["owner-1"])
    const res = await post(app, "/finish")
    expect([res.status, (await res.json()).data]).toEqual([200, { signedIn: true }])
    expect([created, signedIn]).toEqual([[], ["owner-1"]])
  })

  test("with two owners, makes none, signs no one in and answers 409, as sign-in does", async () => {
    const { app, created, signedIn } = world(["owner-1", "owner-2"])
    const res = await post(app, "/finish")
    expect(res.status).toBe(409)
    expect((await res.json()).error.message).toContain("more than one owner")
    expect([created, signedIn]).toEqual([[], []])
  })
})

describe("POST /sign-in", () => {
  test("signs the one owner in again", async () => {
    const { app, signedIn } = world(["owner-1"])
    const res = await post(app, "/sign-in")
    expect([res.status, (await res.json()).data]).toEqual([200, { signedIn: true }])
    expect(signedIn).toEqual(["owner-1"])
  })

  test("with no owner or two, signs no one in and answers 409", async () => {
    for (const owners of [[], ["owner-1", "owner-2"]]) {
      const { app, signedIn } = world(owners)
      expect((await post(app, "/sign-in")).status).toBe(409)
      expect(signedIn).toEqual([])
    }
  })

  test("two owners are refused in plain words, naming the Console's step and no command", async () => {
    const { app } = world(["owner-1", "owner-2"])
    const { message } = (await (await post(app, "/sign-in")).json()).error
    expect(message).toBe(
      "This Mac has more than one owner, so Playground cannot tell which one to sign in: from a browser still signed in as one, open the Console's Users page and make the other an admin",
    )
    expect(message).not.toMatch(/bun run|console:roles/)
  })
})

describe("the writes' guards", () => {
  test("refuse another origin, a peer off loopback and a client forwarded from off this machine, signing no one in", async () => {
    for (const path of ["/finish", "/sign-in"]) {
      const { app, created, signedIn } = world(path === "/finish" ? [] : ["owner-1"])
      const refused = [
        await post(app, path, { origin: "http://evil.localhost" }),
        await post(app, path, { origin: "" }),
        await post(app, path, { address: "192.168.1.20" }),
        await post(app, path, { headers: { "x-forwarded-for": "100.101.102.103" } }),
        await post(app, path, { headers: { "tailscale-user-login": "me@example.com" } }),
      ]
      for (const res of refused) expect(res.status).toBe(403)
      expect([created, signedIn]).toEqual([[], []])
    }
  })

  test("off a local stack every route is 404", async () => {
    const { app, created, signedIn } = world([], false)
    expect((await app.request("http://127.0.0.1/checks")).status).toBe(404)
    expect((await post(app, "/finish")).status).toBe(404)
    expect((await post(app, "/sign-in")).status).toBe(404)
    expect([created, signedIn]).toEqual([[], []])
  })
})
