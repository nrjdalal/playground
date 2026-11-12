import { describe, expect, spyOn, test } from "bun:test"

import { type Bus, createHub, type Hub } from "../../../../../../api/hono/src/lib/relay/hub"
import { RELAY_REPLACED_CLOSE } from "../../../../../../api/hono/src/lib/relay/protocol"

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"
// a made-up public key, the shape the browser's P-256 key exports to
const KEY = {
  crv: "P-256" as const,
  kty: "EC" as const,
  x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
}
const AT = new Date("2026-11-05T01:00:00.000Z")

// A Mac's socket that keeps what the hub sends it.
const mac = () => {
  const sent: string[] = []
  return { send: (data: string) => void sent.push(data), sent }
}

const answer = (id: string, body = "ok", status = 200) =>
  JSON.stringify({
    body: Buffer.from(body).toString("base64"),
    headers: { "content-type": "text/plain" },
    id,
    status,
    type: "response",
  })

describe("the relay's hub", () => {
  test("sends a read to the owner's Mac with a fresh id and time, and passes its answer back", async () => {
    const hub = createHub({ id: () => ID, now: () => AT })
    const socket = mac()
    hub.attach("u1", socket)
    const forwarded = hub.forward("u1", "owner", "/api/v1/workers")
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      {
        at: AT.toISOString(),
        id: ID,
        login: "owner",
        method: "GET",
        path: "/api/v1/workers",
        type: "request",
      },
    ])
    hub.answer("u1", answer(ID, "workers"))
    const got = await forwarded
    expect(got.type).toBe("response")
    expect(got.type === "response" && Buffer.from(got.body, "base64").toString()).toBe("workers")
  })

  test("sends the owner's browser's key to the owner's Mac as a pair request, and passes its answer back", async () => {
    const hub = createHub({ id: () => ID, now: () => AT })
    const socket = mac()
    hub.attach("u1", socket)
    const paired = hub.pair("u1", "owner", KEY)
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { at: AT.toISOString(), id: ID, key: KEY, login: "owner", type: "pair" },
    ])
    hub.answer("u1", answer(ID, "held"))
    const got = await paired
    expect(got.type === "response" && Buffer.from(got.body, "base64").toString()).toBe("held")
  })

  test("drops an answer for an id it is not waiting on, or from another owner's socket", async () => {
    const hub = createHub({ id: () => ID, now: () => AT, timeoutMs: 50 })
    hub.attach("u1", mac())
    const forwarded = hub.forward("u1", "owner", "/api/v1/workers")
    hub.answer("u1", answer("00000000-0000-4000-8000-000000000000"))
    hub.answer("u2", answer(ID))
    hub.answer("u1", "not json")
    expect(await forwarded).toEqual({ type: "timeout" })
  })

  test("reads offline with no socket, and since when once the socket goes, failing what still waits", async () => {
    let now = AT
    const hub = createHub({ id: () => ID, now: () => now })
    expect(await hub.forward("u1", "owner", "/api/v1/workers")).toEqual({ type: "offline" })
    expect(await hub.status("u1")).toEqual({ online: false, since: null })
    const release = hub.attach("u1", mac())
    expect(await hub.status("u1")).toEqual({ online: true, since: null })
    const waiting = hub.forward("u1", "owner", "/api/v1/workers")
    now = new Date("2026-11-05T01:05:00.000Z")
    release()
    expect(await waiting).toEqual({ type: "offline" })
    expect(await hub.status("u1")).toEqual({ online: false, since: "2026-11-05T01:05:00.000Z" })
  })

  test("a newer socket replaces the old, and the old one's close leaves the newer in place", async () => {
    const hub = createHub()
    const release = hub.attach("u1", mac())
    hub.attach("u1", mac())
    release()
    expect((await hub.status("u1")).online).toBe(true)
  })
})

// Two instances on one fake bus, which hands each published message to every instance, the publisher's included, on a later tick, as Redis does.
const instances = (options: { ackMs?: number; now?: () => Date } = {}) => {
  const hubs: Hub[] = []
  const published: string[] = []
  let listening = 0
  const bus: Bus = {
    listen: () => void listening++,
    publish: async (data) => {
      published.push(data)
      await Bun.sleep(0)
      for (const one of hubs) one.receive(data)
    },
  }
  let n = 0
  const id = () => `00000000-0000-4000-8000-00000000000${n++}`
  hubs.push(createHub({ ...options, bus, id }), createHub({ ...options, bus, id }))
  return {
    holder: hubs[0]!,
    listening: () => listening,
    other: hubs[1]!,
    published,
    // puts bytes already on the bus on it again, as a publish whose first try landed and then reported closed re-sends them
    republish: (data: string) => bus.publish(data),
  }
}

