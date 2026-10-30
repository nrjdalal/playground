import { afterAll, beforeAll, describe, expect, test } from "bun:test"

// The lock store against a throwaway Redis in Docker published on 127.0.0.1 only. Skipped where Docker is not running; the unreachable cases need no server.
const { lockStore } = await import("../../../../packages/redis/dist/index.mjs")

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

describe("the lock store with no Redis", () => {
  test("no URL is no store, so a caller keeps its lock folder", () => {
    expect(lockStore("")).toBeNull()
  })

  test("a URL nothing answers at throws RedisUnreachable, the one error a caller falls back on", async () => {
    const store = lockStore("redis://127.0.0.1:1")!
    const err = await store.take("lock", "112", 1000).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: "RedisUnreachable" })
    store.close()
  })

  test("a server that takes the connection and never replies times out as RedisUnreachable, and the next call tries afresh", async () => {
    const silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } })
    const store = lockStore(`redis://127.0.0.1:${silent.port}`)!
    try {
      for (let i = 0; i < 2; i++) {
        const started = Date.now()
        const err = await store.take("lock", "112", 1000).catch((e: unknown) => e)
        expect(err).toMatchObject({ name: "RedisUnreachable" })
        expect(Date.now() - started).toBeLessThan(4000)
      }
    } finally {
      store.close()
      silent.stop(true)
    }
  }, 15_000)
})

describe.skipIf(!dockerUp())("the lock store", () => {
  let container = ""
  let store: NonNullable<ReturnType<typeof lockStore>>

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
    store = lockStore(`redis://127.0.0.1:${port}`)!
    for (let i = 0; i < 60; i++) {
      try {
        await store.free("ready", "none")
        break
      } catch {
        await Bun.sleep(250)
      }
    }
  }, 60_000)

  afterAll(() => {
    store?.close()
    if (container)
      Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore", stdout: "ignore" })
  })

  test("one taker holds a key at a time, and a refusal names the holder", async () => {
    const first = await store.take("one", "112", 5000)
    expect(first).toHaveProperty("value")
    expect(await store.take("one", "150", 5000)).toEqual({ holder: "112" })
  })

  test("a key its holder stops renewing lapses, and the next taker gets it", async () => {
    expect(await store.take("lapse", "112", 100)).toHaveProperty("value")
    await Bun.sleep(250)
    expect(await store.take("lapse", "150", 5000)).toHaveProperty("value")
  })

  test("renewing keeps a key past its first time to live", async () => {
    const lock = await store.take("renew", "112", 1000)
    if (!("value" in lock)) throw new Error("not taken")
    for (let i = 0; i < 4; i++) {
      await Bun.sleep(400)
      expect(await store.renew("renew", lock.value, 1000)).toBe(true)
    }
    expect(await store.take("renew", "150", 5000)).toEqual({ holder: "112" })
  })

  test("only the value that took a key renews or frees it", async () => {
    const lock = await store.take("own", "112", 5000)
    if (!("value" in lock)) throw new Error("not taken")
    expect(await store.renew("own", "another 150", 5000)).toBe(false)
    expect(await store.free("own", "another 150")).toBe(false)
    expect(await store.free("own", lock.value)).toBe(true)
    expect(await store.take("own", "150", 5000)).toHaveProperty("value")
  })
})
