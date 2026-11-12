import { describe, expect, test } from "bun:test"

const { redisChannel } = await import("../../../../../../api/hono/src/lib/yard/channel")

// A fake Redis on loopback, the pattern tests/api/hono/src/lib/yard/socket.test.ts uses, so no test reaches the hosted Redis: it answers HELLO and SUBSCRIBE, and each connection's PUBLISH follows its script. The connections open in the channel's own order, connect() building the subscriber first, then the sender, and a retried publish building a fresh pair after them: 1 the first subscriber, 2 the first sender, 3 the retry's subscriber, 4 the retry's sender.
type How = "ok" | "land-close" | "close" | "hang" | "readonly"

const feed = (
  state: { buf: string },
  chunk: string,
  onCommand: (words: string[]) => void,
): void => {
  state.buf += chunk
  for (;;) {
    const star = state.buf.indexOf("\r\n")
    if (star === -1) return
    const head = state.buf.slice(0, star)
    state.buf = state.buf.slice(star + 2)
    if (!head.startsWith("*")) continue
    const count = Number(head.slice(1))
    const words: string[] = []
    let at = 0
    let whole = true
    for (let i = 0; i < count; i++) {
      const dollar = state.buf.indexOf("\r\n", at)
      if (dollar === -1) {
        whole = false
        break
      }
      const len = Number(state.buf.slice(at + 1, dollar))
      const end = dollar + 2 + len
      if (state.buf.length < end) {
        whole = false
        break
      }
      words.push(state.buf.slice(dollar + 2, end))
      at = end + 2
    }
    if (!whole) {
      state.buf = `${head}\r\n${state.buf}`
      return
    }
    state.buf = state.buf.slice(at)
    onCommand(words)
  }
}

const fakeRedis = (howOf: (n: number, payload: string) => How) => {
  const sends: string[] = []
  const subscribers: { data: { sub: boolean }; write: (data: string) => void }[] = []
  let count = 0
  const server = Bun.listen<{ buf: string; n: number; sub: boolean }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open: (socket) => {
        socket.data = { buf: "", n: ++count, sub: false }
      },
      close: (socket) => {
        const at = subscribers.indexOf(socket)
        if (at !== -1) subscribers.splice(at, 1)
      },
      data: (socket, chunk) =>
        feed(socket.data, chunk.toString(), (words) => {
          const [command, name, payload] = words
          if (command === "HELLO") socket.write("%1\r\n+server\r\n+redis\r\n")
          else if (command === "SUBSCRIBE") {
            socket.data.sub = true
            subscribers.push(socket)
            socket.write(">3\r\n$9\r\nsubscribe\r\n$4\r\nyard\r\n:1\r\n")
          } else if (command === "PUBLISH") {
            sends.push(payload ?? "")
            const how = howOf(socket.data.n, payload ?? "")
            if (how === "ok" || how === "land-close") {
              for (const one of subscribers.filter((s) => s.data.sub))
                one.write(
                  `>3\r\n$7\r\nmessage\r\n$4\r\n${name}\r\n$${Buffer.byteLength(payload ?? "")}\r\n${payload}\r\n`,
                )
              // The command landed, so the fan-out went out either way; ok answers the publisher too, while land-close takes the reply away with the closing socket.
              if (how === "ok") socket.write(`:${subscribers.filter((s) => s.data.sub).length}\r\n`)
            }
            if (how === "readonly")
              socket.write("-READONLY you can't write against a read only replica\r\n")
            if (how === "land-close" || how === "close") socket.end()
            // hang: no reply at all, so the client waits until the cap fires
          }
        }),
    },
  })
  return { sends, server, stop: () => server.stop(true) }
}

// A publish answers once Redis takes it, so its fan-out can reach the subscriber a moment later: wait up to 1 s for done, then 50 ms more so a doubled delivery has its chance to show.
const settled = async (done: () => boolean): Promise<void> => {
  for (let wait = 0; wait < 100 && !done(); wait++) await Bun.sleep(10)
  await Bun.sleep(50)
}

