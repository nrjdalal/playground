import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"

import { SQL } from "bun"

const ROOT = resolve(import.meta.dir, "../../../../..")
const API = join(ROOT, "api/hono")
const HOSTED = join(API, "src/hosted.ts")
const MIGRATIONS = join(ROOT, "packages/db/drizzle")
const SCENARIO = join(import.meta.dir, "yard-scenario.ts")
const GITHUB = join(import.meta.dir, "yard-github.ts")
const WEB = "http://127.0.0.1:3000"
const PASSWORD = crypto.randomUUID()

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

// A child Bun in the API's folder, so its tsconfig's @/ resolves, on the hosted build's environment: the hosted switch, the Vercel adapter and the database URL are read once, when their modules load.
const child = (script: string, env: Record<string, string>) => {
  const run = Bun.spawnSync(["bun", "-e", script], {
    cwd: API,
    env: {
      HOME: process.env.HOME ?? "",
      PATH: process.env.PATH ?? "",
      BETTER_AUTH_SECRET: "yard-test-secret",
      GITHUB_CLIENT_ID: "yard-test-client",
      GITHUB_CLIENT_SECRET: "yard-test-client-secret",
      HONO_APP_URL: "http://127.0.0.1:4000",
      HONO_TRUSTED_ORIGINS: WEB,
      HONO_WEB_URL: WEB,
      NODE_ENV: "test",
      PLAYGROUND_HOSTED: "1",
      PORT: "0",
      YARD_HOSTED: HOSTED,
      ...env,
    },
    stderr: "pipe",
    stdout: "pipe",
    timeout: 30_000,
  })
  return { code: run.exitCode, err: run.stderr.toString(), out: run.stdout.toString() }
}

// The last line a child printed, after the request log.
const last = (out: string) => out.trim().split("\n").at(-1) ?? ""

// A one-time token as Better Auth's plugin keeps it, hashed, pointing at a live session.
const ottHash = (token: string) => createHash("sha256").update(token).digest("base64url")

