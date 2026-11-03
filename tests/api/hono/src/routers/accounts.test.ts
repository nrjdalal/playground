import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "accounts-router-test-secret-not-for-use-anywhere"
const { accountsList, accountsRouter, addSchema, listResponse } =
  await import("../../../../../api/hono/src/routers/accounts")
const { Hono } = await import("../../../../../api/hono/node_modules/hono")
// hono's logger by its file, typed by its declaration, since the package's exports map reaches no test outside api/hono.
const { logger } = (await import(
  "../../../../../api/hono/node_modules/hono/dist/middleware/logger/index.js" as string
)) as typeof import("../../../../../api/hono/node_modules/hono/dist/types/middleware/logger/index")
const { env } = await import("../../../../../packages/env/dist/api-hono.mjs")

const TOKEN = "sk-ant-fake-token"

// Validated, the setting is a list; with validation skipped, as in CI, it is the raw comma-separated string.
const trusted = (): string => {
  const origins: unknown = env.HONO_TRUSTED_ORIGINS
  return Array.isArray(origins) ? String(origins[0]) : String(origins).split(",")[0]!.trim()
}

// Stands in for the Bun server hono/bun reads the peer from; with none, the peer is unknown.
const peer = (address: string) => ({
  requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 50000 }),
})

// The router behind the API's own request logger, as local.ts mounts it, each logged line kept.
const lines: string[] = []
const app = new Hono()
  .use(logger((line: string) => void lines.push(line)))
  .route("/api/v1/accounts", accountsRouter)

const add = (headers: Record<string, string>, server?: ReturnType<typeof peer>) =>
  app.request(
    "http://127.0.0.1/api/v1/accounts",
    {
      body: JSON.stringify({ email: "made-up@example.test", provider: "claude", token: TOKEN }),
      headers: { "content-type": "application/json", ...headers },
      method: "POST",
    },
    server,
  )

const remove = (headers: Record<string, string>, server?: ReturnType<typeof peer>) =>
  app.request("http://127.0.0.1/api/v1/accounts/glm/zai", { headers, method: "DELETE" }, server)

const CODE = "made_up_sign_in_code_for_tests"

// The guided Add Claude account's three writes, each with a body its route takes.
const signIn =
  (path: string, body: unknown) =>
  (headers: Record<string, string>, server?: ReturnType<typeof peer>) =>
    app.request(
      `http://127.0.0.1/api/v1/accounts/claude/${path}`,
      {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", ...headers },
        method: "POST",
      },
      server,
    )
const signInWrites = [
  signIn("setup", { email: "made-up@example.test" }),
  signIn("setup/made-up-id/code", { code: CODE }),
  signIn("open-private", { id: "made-up-id" }),
]

describe("the accounts routes", () => {
  test("the list turns away a request with no session", async () => {
    expect((await app.request("http://127.0.0.1/api/v1/accounts")).status).toBe(401)
  })

  test("a write from another origin or off this machine is refused before the session is read", async () => {
    for (const write of [add, remove, ...signInWrites]) {
      expect((await write({}, peer("127.0.0.1"))).status).toBe(403)
      expect((await write({ origin: "http://evil.localhost" }, peer("127.0.0.1"))).status).toBe(403)
      expect((await write({ origin: trusted() }, peer("192.168.1.20"))).status).toBe(403)
      expect((await write({ origin: trusted() })).status).toBe(403)
      expect((await write({ origin: trusted() }, peer("127.0.0.1"))).status).toBe(401)
    }
  })

  test("the token reaches no logged line and no answer", async () => {
    lines.length = 0
    const answer = await (await add({ origin: trusted() }, peer("127.0.0.1"))).text()
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join("\n")).not.toContain(TOKEN)
    expect(answer).not.toContain(TOKEN)
  })

  test("a sign-in's code reaches no logged line and no answer", async () => {
    lines.length = 0
    const answer = await (await signInWrites[1]!({ origin: trusted() }, peer("127.0.0.1"))).text()
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join("\n")).not.toContain(CODE)
    expect(answer).not.toContain(CODE)
  })

  test("an add's body takes no field beyond its provider's, so no request can name a record file", () => {
    const body = { label: "zai", provider: "glm", token: "made.up" }
    expect(addSchema.safeParse(body).success).toBe(true)
    expect(addSchema.safeParse({ ...body, record: "/tmp/x.json" }).success).toBe(false)
    expect(addSchema.safeParse({ ...body, keychain: { record: "/tmp/x.json" } }).success).toBe(
      false,
    )
  })
})

// A data folder before ext init, and one whose root names a login, as ext init leaves it.
const scratch = mkdtempSync(join(tmpdir(), "accounts-login-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))
const folder = (login?: string) => {
  const data = mkdtempSync(join(scratch, "data-"))
  if (login) {
    mkdirSync(join(data, "extensions"), { recursive: true })
    writeFileSync(join(data, "extensions", "login"), `${login}\n`)
  }
  return data
}

describe("GET /api/v1/accounts' body", () => {
  test("says whether the extensions login exists beside the accounts, in the shape its OpenAPI schema names", () => {
    const login = process.env.PLAYGROUND_LOGIN
    delete process.env.PLAYGROUND_LOGIN
    try {
      const none = accountsList(folder())
      const named = accountsList(folder("made-up-me"))
      expect(none).toEqual({ accounts: [], login: false })
      expect(named).toEqual({ accounts: [], login: true })
      for (const data of [none, named]) expect(listResponse.safeParse({ data }).success).toBe(true)
    } finally {
      if (login === undefined) delete process.env.PLAYGROUND_LOGIN
      else process.env.PLAYGROUND_LOGIN = login
    }
  })
})
