import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"

const API = resolve(import.meta.dir, "../../../../../../api/hono")
const SOCKET = join(API, "src/lib/yard/socket.ts")

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

// Two API instances on one throwaway Redis, each a child Bun in the API's folder, so its tsconfig's @/ resolves and KV_URL is read as its module loads.
describe.skipIf(!dockerUp())("Yard's socket across instances", () => {
  let container = ""
  let url = ""

  const env = () => ({
    HOME: process.env.HOME ?? "",
    KV_URL: url,
    NODE_ENV: "test",
    PATH: process.env.PATH ?? "",
    SKIP_ENV_VALIDATION: "true",
  })

  beforeAll(async () => {
    container = Bun.spawnSync([
      "docker",
      "run",
      "-d",
      "--rm",
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
      const ping = Bun.spawnSync(["docker", "exec", container, "redis-cli", "ping"])
      if (ping.stdout.toString().trim() === "PONG") break
      await Bun.sleep(250)
    }
  }, 60_000)

  afterAll(() => {
    if (container)
      Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore", stdout: "ignore" })
  })

  // a quiet instance once subscribed only on its own first publish, so its sockets missed every post from another instance
  test("a socket on an instance that has never posted gets a post from another", async () => {
    const listener = Bun.spawn(
      [
        "bun",
        "-e",
        `const { join } = await import(${JSON.stringify(SOCKET)}); join("bo", { send: (data) => { console.log(data); process.exit(0) } }); setTimeout(() => console.log("joined"), 1000); setTimeout(() => { console.log("none"); process.exit(1) }, 10_000)`,
      ],
      { cwd: API, env: env(), stderr: "pipe", stdout: "pipe" },
    )
    const reader = listener.stdout.getReader()
    let out = ""
    while (!out.includes("joined")) {
      const { done, value } = await reader.read()
      if (done) break
      out += new TextDecoder().decode(value)
    }
    const poster = Bun.spawnSync(
      [
        "bun",
        "-e",
        `const { publish } = await import(${JSON.stringify(SOCKET)}); await publish(["bo"], { channel: "c1", lastReadAt: "2026-10-31T00:00:00.000Z", type: "read" }); process.exit(0)`,
      ],
      { cwd: API, env: env(), timeout: 15_000 },
    )
    expect(poster.exitCode).toBe(0)
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      out += new TextDecoder().decode(value)
    }
    expect(await listener.exited).toBe(0)
    expect(out).toContain('"type":"read"')
  }, 30_000)
})