describe("the yard channel's publish", () => {
  test("a first publish on a closed connection still fans out, on a fresh pair", async () => {
    let delivered = ""
    const redis = fakeRedis((n) => (n === 2 ? "close" : "ok"))
    try {
      let want = false
      const channel = redisChannel({
        name: "yard",
        onMessage: (raw) => (delivered = String(raw)),
        url: `redis://127.0.0.1:${redis.server.port}`,
        wanted: () => want,
      })
      want = true
      await channel.publish("frame-1")
      await settled(() => delivered !== "")
      want = false
      expect(delivered).toBe("frame-1")
    } finally {
      redis.stop()
    }
  })

  // canary holds this one already: it never retries, so a failure of any other kind leaves the one pair alone
  test("any other failure does not retry", async () => {
    const redis = fakeRedis((n) => (n === 2 ? "readonly" : "ok"))
    try {
      let want = false
      const channel = redisChannel({
        name: "yard",
        onMessage: () => {},
        url: `redis://127.0.0.1:${redis.server.port}`,
        wanted: () => want,
      })
      want = true
      const error = await channel.publish("frame-1").then(
        () => null,
        (e) => e as Error,
      )
      want = false
      expect(error?.message).toContain("READONLY")
    } finally {
      redis.stop()
    }
  })

  test("a retry still answers inside the 2 s cap, and a plain hang fails inside it", async () => {
    const redis = fakeRedis((n) => (n === 2 ? "close" : "hang"))
    try {
      let want = false
      const channel = redisChannel({
        name: "yard",
        onMessage: () => {},
        url: `redis://127.0.0.1:${redis.server.port}`,
        wanted: () => want,
      })
      want = true
      const at = Date.now()
      const error = await channel.publish("frame-1").then(
        () => null,
        (e) => e as Error,
      )
      const took = Date.now() - at
      want = false
      expect(error?.message).toContain("Redis took no fan-out in 2000 ms")
      expect(took).toBeGreaterThanOrEqual(1900)
      expect(took).toBeLessThan(3500)
    } finally {
      redis.stop()
    }
    const plain = fakeRedis(() => "hang")
    try {
      let want = false
      const channel = redisChannel({
        name: "yard",
        onMessage: () => {},
        url: `redis://127.0.0.1:${plain.server.port}`,
        wanted: () => want,
      })
      want = true
      const failed = await channel.publish("frame-2").then(
        () => null,
        (e) => e as Error,
      )
      want = false
      expect(failed?.message).toContain("Redis took no fan-out in 2000 ms")
    } finally {
      plain.stop()
    }
  }, 20_000)

  test("a publish whose first try landed and then reported a closed connection is delivered once, by the message's own id", async () => {
    const got: string[] = []
    const redis = fakeRedis((n) => (n === 2 ? "land-close" : "ok"))
    try {
      let want = false
      const channel = redisChannel({
        id: (raw) => {
          try {
            return (JSON.parse(raw) as { id?: string }).id
          } catch {
            return undefined
          }
        },
        name: "yard",
        onMessage: (raw) => got.push(String(raw)),
        url: `redis://127.0.0.1:${redis.server.port}`,
        wanted: () => want,
      })
      want = true
      const frame = JSON.stringify({ id: "m-1", text: "hi" })
      await channel.publish(frame)
      await settled(() => got.length > 0)
      want = false
      expect(redis.sends).toEqual([frame, frame])
      expect(got).toEqual([frame])
    } finally {
      redis.stop()
    }
  })

  test("the retried frame is byte-equal to the first, with no new signing", async () => {
    const redis = fakeRedis((n) => (n === 2 ? "land-close" : "ok"))
    try {
      let want = false
      const channel = redisChannel({
        name: "yard",
        onMessage: () => {},
        url: `redis://127.0.0.1:${redis.server.port}`,
        wanted: () => want,
      })
      want = true
      const frame = JSON.stringify({ id: "w-1", sig: "the-signed-bytes", type: "write" })
      await channel.publish(frame)
      want = false
      expect(redis.sends).toEqual([frame, frame])
    } finally {
      redis.stop()
    }
  })

  test("two publishes at once on a closed connection both fan out, the second retry keeping the first's fresh pair", async () => {
    const got: string[] = []
    const redis = fakeRedis((n) => (n === 2 ? "close" : "ok"))
    try {
      let want = false
      const channel = redisChannel({
        name: "yard",
        onMessage: (raw) => got.push(String(raw)),
        url: `redis://127.0.0.1:${redis.server.port}`,
        wanted: () => want,
      })
      want = true
      const results = await Promise.allSettled([channel.publish("a"), channel.publish("b")])
      await settled(() => got.length >= 2)
      want = false
      expect(results.map((one) => one.status)).toEqual(["fulfilled", "fulfilled"])
      expect(got.toSorted()).toEqual(["a", "b"])
    } finally {
      redis.stop()
    }
  })
})
