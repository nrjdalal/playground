import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test"

import { testContainerName } from "../../../../container"

// Better Auth refuses its default secret under NODE_ENV=production, which CI's build step sets; set one before the middleware loads.
process.env.BETTER_AUTH_SECRET ||= "rate-limiter-test-secret-not-for-use-anywhere"
const { SIGNED_IN_LIMIT, limitExempt, rateLimiterMiddleware } =
  await import("../../../../../api/hono/src/middlewares/rate-limiter")
// Resolved from the API's own source, so the test holds the same auth instance the middleware does.
const apiSrc = new URL("../../../../../api/hono/src", import.meta.url).pathname
const { auth } = await import(Bun.resolveSync("@packages/auth", apiSrc))
const { env } = await import(Bun.resolveSync("@packages/env/api-hono", apiSrc))
const { Hono } = await import("../../../../../api/hono/node_modules/hono")

const LIMIT = env.HONO_RATE_LIMIT

const app = new Hono()
  .use("*", rateLimiterMiddleware)
  .get("/", (c) => c.text("ok"))
  .get("/api/health", (c) => c.text("ok"))

const get = async (headers: Record<string, string> = {}) =>
  (await app.request("/", { headers })).status

// The clock stands still for every request a test makes, so however slow the machine, the limiter's window never rolls mid-loop or between the tests and the counts stay exact. The store also expires a bucket only after two of its sweeps with no hit, and a request keeps its client in place, so a still clock holds the spent buckets too.
const FROZEN = Date.now()
let clock: { mockRestore: () => void } | null = null
beforeEach(() => {
  clock = spyOn(Date, "now").mockImplementation(() => FROZEN)
})
afterEach(() => {
  clock?.mockRestore()
  clock = null
})