// Two instances on one bus, the second cold: its first publish waits coldMs for its subscriber and sender to connect before the message reaches the bus, as a fresh instance's first Redis connect does.
const coldInstances = (coldMs: number, options: { ackMs?: number } = {}) => {
  const hubs: Hub[] = []
  const fan = async (data: string) => {
    await Bun.sleep(0)
    for (const one of hubs) one.receive(data)
  }
  let connected: Promise<void> | null = null
  const warm: Bus = { listen() {}, publish: fan }
  const cold: Bus = {
    listen() {},
    publish: async (data) => {
      connected ??= Bun.sleep(coldMs)
      await connected
      await fan(data)
    },
  }
  let n = 0
  const id = () => `00000000-0000-4000-8000-00000000001${n++}`
  hubs.push(createHub({ ...options, bus: warm, id }), createHub({ ...options, bus: cold, id }))
  return { holder: hubs[0]!, other: hubs[1]! }
}

describe("a Mac that goes silent", () => {
  // a sleeping Mac's half-open socket read online, so every read waited out its timeout and the page never said offline
  test("reads offline from when the hub last heard it, closes its socket and fails a read, while a heartbeat keeps it online", async () => {
    let now = AT
    const hub = createHub({ id: () => ID, now: () => now, silentMs: 45_000 })
    let closed = 0
    hub.attach("u1", { close: () => void closed++, send() {} })
    now = new Date(AT.getTime() + 30_000)
    hub.answer("u1", JSON.stringify({ type: "heartbeat" }))
    now = new Date(AT.getTime() + 70_000)
    expect(await hub.status("u1")).toEqual({ online: true, since: null })
    now = new Date(AT.getTime() + 80_000)
    expect(await hub.status("u1")).toEqual({
      online: false,
      since: new Date(AT.getTime() + 30_000).toISOString(),
    })
    expect(closed).toBe(1)
    expect(await hub.forward("u1", "owner", "/api/v1/workers")).toEqual({ type: "offline" })
  })

  // the hub never answered a heartbeat, so the Mac could not tell a socket the hub had dropped from a quiet one
  test("answers each heartbeat on the socket that sent it", () => {
    const hub = createHub()
    const socket = mac()
    hub.attach("u1", socket)
    hub.answer("u1", JSON.stringify({ type: "heartbeat" }), socket)
    expect(socket.sent).toEqual(['{"type":"heartbeat"}'])
  })
})

