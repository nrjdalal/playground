import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"

import { join as hold, publish } from "../../../../../../api/hono/src/lib/yard/socket"

const API = resolve(import.meta.dir, "../../../../../../api/hono")
const SOCKET = join(API, "src/lib/yard/socket.ts")

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

const instanceEnv = () => ({
  HOME: process.env.HOME ?? "",
  NODE_ENV: "test",
  PATH: process.env.PATH ?? "",
  SKIP_ENV_VALIDATION: "true",
})

// hono/bun hands onClose a new context for the same socket, so a close that looked the socket up by its context removed nothing and closed sockets piled up
describe("Yard's socket on one instance", () => {
  test("the close join returns removes that socket alone, and the member's other socket still gets a post", async () => {
    const got: string[] = []
    const leave = hold("cy", { send: (data) => got.push(`first ${data}`) })
    hold("cy", { send: (data) => got.push(`second ${data}`) })
    leave()
    await publish(["cy"], { channel: "c1", lastReadAt: "2026-10-31T00:00:00.000Z", type: "read" })
    expect(got.map((line) => line.split(" ")[0])).toEqual(["second"])
  })

  test("a socket that throws on send leaves the member's other sockets their frame", async () => {
    const got: string[] = []
    const leaveBroken = hold("dy", {
      send: () => {
        throw new Error("closed under it")
      },
    })
    const leave = hold("dy", { send: (data) => got.push(data) })
    await publish(["dy"], { channel: "c1", lastReadAt: "2026-10-31T00:00:00.000Z", type: "read" })
    leaveBroken()
    leave()
    expect(got).toHaveLength(1)
  })
})

// A fake Redis that answers HELLO and SUBSCRIBE on each odd connection and hangs up on each even one, so every connect fails after its subscribe.
describe("Yard's socket on a Redis that drops its second connection", () => {
  // a connect that failed after its subscribe left the subscriber live, so the next connect added a second and every frame arrived twice
  test("a connect that fails partway closes its subscriber, so one instance never holds two", async () => {
    let count = 0
    let live = 0
    let most = 0
    const server = Bun.listen<{ subscriber: boolean }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        close: (socket) => {
          if (socket.data.subscriber) live--
        },
        data: (socket, data) => {
          const text = data.toString()
          if (text.includes("HELLO")) socket.write("%1\r\n+server\r\n+redis\r\n")
          else if (text.includes("SUBSCRIBE"))
            socket.write(">3\r\n$9\r\nsubscribe\r\n$4\r\nyard\r\n:1\r\n")
        },
        open: (socket) => {
          socket.data = { subscriber: ++count % 2 === 1 }
          if (!socket.data.subscriber) return void socket.end()
          most = Math.max(most, ++live)
        },
      },
    })
    const child = Bun.spawn(
      [
        "bun",
        "-e",
        `const { join } = await import(${JSON.stringify(SOCKET)}); join("ek", { send() {} }); await Bun.sleep(1500); join("fy", { send() {} }); await Bun.sleep(1500); process.exit(0)`,
      ],
      {
        cwd: API,
        env: { ...instanceEnv(), KV_URL: `redis://127.0.0.1:${server.port}` },
        stderr: "ignore",
        stdout: "ignore",
      },
    )
    expect(await child.exited).toBe(0)
    server.stop(true)
    expect(count).toBeGreaterThanOrEqual(4)
    expect(most).toBe(1)
  }, 30_000)
})

// Two API instances on one throwaway Redis, each a child Bun in the API's folder, so its tsconfig's @/ resolves and KV_URL is read as its module loads.
describe.skipIf(!dockerUp())("Yard's socket across instances", () => {
  let container = ""
  let url = ""

  const env = () => ({ ...instanceEnv(), KV_URL: url })

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

  // Bun reconnected a dropped subscriber without sending SUBSCRIBE again, and the cached publisher was never rebuilt, so every socket on the instance went silent
  test("after Redis drops every connection, a socket on another instance hears the next post, and the poster's next publish goes through", async () => {
    const listener = Bun.spawn(
      [
        "bun",
        "-e",
        `const { join } = await import(${JSON.stringify(SOCKET)}); let frames = 0; join("cy", { send: (data) => { console.log(data); if (++frames === 2) process.exit(0) } }); setTimeout(() => console.log("joined"), 1000); setTimeout(() => { console.log("none"); process.exit(1) }, 15_000)`,
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
    const poster = Bun.spawn(
      [
        "bun",
        "-e",
        `const { publish } = await import(${JSON.stringify(SOCKET)}); const frame = (at) => ({ channel: "c1", lastReadAt: at, type: "read" }); await publish(["cy"], frame("2026-10-31T00:00:01.000Z")); for (const type of ["pubsub", "normal"]) Bun.spawnSync(["docker", "exec", process.env.CONTAINER, "redis-cli", "CLIENT", "KILL", "TYPE", type]); await Bun.sleep(2500); await publish(["cy"], frame("2026-10-31T00:00:02.000Z")); process.exit(0)`,
      ],
      { cwd: API, env: { ...env(), CONTAINER: container }, stderr: "inherit", stdout: "ignore" },
    )
    expect(await poster.exited).toBe(0)
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      out += new TextDecoder().decode(value)
    }
    expect(await listener.exited).toBe(0)
    expect(out).toContain("00:00:02.000Z")
  }, 30_000)
})