// Sign a session token the way Better Auth's own cookie does, so getSession accepts it.
async function signedToken(token: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token))
  return encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`)
}

// A session an hour from expiry, so it is due for the refresh only authMiddleware may write.
function fakeSession(token: string) {
  const now = new Date()
  return {
    session: {
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      id: "s-rate-limit",
      token,
      updatedAt: now,
      userId: "u-rate-limit",
    },
    user: {
      createdAt: now,
      email: "agent@local.host",
      emailVerified: true,
      id: "u-rate-limit",
      name: "LocalAgent",
      updatedAt: now,
    },
  }
}

// The global limiter's state outlives a test, so the tests run in order: the first spends the shared loopback bucket, the next ones rely on it being spent.
describe("rateLimiterMiddleware", () => {
  test("limits anonymous loopback requests, which findIp cannot place, under one key", async () => {
    const context = await auth.$context
    const lookups = spyOn(context.internalAdapter, "findSession")
    try {
      const seen: number[] = []
      for (let i = 0; i <= LIMIT; i++) seen.push(await get())
      expect(seen.slice(0, LIMIT).every((status) => status === 200)).toBe(true)
      expect(seen[LIMIT]).toBe(429)
      expect(lookups).not.toHaveBeenCalled()
    } finally {
      lookups.mockRestore()
    }
  })

  test("counts a forged session cookie as anonymous, with no session lookup", async () => {
    const context = await auth.$context
    const lookups = spyOn(context.internalAdapter, "findSession")
    try {
      const cookie = `${context.authCookies.sessionToken.name}=forged-token.bm90LWEtc2lnbmF0dXJl`
      expect(await get({ cookie })).toBe(429)
      expect(lookups).not.toHaveBeenCalled()
    } finally {
      lookups.mockRestore()
    }
  })

  test("gives a signed-in user a budget of their own, past the spent anonymous one, writing nothing", async () => {
    expect(await get()).toBe(429)
    const context = await auth.$context
    const token = "rate-limit-session-token"
    const lookups = spyOn(context.internalAdapter, "findSession").mockResolvedValue(
      fakeSession(token) as never,
    )
    const refreshes = spyOn(context.internalAdapter, "updateSession")
    try {
      const cookie = `${context.authCookies.sessionToken.name}=${await signedToken(token, context.secret)}`
      const seen: number[] = []
      for (let i = 0; i <= SIGNED_IN_LIMIT; i++) seen.push(await get({ cookie }))
      expect(SIGNED_IN_LIMIT).toBe(LIMIT * 20)
      expect(seen.slice(0, SIGNED_IN_LIMIT).every((status) => status === 200)).toBe(true)
      expect(seen[SIGNED_IN_LIMIT]).toBe(429)
      expect(lookups).toHaveBeenCalled()
      expect(refreshes).not.toHaveBeenCalled()
    } finally {
      lookups.mockRestore()
      refreshes.mockRestore()
    }
  })

  test("never limits an anonymous /api/health read on a loopback stack, while the spent anonymous budget still binds", async () => {
    const health: number[] = []
    for (let i = 0; i <= LIMIT * 3; i++) {
      health.push((await app.request("/api/health")).status)
    }
    expect(health.filter((status) => status !== 200)).toEqual([])
    expect(await get()).toBe(429)
    expect((await app.request("/api/health", { method: "POST" })).status).toBe(429)
  })

  test("exempts only GET /api/health, and only when the API binds a loopback host", () => {
    expect(limitExempt("GET", "/api/health", "127.0.0.1")).toBe(true)
    expect(limitExempt("GET", "/api/health", "::1")).toBe(true)
    expect(limitExempt("GET", "/api/health", "0.0.0.0")).toBe(false)
    expect(limitExempt("GET", "/api/health/ws", "127.0.0.1")).toBe(false)
    expect(limitExempt("GET", "/api/v1/user", "127.0.0.1")).toBe(false)
    expect(limitExempt("POST", "/api/health", "127.0.0.1")).toBe(false)
  })
})

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

// One request through a fresh API process, as a hosted instance of its own, with KV_URL as given; its status.
const INSTANCE = new URL("./two-instances.ts", import.meta.url).pathname
const instance = async (kvUrl?: string): Promise<string> => {
  const env: Record<string, string | undefined> = { ...process.env, KV_URL: kvUrl }
  if (!kvUrl) delete env.KV_URL
  const child = Bun.spawn([process.execPath, INSTANCE], { env, stderr: "pipe", stdout: "pipe" })
  const [out, err] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if ((await child.exited) !== 0) throw new Error(err)
  return out.trim()
}

describe("the limiter across instances", () => {
  test("with no KV_URL, each instance counts alone, in its own memory", async () => {
    expect([await instance(), await instance()]).toEqual(["200", "200"])
  }, 30_000)

  test("with a KV_URL nothing answers at, each instance still answers, counting alone", async () => {
    expect([await instance("redis://127.0.0.1:1"), await instance("redis://127.0.0.1:1")]).toEqual([
      "200",
      "200",
    ])
  }, 30_000)
})

// A throwaway Redis in Docker published on 127.0.0.1 only; skipped where Docker is not running.
describe.skipIf(!dockerUp())("the limiter on Redis", () => {
  let container = ""
  let url = ""

  beforeAll(async () => {
    container = Bun.spawnSync([
      "docker",
      "run",
      "-d",
      "--rm",
      "--name",
      testContainerName("redis-rate-limit"),
      "-p",
      "127.0.0.1::6379",
      "redis:alpine",
    ])
      .stdout.toString()
      .trim()
    const port = Bun.spawnSync(["docker", "port", container, "6379/tcp"])
      .stdout.toString()
      .trim()
      .split(":")
      .at(-1)
    url = `redis://127.0.0.1:${port}`
    for (let i = 0; i < 60; i++) {
      const probe = Bun.spawnSync(["docker", "exec", container, "redis-cli", "ping"])
      if (probe.stdout.toString().trim() === "PONG") break
      await Bun.sleep(250)
    }
  }, 60_000)

  afterAll(() => {
    if (container)
      Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore", stdout: "ignore" })
  })

  test("with KV_URL set, two instances count together: the request at the limit passes, and the next one is refused", async () => {
    expect([await instance(url), await instance(url)]).toEqual(["200", "429"])
  }, 30_000)
})
