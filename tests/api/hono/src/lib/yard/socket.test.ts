import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"

// The in-process cases run on one instance with no Redis, whatever KV_URL the runner's .env sets.
process.env.KV_URL = ""
const { join: hold, publish } = await import("../../../../../../api/hono/src/lib/yard/socket")

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
    const leaveSecond = hold("cy", { send: (data) => got.push(`second ${data}`) })
    leave()
    await publish(["cy"], { channel: "c1", lastReadAt: "2026-10-31T00:00:00.000Z", type: "read" })
    leaveSecond()
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

// A fake Redis that answers HELLO and SUBSCRIBE and never PUBLISH, hanging up on each connection hangUp names, counting connections and the most open at once.
const fakeRedis = (hangUp: (n: number) => boolean) => {
  const seen = { count: 0, live: 0, most: 0 }
  const server = Bun.listen<{ held: boolean }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      close: (socket) => {
        if (socket.data.held) seen.live--
      },
      data: (socket, data) => {
        const text = data.toString()
        if (text.includes("HELLO")) socket.write("%1\r\n+server\r\n+redis\r\n")
        else if (text.includes("SUBSCRIBE"))
          socket.write(">3\r\n$9\r\nsubscribe\r\n$4\r\nyard\r\n:1\r\n")
      },
      open: (socket) => {
        socket.data = { held: !hangUp(++seen.count) }
        if (!socket.data.held) return void socket.end()
        seen.most = Math.max(seen.most, ++seen.live)
      },
    },
  })
  return { seen, server }
}

// One instance as a child Bun on the fake Redis, running script after it imports socket.ts's join and publish.
const instance = async (port: number, script: string) =>
  Bun.spawn(
    [
      "bun",
      "-e",
      `const { join, publish } = await import(${JSON.stringify(SOCKET)}); ${script}; process.exit(0)`,
    ],
    {
      cwd: API,
      env: { ...instanceEnv(), KV_URL: `redis://127.0.0.1:${port}` },
      stderr: "ignore",
      stdout: "ignore",
    },
  ).exited

describe("Yard's socket on a fake Redis", () => {
  // a connect that failed after its subscribe left the subscriber live, so the next connect added a second and every frame arrived twice
  test("a connect that fails partway closes its subscriber, so one instance never holds two", async () => {
    const { seen, server } = fakeRedis((n) => n % 2 === 0)
    try {
      expect(
        await instance(
          server.port,
          `join("ek", { send() {} }); await Bun.sleep(1500); join("fy", { send() {} }); await Bun.sleep(1500)`,
        ),
      ).toBe(0)
      expect(seen.count).toBeGreaterThanOrEqual(4)
      expect(seen.most).toBe(1)
    } finally {
      server.stop(true)
    }
  }, 30_000)

  // a fan-out past its cap threw but kept the pair, so a Redis that connected and then stopped answering held every post 2 s until the process restarted
  test("a fan-out past its cap drops the pair, so the next publish connects again", async () => {
    const { seen, server } = fakeRedis(() => false)
    try {
      expect(
        await instance(
          server.port,
          `for (let i = 0; i < 3; i++) await publish(["gy"], { channel: "c1", lastReadAt: "2026-10-31T00:00:00.000Z", type: "read" }).catch(() => {})`,
        ),
      ).toBe(0)
      expect(seen.count).toBeGreaterThanOrEqual(6)
      expect(seen.most).toBeLessThanOrEqual(2)
    } finally {
      server.stop(true)
    }
  }, 30_000)

  // the retry connected a new pair after the last socket had left, so an idle instance stayed subscribed
  test("a retry armed while a socket was open connects nothing once the last socket has left", async () => {
    const { seen, server } = fakeRedis((n) => n % 2 === 0)
    try {
      expect(
        await instance(
          server.port,
          `const leave = join("hy", { send() {} }); await Bun.sleep(300); leave(); await Bun.sleep(2500)`,
        ),
      ).toBe(0)
      expect(seen.count).toBe(2)
    } finally {
      server.stop(true)
    }
  }, 30_000)
})

// Two API instances on one throwaway Redis, each a child Bun in the API's folder, so its tsconfig's @/ resolves and KV_URL is read as its module loads.
describe.skipIf(!dockerUp())("Yard's socket across instances", () => {
  let container = ""
  let url = ""
  // every listener this describe spawns, killed after it so a failed case leaves no child waiting on its own timer
  const children: Bun.Subprocess[] = []

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
    for (const child of children) child.kill()
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
    children.push(listener)
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
    children.push(listener)
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