describe("the relay's hub across instances", () => {
  test("a read on another instance reaches the Mac's socket and comes back", async () => {
    const { holder, listening, other } = instances({ now: () => AT })
    const socket = {
      send: (data: string) => {
        const { id } = JSON.parse(data) as { id: string }
        setTimeout(() => holder.answer("u1", answer(id, "workers")), 5)
      },
    }
    holder.attach("u1", socket)
    expect(listening()).toBe(1)
    const got = await other.forward("u1", "owner", "/api/v1/workers")
    expect(got.type === "response" && Buffer.from(got.body, "base64").toString()).toBe("workers")
    expect(await other.status("u1")).toEqual({ online: true, since: null })
    expect(other.busy()).toBe(false)
  })

  // a publish whose first try landed and then reported closed puts the same request on the bus twice; the Mac refuses an id it answered already, and that refusal would settle the wait before the real answer, so the hub must drop the repeat before the Mac sees it
  test("a request the bus carries twice reaches the Mac once, and the wait settles on the real answer", async () => {
    const { holder, other, published, republish } = instances({ now: () => AT })
    const answered: string[] = []
    let received = 0
    holder.attach("u1", {
      send: (data: string) => {
        received++
        const { id } = JSON.parse(data) as { id: string }
        // the Mac answers a request it has answered already at once with the seen-id refusal, and the first copy's real answer takes longer than this test's whole retry window
        if (answered.includes(id))
          setTimeout(() => holder.answer("u1", answer(id, "answered already", 409)), 0)
        else {
          answered.push(id)
          setTimeout(() => holder.answer("u1", answer(id, "workers")), 30)
        }
      },
    })
    const forwarded = other.forward("u1", "owner", "/api/v1/workers")
    await Bun.sleep(10)
    expect(received).toBe(1)
    await republish(published[0]!)
    const got = await forwarded
    expect(got.type).toBe("response")
    expect(got.type === "response" && Buffer.from(got.body, "base64").toString()).toBe("workers")
    expect(got.type === "response" && got.status).toBe(200)
    expect(received).toBe(1)
  })

  // a cold instance spent its whole ack wait connecting to Redis, so a read and the status read offline while the Mac held its socket on another instance
  // each path meets its own cold first publish, so neither rides a bus the other warmed
  const coldPair = () => {
    const { holder, other } = coldInstances(60, { ackMs: 20 })
    holder.attach("u1", {
      send: (data: string) => {
        const { id } = JSON.parse(data) as { id: string }
        setTimeout(() => holder.answer("u1", answer(id, "workers")), 5)
      },
    })
    return other
  }

  test("on a cold instance, the status waits for the bus before the ack wait starts", async () => {
    expect(await coldPair().status("u1")).toEqual({ online: true, since: null })
  })

  test("on a cold instance, a read waits for the bus before the ack wait starts", async () => {
    const got = await coldPair().forward("u1", "owner", "/api/v1/workers")
    expect(got.type === "response" && Buffer.from(got.body, "base64").toString()).toBe("workers")
  })

  test("a publish that fails reads offline at once", async () => {
    const hub = createHub({
      ackMs: 10_000,
      bus: { listen() {}, publish: () => Promise.reject(new Error("down")) },
    })
    const started = performance.now()
    expect(await hub.status("u1")).toEqual({ online: false, since: null })
    expect(await hub.forward("u1", "owner", "/api/v1/workers")).toEqual({ type: "offline" })
    // long before the 10 s ack wait, which a failed publish never starts
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test("a pair request on another instance reaches the Mac's socket and comes back", async () => {
    const { holder, other } = instances({ now: () => AT })
    const frames: unknown[] = []
    holder.attach("u1", {
      send: (data: string) => {
        frames.push(JSON.parse(data))
        const { id } = JSON.parse(data) as { id: string }
        setTimeout(() => holder.answer("u1", answer(id, "held")), 5)
      },
    })
    const got = await other.pair("u1", "owner", KEY)
    expect(got.type === "response" && Buffer.from(got.body, "base64").toString()).toBe("held")
    expect(frames).toMatchObject([{ key: KEY, login: "owner", type: "pair" }])
  })

  test("with no instance holding the socket, a read and the status read offline once the ack wait passes", async () => {
    const { other } = instances({ ackMs: 20 })
    expect(await other.forward("u1", "owner", "/api/v1/workers")).toEqual({ type: "offline" })
    expect(await other.status("u1")).toEqual({ online: false, since: null })
  })

  test("a socket that goes fails what waits on another instance, and every instance learns since when", async () => {
    const { holder, other } = instances({ ackMs: 50, now: () => AT })
    const release = holder.attach("u1", { send() {} })
    const waiting = other.forward("u1", "owner", "/api/v1/workers")
    await Bun.sleep(10)
    release()
    expect(await waiting).toEqual({ type: "offline" })
    expect(await other.status("u1")).toEqual({ online: false, since: AT.toISOString() })
  })

  // a replaced socket's close published gone, which failed a read the Mac answered on its new socket on another instance
  test("a Mac that moves its socket to another instance stays online, and a read sent on the old socket gets its answer through the new one", async () => {
    const { holder, other } = instances({ ackMs: 50, now: () => AT })
    let sent = ""
    const release = holder.attach("u1", {
      send: (data) => void (sent = (JSON.parse(data) as { id: string }).id),
    })
    const forwarded = holder.forward("u1", "owner", "/api/v1/workers")
    other.attach("u1", mac())
    release()
    await Bun.sleep(80)
    other.answer("u1", answer(sent, "workers"))
    const got = await forwarded
    expect(got.type === "response" && Buffer.from(got.body, "base64").toString()).toBe("workers")
    expect(await holder.status("u1")).toEqual({ online: true, since: null })
    expect(await other.status("u1")).toEqual({ online: true, since: null })
  })

  // on each recycle the old socket's close put a ping, then gone, on the bus as its invocation ended, so both failed at the frozen instance's next thaw (#1537)
  test("a socket the Mac closes as replaced is let go with nothing on the bus, and the Mac stays online through its next one", async () => {
    const { holder, other, published } = instances({ ackMs: 50 })
    const release = holder.attach("u1", mac())
    other.attach("u1", mac())
    release(RELAY_REPLACED_CLOSE)
    await Bun.sleep(80)
    expect(published).toEqual([])
    expect(await holder.status("u1")).toEqual({ online: true, since: null })
  })

  test("a socket closed as replaced on a frozen instance's bus leaves no failed publish", async () => {
    const frozen: Bus = {
      listen() {},
      publish: async () => {
        throw new Error("Connection closed")
      },
    }
    const { lines } = await logged(async () => {
      const release = createHub({ ackMs: 50, bus: frozen }).attach("u1", mac())
      release(RELAY_REPLACED_CLOSE)
      await Bun.sleep(80)
    })
    expect(lines).toEqual([])
  })

  test("a close with no code, or any other, still asks the bus and then says gone, as an older Mac's does", async () => {
    for (const code of [undefined, 1000, 1006, 4401]) {
      const { holder, published } = instances({ ackMs: 20 })
      const release = holder.attach("u1", mac())
      release(code)
      await Bun.sleep(60)
      expect(published.map((one) => (JSON.parse(one) as { kind: string }).kind)).toEqual([
        "ping",
        "gone",
      ])
    }
  })

  test("an answer settles only a request its own owner's Mac was sent", async () => {
    const { holder, other } = instances({ ackMs: 1000 })
    let sent = ""
    holder.attach("u1", { send: (data) => void (sent = (JSON.parse(data) as { id: string }).id) })
    holder.attach("u2", { send() {} })
    const forwarded = other.forward("u1", "owner", "/api/v1/workers")
    await Bun.sleep(10)
    holder.answer("u2", answer(sent, "not yours"))
    await Bun.sleep(10)
    holder.answer("u1", answer(sent, "yours"))
    const got = await forwarded
    expect(got.type === "response" && Buffer.from(got.body, "base64").toString()).toBe("yours")
  })
})

// A write frame as the owner's browser signs it: its body here holds a word no log or store may keep.
const BODY = JSON.stringify({ text: "body-kept-nowhere" })
const WRITE = {
  at: AT.toISOString(),
  body: BODY,
  id: ID,
  keyId: "oKIywvGUpTVTyxMQ3bwIIeQUudfr_CkLMjCE19ECD-U",
  login: "owner",
  method: "POST" as const,
  path: "/api/v1/messages",
  sig: "c2lnbmVk",
  type: "write" as const,
}

// Every console line the hub writes while run runs, and run's result.
const logged = async <T>(run: () => Promise<T>) => {
  const spies = (["debug", "error", "info", "log", "warn"] as const).map((level) =>
    spyOn(console, level).mockImplementation(() => {}),
  )
  try {
    const result = await run()
    return {
      lines: spies.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(" "))),
      result,
    }
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

describe("a write through the hub", () => {
  test("reaches the owner's Mac as the browser signed it, and its answer comes back", async () => {
    const hub = createHub({ id: () => "not-used", now: () => AT })
    const socket = mac()
    hub.attach("u1", socket)
    const written = hub.write("u1", WRITE)
    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([WRITE])
    hub.answer("u1", answer(ID, "sent"))
    const got = await written
    expect(got.type === "response" && Buffer.from(got.body, "base64").toString()).toBe("sent")
  })

  test("keeps no body once it is answered: nothing waits, and no log line holds it", async () => {
    const hub = createHub({ now: () => AT })
    const release = hub.attach("u1", {
      send: (data: string) => setTimeout(() => hub.answer("u1", answer(JSON.parse(data).id)), 1),
    })
    const { lines } = await logged(() => hub.write("u1", WRITE))
    release()
    expect(hub.busy()).toBe(false)
    expect(lines.filter((line) => line.includes("body-kept-nowhere"))).toEqual([])
    const offline = createHub()
    const { lines: refused, result } = await logged(() => offline.write("u1", WRITE))
    expect([
      result,
      offline.busy(),
      refused.filter((line) => line.includes("body-kept-nowhere")),
    ]).toEqual([{ type: "offline" }, false, []])
  })

  test("on another instance reaches the Mac's socket and comes back, the body in transit alone", async () => {
    const { holder, other } = instances({ now: () => AT })
    const frames: unknown[] = []
    holder.attach("u1", {
      send: (data: string) => {
        frames.push(JSON.parse(data))
        setTimeout(() => holder.answer("u1", answer(ID, "sent")), 5)
      },
    })
    const got = await other.write("u1", WRITE)
    expect(got.type === "response" && Buffer.from(got.body, "base64").toString()).toBe("sent")
    expect(frames).toEqual([WRITE])
    expect(other.busy()).toBe(false)
  })
})
