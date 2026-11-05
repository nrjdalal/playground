import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Hono } from "hono"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "templates-router-test-secret-not-for-use-anywhere"
const { templatesRouter } = await import("../../../../../api/hono/src/routers/templates")
const { env } = await import("../../../../../packages/env/dist/api-hono.mjs")
const { errorHandler } = await import("../../../../../api/hono/src/lib/error")
// Resolved from the API's own source, so the test holds the same auth instance the middlewares do.
const { auth } = await import(
  Bun.resolveSync(
    "@packages/auth",
    new URL("../../../../../api/hono/src", import.meta.url).pathname,
  )
)

const scratch = mkdtempSync(join(tmpdir(), "templates-router-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// Validated, the setting is a list; with validation skipped, as in CI, it is the raw comma-separated string.
const trusted = (): string => {
  const origins: unknown = env.HONO_TRUSTED_ORIGINS
  return Array.isArray(origins) ? String(origins[0]) : String(origins).split(",")[0]!.trim()
}

// Stands in for the Bun server hono/bun reads the peer from; with none, the peer is unknown.
const peer = (address: string) => ({
  requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 50000 }),
})

// Stands in for Better Auth's session read: authMiddleware asks with returnHeaders and takes { headers, response }, requireConsoleRole asks without and takes the session.
const signedIn = (role: string) =>
  spyOn(auth.api, "getSession").mockImplementation((async (options: {
    returnHeaders?: boolean
  }) => {
    const session = {
      session: { id: "s-templates", userId: `u-${role}` },
      user: { banned: false, id: `u-${role}`, role },
    }
    return options.returnHeaders ? { headers: new Headers(), response: session } : session
  }) as never)

// Mounted with the API's error handler, so a thrown ApiError answers in its { error } envelope.
const app = new Hono().route("/", templatesRouter)
app.onError(errorHandler)

const start = (id: string, headers: Record<string, string>, server?: ReturnType<typeof peer>) =>
  app.request(`http://127.0.0.1/${id}/start`, { headers, method: "POST" }, server)

const here = () => [{ origin: trusted() }, peer("127.0.0.1")] as const

const spies: { mockRestore: () => void }[] = []
const ENV_KEYS = [
  "CLAUDE_CONFIG_DIR",
  "PLAYGROUND_DATA_DIR",
  "PLAYGROUND_FIXTURE_DIR",
  "PLAYGROUND_LIVE_READS",
] as const
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore()
  for (const key of ENV_KEYS)
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
})

describe("the template routes' guards", () => {
  test("the list and a start turn away a request with no session", async () => {
    expect((await templatesRouter.request("http://127.0.0.1/")).status).toBe(401)
    expect((await start("orchestrator", ...here())).status).toBe(401)
  })

  // The owner's session is stubbed, so each 403 can come only from guardWrites.
  test("a start with no origin, another origin, or from off this machine is refused before the session is read", async () => {
    spies.push(signedIn("owner"))
    expect((await start("orchestrator", {}, peer("127.0.0.1"))).status).toBe(403)
    expect(
      (await start("orchestrator", { origin: "http://evil.localhost" }, peer("127.0.0.1"))).status,
    ).toBe(403)
    expect((await start("orchestrator", { origin: trusted() }, peer("192.168.1.20"))).status).toBe(
      403,
    )
    expect((await start("orchestrator", { origin: trusted() })).status).toBe(403)
  })

  test("a session below the owner rung is refused", async () => {
    spies.push(signedIn("admin"))
    expect((await start("orchestrator", ...here())).status).toBe(403)
    expect((await templatesRouter.request("http://127.0.0.1/")).status).toBe(403)
  })
})

