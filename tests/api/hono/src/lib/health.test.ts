import { afterAll, beforeAll, describe, expect, test } from "bun:test"

// Port 9 is closed on this machine (verify's own tests use it as one): connecting is refused at once.
const CLOSED = "postgres://postgres:pw@127.0.0.1:9/postgres"
const PASSWORD = "health-test"
const IMAGE = "postgres:18-alpine"

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

const { createDatabase } = await import("../../../../../packages/db/dist/index.mjs")
const { DB_TIMEOUT_MS, healthData, probeDb } =
  await import("../../../../../api/hono/src/lib/health")

// createDatabase's declared return type drops $client, so the close goes through one cast here.
const closeOf = (client: ReturnType<typeof createDatabase>) =>
  (client as unknown as { $client: { close(): Promise<void> } }).$client.close()

describe("probeDb", () => {
  test("names its budget, under the web's 2s abort", () => {
    expect(DB_TIMEOUT_MS).toBe(1_500)
  })

  test("a closed port reads unreachable at once, with the connection's own error", async () => {
    const client = createDatabase(CLOSED)
    const started = Date.now()
    const checked = await probeDb(client)
    const took = Date.now() - started
    if (checked.state !== "unreachable") throw new Error(`read ${checked.state}`)
    expect(checked.error.length).toBeGreaterThan(0)
    expect(took).toBeLessThan(DB_TIMEOUT_MS)
    await closeOf(client)
  })

  test("a server that accepts and never answers is unreachable within the timeout", async () => {
    // A database whose Docker has hung: TCP accepts, the Postgres handshake never finishes.
    const silent = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data() {},
        open() {},
      },
    })
    const client = createDatabase(`postgres://postgres:${PASSWORD}@127.0.0.1:${silent.port}/db`)
    try {
      const started = Date.now()
      const checked = await probeDb(client, 250)
      const took = Date.now() - started
      expect(checked).toEqual({
        state: "unreachable",
        error: "no answer from the database within 250ms",
      })
      expect(took).toBeGreaterThanOrEqual(250)
      expect(took).toBeLessThan(DB_TIMEOUT_MS)
    } finally {
      // Stopping the listener resets the socket, so the client's hung handshake settles and its close can finish.
      silent.stop(true)
      await closeOf(client)
    }
  })
})

describe.skipIf(!dockerUp())("with the database up", () => {
  let container = ""
  let client: ReturnType<typeof createDatabase>

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
      IMAGE,
    ])
      .stdout.toString()
      .trim()
    const port = Bun.spawnSync(["docker", "port", container, "5432/tcp"])
      .stdout.toString()
      .trim()
      .split(":")
      .at(-1)
    client = createDatabase(`postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`)
    for (let i = 0; i < 60; i++) {
      const checked = await probeDb(client, 500)
      if (checked.state === "ok") break
      await Bun.sleep(500)
    }
  }, 60_000)

  afterAll(async () => {
    if (client) await closeOf(client)
    if (container) Bun.spawnSync(["docker", "rm", "-fv", container])
  })

  test("select 1 reads ok", async () => {
    expect(await probeDb(client)).toEqual({ state: "ok" })
  })

  test("healthData reads ok and carries no error", async () => {
    const data = await healthData(client)
    expect(data.db).toBe("ok")
    expect(data.message).toBe("ok")
    expect("dbError" in data).toBe(false)
    expect(data.environment).toBe("test")
    expect(data.dashboard).toBe("fixture")
    expect(typeof data.version).toBe("string")
    expect(data.dispatcherSlots).toBeGreaterThanOrEqual(1)
  })
})

describe("healthData", () => {
  test("an unreachable database degrades the whole body, naming the error, within the budget", async () => {
    const client = createDatabase(CLOSED)
    const started = Date.now()
    const data = await healthData(client)
    const took = Date.now() - started
    expect(data.db).toBe("unreachable")
    expect(typeof data.dbError).toBe("string")
    expect((data.dbError ?? "").length).toBeGreaterThan(0)
    expect(data.message).toBe("degraded")
    expect(took).toBeLessThan(DB_TIMEOUT_MS + 500)
    // The fields today's consumers read ride along, in the body's A to Z order.
    expect(Object.keys(data)).toEqual([
      "db",
      "dbError",
      "dashboard",
      "dispatcherSlots",
      "environment",
      "message",
      "version",
    ])
    await closeOf(client)
  })
})