describe.skipIf(!dockerUp())("Yard's routes on the hosted build", () => {
  let container = ""
  let sql: SQL
  let url = ""

  // Mints a one-time token for a member's session, as GET /api/auth/one-time-token/generate would.
  const ott = async (userId: string) => {
    const token = crypto.randomUUID()
    const session = crypto.randomUUID()
    const later = new Date(Date.now() + 600_000)
    await sql`insert into session (id, token, user_id, expires_at, updated_at) values (${session}, ${session}, ${userId}, ${later}, now())`
    await sql`insert into verification (id, identifier, value, expires_at) values (${crypto.randomUUID()}, ${`one-time-token:${ottHash(token)}`}, ${session}, ${later})`
    return token
  }

  beforeAll(async () => {
    container = Bun.spawnSync([
      "docker",
      "run",
      "-d",
      "--rm",
      "-e",
      `POSTGRES_PASSWORD=${PASSWORD}`,
      "-p",
      "127.0.0.1::5432",
      "postgres:18-alpine",
    ])
      .stdout.toString()
      .trim()
    const port = Bun.spawnSync(["docker", "port", container, "5432/tcp"])
      .stdout.toString()
      .trim()
      .split(":")
      .at(-1)
    url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`
    for (let i = 0; i < 60; i++) {
      try {
        sql = new SQL(url, { max: 1 })
        await sql`select 1`
        break
      } catch {
        await Bun.sleep(500)
      }
    }
    const journal = await Bun.file(join(MIGRATIONS, "meta/_journal.json")).json()
    for (const { tag } of journal.entries as { tag: string }[])
      for (const statement of (await Bun.file(join(MIGRATIONS, `${tag}.sql`)).text()).split(
        "--> statement-breakpoint",
      ))
        if (statement.trim()) await sql.unsafe(statement)
    for (const id of ["bo", "di"]) {
      await sql`insert into "user" (id, name, email, login, role) values (${id}, ${id}, ${`${id}@example.com`}, ${id}, 'member')`
      await sql`insert into yard_token (id, hash, name, user_id) values (${crypto.randomUUID()}, ${createHash("sha256").update(`yard_${id}`).digest("hex")}, ${"studio"}, ${id})`
    }
  }, 60_000)

  afterAll(async () => {
    await sql?.close()
    if (container)
      Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore", stdout: "ignore" })
  })

  test("refuse what they should, take a token's calls, and push a sent message to a member's socket", async () => {
    const run = child(await Bun.file(SCENARIO).text(), {
      BO_TOKEN: "yard_bo",
      DI_OTT: await ott("di"),
      DI_TOKEN: "yard_di",
      POSTGRES_URL: url,
    })
    expect(run.err).not.toContain("error:")
    const out = JSON.parse(last(run.out))
    expect(out).toMatchObject({
      cookieWriteNoOrigin: 403,
      created: 201,
      held: "pending",
      me: { login: "bo", owner: false },
      noAuth: 401,
      ottVerify: 404,
      posted: [201, "sent"],
      socket: "open",
      socketNoOrigin: 403,
      socketNoToken: 401,
      tokenOnWebOnly: 403,
      waiting: [{ items: [] }, 400],
    })
    expect(out.tokenList.data.channels).toEqual([])
    expect(out.frames).toEqual([
      {
        message: expect.objectContaining({
          from: { device: "studio", login: "bo" },
          text: "anyone up?",
        }),
        type: "message",
      },
    ])
  })

  // A member of its own with a token, so a test's posts meet no other test's one-a-second limit.
  const tokenFor = async (id: string) => {
    await sql`insert into "user" (id, name, email, login, role) values (${id}, ${id}, ${`${id}@example.com`}, ${id}, 'member')`
    await sql`insert into yard_token (id, hash, name, user_id) values (${crypto.randomUUID()}, ${createHash("sha256").update(`yard_${id}`).digest("hex")}, ${"studio"}, ${id})`
    return `yard_${id}`
  }

  // a fan-out runs after the write has committed, so one that fails must not turn the answer into a 500
  test("a post and a read answer what they wrote while KV_URL's Redis refuses every command", async () => {
    const script = `const redis = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: (socket) => { socket.write("-ERR refused\\r\\n") } } }); process.env.KV_URL = "redis://127.0.0.1:" + redis.port; const server = Bun.serve((await import(process.env.YARD_HOSTED)).default); const api = "http://127.0.0.1:" + server.port + "/api/v1/yard"; const headers = { authorization: "Bearer " + process.env.TOKEN, "content-type": "application/json" }; const made = await fetch(api + "/channels", { body: JSON.stringify({ name: "quiet" }), headers, method: "POST" }); const { id } = (await made.json()).data.channel; const posted = await fetch(api + "/channels/" + id + "/messages", { body: JSON.stringify({ kind: "text", text: "hello" }), headers, method: "POST" }); const read = await fetch(api + "/channels/" + id + "/read", { body: "{}", headers, method: "POST" }); console.log(JSON.stringify([made.status, posted.status, read.status])); process.exit(0)`
    const run = child(script, { POSTGRES_URL: url, TOKEN: await tokenFor("ed") })
    expect(JSON.parse(last(run.out))).toEqual([201, 201, 200])
  })

  test("a post and a read answer what they wrote while nothing takes KV_URL's connection", async () => {
    const script = `const server = Bun.serve((await import(process.env.YARD_HOSTED)).default); const api = "http://127.0.0.1:" + server.port + "/api/v1/yard"; const headers = { authorization: "Bearer " + process.env.TOKEN, "content-type": "application/json" }; const made = await fetch(api + "/channels", { body: JSON.stringify({ name: "unreached" }), headers, method: "POST" }); const { id } = (await made.json()).data.channel; const posted = await fetch(api + "/channels/" + id + "/messages", { body: JSON.stringify({ kind: "text", text: "hello" }), headers, method: "POST" }); const read = await fetch(api + "/channels/" + id + "/read", { body: "{}", headers, method: "POST" }); console.log(JSON.stringify([made.status, posted.status, read.status])); process.exit(0)`
    const run = child(script, {
      KV_URL: "redis://127.0.0.1:1",
      POSTGRES_URL: url,
      TOKEN: await tokenFor("fy"),
    })
    expect(JSON.parse(last(run.out))).toEqual([201, 201, 200])
  })

  test("GitHub's sign-in stamps the login and takes it from a stale holder, and no client sets one", async () => {
    await sql`insert into "user" (id, name, email, login, role) values ('old', 'old', ${["old", "example.com"].join("@")}, 'Taken', 'member')`
    const run = child(await Bun.file(GITHUB).text(), { GH_LOGIN: "taken", POSTGRES_URL: url })
    expect(run.err).not.toContain("error:")
    expect(JSON.parse(last(run.out))).toMatchObject({ callback: 302, update: 200 })
    // the new holder keeps GitHub's login through its own update-user, and the stale holder has let it go
    const [stale] = await sql`select login from "user" where id = 'old'`
    const [fresh] =
      await sql`select login from "user" where email = ${["new", "example.com"].join("@")}`
    expect([stale.login, fresh.login]).toEqual([null, "taken"])
  })

  test("the socket upgrades on the Vercel export, a server that never listened", async () => {
    const script = `const server = (await import(${JSON.stringify(HOSTED)})).default; await new Promise((done) => server.listen(0, "127.0.0.1", done)); const socket = new WebSocket("ws://127.0.0.1:" + server.address().port + "/api/v1/yard/socket?token=${await ott("bo")}", { headers: { origin: ${JSON.stringify(WEB)} } }); socket.onopen = () => { console.log("open"); process.exit(0) }; socket.onerror = () => { console.log("error"); process.exit(1) }`
    const run = child(script, { POSTGRES_URL: url, VERCEL: "1" })
    expect(run.err).not.toContain("error:")
    expect(last(run.out)).toBe("open")
  })
})