describe("the owner's start", () => {
  test("on a fixture stack, an orchestrator starts a made-up session and runs no process", async () => {
    spies.push(signedIn("owner"))
    const spawned = spyOn(Bun, "spawn")
    spies.push(spawned)
    process.env.PLAYGROUND_FIXTURE_DIR = join(scratch, "fixture")
    const response = await start("orchestrator", ...here())
    expect(response.status).toBe(200)
    const body = (await response.json()) as { data: { name: string; started: boolean } }
    expect(body.data.name).toMatch(/^[2-9b-z]{6}-orchestrator$/)
    expect(body.data.started).toBe(true)
    expect(spawned).not.toHaveBeenCalled()
  })

  test("an id no template has is a 404", async () => {
    spies.push(signedIn("owner"))
    process.env.PLAYGROUND_FIXTURE_DIR = join(scratch, "fixture")
    expect((await start("nope", ...here())).status).toBe(404)
  })

  // Live reads from an empty data folder, so no second Claude account is listed.
  test("the list names a Claude second dispatcher's missing account as its refusal", async () => {
    spies.push(signedIn("owner"))
    process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(scratch, "claude-"))
    process.env.PLAYGROUND_DATA_DIR = mkdtempSync(join(scratch, "data-"))
    process.env.PLAYGROUND_LIVE_READS = "1"
    const response = await app.request("http://127.0.0.1/")
    const rows = ((await response.json()) as { data: { id: string; refusal: string | null }[] })
      .data
    expect(rows.find((row) => row.id === "second-dispatcher-claude")?.refusal).toBe(
      "Add a second Claude account in Settings > Accounts",
    )
    expect(rows.find((row) => row.id === "orchestrator")?.refusal).toBeNull()
  })

  // Live reads with every process faked at Bun.spawn: the name picker names one, the roster takes it, and spawn.sh refuses.
  test("spawn.sh's refusal reaches the answer as a 502 with its last line whole", async () => {
    spies.push(signedIn("owner"))
    process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(scratch, "claude-"))
    process.env.PLAYGROUND_DATA_DIR = mkdtempSync(join(scratch, "data-"))
    process.env.PLAYGROUND_LIVE_READS = "1"
    const reason = "spawn.sh refuses c8m3nr-orchestrator: the capacity gate reads 9 of 8 sessions"
    const argvs: string[][] = []
    const spawned = spyOn(Bun, "spawn").mockImplementation(((argv: string[]) => {
      argvs.push(argv)
      const named = argv[1]?.endsWith("name/index.ts")
      const refused = argv[0]?.endsWith("scripts/spawn.sh")
      return {
        exited: Promise.resolve(refused ? 1 : 0),
        stderr: new Response(refused ? `checking\n${reason}\n` : "").body,
        stdout: new Response(named ? "c8m3nr-orchestrator\n" : "").body,
      }
    }) as never)
    spies.push(spawned)
    // no real process may run: the fake is in place before the request
    expect(Bun.spawn).toBe(spawned as never)
    const response = await start("orchestrator", ...here())
    expect(response.status).toBe(502)
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(reason)
    expect(
      argvs.map((argv) =>
        argv.at(-1) === "task=Orchestrator"
          ? "roster"
          : argv.at(-1) === "status=ended"
            ? "ended"
            : argv[1] === "manager"
              ? "spawn"
              : "name",
      ),
    ).toEqual(["name", "roster", "spawn", "ended"])
  })

  test("the Assistant answers 409 naming the session that holds its seat, and runs no process", async () => {
    spies.push(signedIn("owner"))
    process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(scratch, "claude-"))
    const data = mkdtempSync(join(scratch, "data-"))
    process.env.PLAYGROUND_DATA_DIR = data
    process.env.PLAYGROUND_LIVE_READS = "1"
    const agents = [
      {
        kind: "assistant",
        name: "r4qmq4-assistant",
        role: "manager",
        status: "working",
        task: "errands",
      },
    ]
    writeFileSync(
      join(data, "roster.json"),
      JSON.stringify({ agents, updatedAt: "2026-11-05T00:00:00Z" }),
    )
    const spawned = spyOn(Bun, "spawn").mockImplementation((() => {
      throw new Error("no process may run")
    }) as never)
    spies.push(spawned)
    const response = await start("assistant", ...here())
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "r4qmq4-assistant",
    )
    expect(spawned).not.toHaveBeenCalled()
  })
})
