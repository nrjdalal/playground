import { describe, expect, spyOn, test } from "bun:test"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "relay-mac-test-secret-not-for-use-anywhere"
const { answerRelay, CONNECT_MS, RECYCLE_MS, requireRelay, requireSignedWrite, startRelay } =
  await import("../../../../../../api/hono/src/lib/relay/mac")
const { keyIdOf, pairKeySchema, signedBytes } =
  await import("../../../../../../packages/message/src/index")
const { RELAY_MAX_AGE_MS } = await import("../../../../../../api/hono/src/lib/relay/protocol")
const { dashboardRouter } = await import("../../../../../../api/hono/src/routers/dashboard")
const { errorHandler } = await import("../../../../../../api/hono/src/lib/error")
const { Hono } = await import("../../../../../../api/hono/node_modules/hono")

const NOW = new Date("2026-11-05T01:00:00.000Z")
const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"

const frame = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    at: NOW.toISOString(),
    id: ID,
    login: "owner",
    method: "GET",
    path: "/api/v1/workers",
    type: "request",
    ...over,
  })

const words = (body: string) => JSON.parse(Buffer.from(body, "base64").toString())

// A dispatch that records each request it is handed, so a refusal can show it ran nothing.
const spy = () => {
  const reached: string[] = []
  const dispatch = async (request: Request) => {
    reached.push(new URL(request.url).pathname)
    return new Response("{}", { headers: { "content-type": "application/json" } })
  }
  return { dispatch, reached }
}

const deps = (dispatch: (request: Request) => Promise<Response>) => ({
  cookie: async () => "session=fake",
  dispatch,
  login: "Owner",
  now: NOW,
  seen: new Map<string, number>(),
})

describe("requireRelay, on this Mac", () => {
  test("passes a fresh GET on the allowlist for this Mac's own owner, the login in any case", () => {
    const checked = requireRelay(frame(), { login: "OWNER", now: NOW, seen: new Map() })
    expect(checked && "request" in checked && checked.request.path).toBe("/api/v1/workers")
  })

  test("gives no answer to a frame with no readable request", () => {
    for (const raw of ["not json", "{}", frame({ id: "not-a-uuid" }), frame({ method: "POST" })])
      expect(requireRelay(raw, { login: "owner", now: NOW, seen: new Map() })).toBeNull()
  })
})

describe("a relayed read refused never reaches a route", () => {
  const refused = async (raw: string, seen = new Map<string, number>()) => {
    const { dispatch, reached } = spy()
    const answer = await answerRelay(raw, { ...deps(dispatch), seen })
    return { answer, message: answer ? words(answer.body).error.message : null, reached }
  }

  test("an id answered already", async () => {
    const seen = new Map<string, number>()
    const { dispatch, reached } = spy()
    await answerRelay(frame(), { ...deps(dispatch), seen })
    const again = await answerRelay(frame(), { ...deps(dispatch), seen })
    expect([again?.status, reached]).toEqual([409, ["/api/v1/workers"]])
  })

  test("a request as old as the limit, or as far ahead", async () => {
    for (const shift of [-RELAY_MAX_AGE_MS, RELAY_MAX_AGE_MS]) {
      const at = new Date(NOW.getTime() + shift).toISOString()
      const { answer, message, reached } = await refused(frame({ at }))
      expect([answer?.status, message, reached]).toEqual([
        403,
        "This request is too old to answer",
        [],
      ])
    }
  })

  test("a login other than this Mac's own token's", async () => {
    const { answer, message, reached } = await refused(frame({ login: "someone" }))
    expect([answer?.status, message, reached]).toEqual([
      403,
      "This Mac answers its own owner alone",
      [],
    ])
  })

  test("the passwordless sign-in and every first-run route", async () => {
    for (const path of [
      "/api/v1/onboard/sign-in",
      "/api/v1/onboard/finish",
      "/api/v1/onboard/checks",
    ]) {
      const { answer, message, reached } = await refused(frame({ id: crypto.randomUUID(), path }))
      expect([answer?.status, message, reached]).toEqual([403, "Answer on the Mac", []])
    }
  })

  test("a path off the allowlist", async () => {
    const { answer, reached } = await refused(frame({ path: "/api/v1/accounts" }))
    expect([answer?.status, reached]).toEqual([403, []])
  })
})

describe("a relayed read that passes", () => {
  // The local API's dashboard router at its own mount, as local.ts serves it.
  const app = new Hono().route("/api/v1", dashboardRouter)
  app.onError(errorHandler)

  test("enters the dashboard router in process, whose own owner check still runs on this Mac", async () => {
    const answer = await answerRelay(frame(), {
      ...deps((request) => Promise.resolve(app.fetch(request))),
      cookie: async () => "",
    })
    expect(answer?.id).toBe(ID)
    expect(answer?.status).toBe(401)
    expect(words(answer!.body).error.code).toBe("UNAUTHORIZED")
  })

  // the frame carried the content type alone, so a download lost its file name on the hosted origin
  test("carries the answer's status, its type and file name, and its bytes back, and no other header", async () => {
    const answer = await answerRelay(frame(), {
      ...deps(
        async () =>
          new Response(new Uint8Array([0, 255, 7]), {
            headers: {
              "content-disposition": 'attachment; filename="a.png"',
              "content-type": "image/png",
              "set-cookie": "kept=here",
            },
            status: 200,
          }),
      ),
    })
    expect([answer?.status, answer?.headers, [...Buffer.from(answer!.body, "base64")]]).toEqual([
      200,
      { "content-disposition": 'attachment; filename="a.png"', "content-type": "image/png" },
      [0, 255, 7],
    ])
  })

  test("carries the local owner's cookie, which never leaves this Mac", async () => {
    let cookie = null as string | null
    await answerRelay(frame(), {
      ...deps(async (request) => {
        cookie = request.headers.get("cookie")
        return new Response("{}")
      }),
    })
    expect(cookie).toBe("session=fake")
  })
})

// A browser's key made for the test alone, as the hosted web makes one: P-256, its private half never exported.
const browserKey = async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ])
  const key = pairKeySchema.parse(await crypto.subtle.exportKey("jwk", pair.publicKey))
  const { fingerprint, id } = await keyIdOf(key)
  return { fingerprint, id, key, privateKey: pair.privateKey }
}

const WRITES = ["/api/v1/messages", "/api/v1/inbox/:id/answer"] as const

// A write frame signed by signer over signedBytes, with over in place before it signs and after it signs.
const signed = async (
  signer: CryptoKey,
  keyId: string,
  over: Record<string, unknown> = {},
  after: Record<string, unknown> = {},
) => {
  const write = {
    at: NOW.toISOString(),
    body: JSON.stringify({ text: "hello" }),
    id: crypto.randomUUID(),
    keyId,
    login: "owner",
    method: "POST",
    path: "/api/v1/messages",
    type: "write",
    ...over,
  }
  const sig = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    signer,
    await signedBytes(write),
  )
  return JSON.stringify({ ...write, sig: Buffer.from(sig).toString("base64url"), ...after })
}

const browser = await browserKey()

describe("requireSignedWrite, a write from Yard signed by the paired key", () => {
  const paired = {
    fingerprint: browser.fingerprint,
    id: browser.id,
    key: browser.key,
    login: "Owner",
    pairedAt: NOW.toISOString(),
  }
  const check = (raw: string, over: Record<string, unknown> = {}) =>
    requireSignedWrite(raw, {
      key: paired,
      login: "owner",
      now: NOW,
      seen: new Map(),
      writes: WRITES,
      ...over,
    })
  const refusal = async (raw: string, over: Record<string, unknown> = {}) => {
    const checked = await check(raw, over)
    if (!checked || !("refused" in checked)) return checked
    const { error } = JSON.parse(Buffer.from(checked.refused.body, "base64").toString())
    return [checked.refused.status, error.message]
  }

  test("passes a fresh write the paired key signed, for this Mac's owner, on the write list", async () => {
    const checked = await check(await signed(browser.privateKey, browser.id))
    expect(checked && "write" in checked && checked.write.path).toBe("/api/v1/messages")
  })

  test("gives no answer to a frame with no readable write", async () => {
    for (const raw of ["not json", "{}", frame()]) expect(await check(raw)).toBeNull()
  })

  test("refuses an id seen before, a read's included, since the two share seen", async () => {
    const seen = new Map<string, number>()
    const raw = await signed(browser.privateKey, browser.id)
    await check(raw, { seen })
    expect(await refusal(raw, { seen })).toEqual([409, "This request was answered already"])
  })

  test("refuses a write as old as the limit, or as far ahead", async () => {
    for (const shift of [-RELAY_MAX_AGE_MS, RELAY_MAX_AGE_MS]) {
      const at = new Date(NOW.getTime() + shift).toISOString()
      expect(await refusal(await signed(browser.privateKey, browser.id, { at }))).toEqual([
        403,
        "This request is too old to answer",
      ])
    }
  })

  test("refuses a login other than this Mac's token's, or other than the paired key's", async () => {
    const raw = await signed(browser.privateKey, browser.id, { login: "someone" })
    expect(await refusal(raw)).toEqual([403, "This Mac answers its own owner alone"])
    const theirs = await signed(browser.privateKey, browser.id, { login: "someone" })
    expect(await refusal(theirs, { login: "someone" })).toEqual([
      403,
      "This Mac answers its own owner alone",
    ])
  })

  test("refuses a path off the write list, a read's and a dot segment's included", async () => {
    for (const path of ["/api/v1/accounts", "/api/v1/workers", "/api/v1/messages/../accounts"])
      expect(await refusal(await signed(browser.privateKey, browser.id, { path }))).toEqual([
        403,
        "Send it on the Mac",
      ])
  })

  test("refuses a key other than the paired one, and any key once none is paired", async () => {
    const other = await browserKey()
    expect(await refusal(await signed(other.privateKey, other.id))).toEqual([
      403,
      "This browser's key is not paired with this Mac",
    ])
    expect(await refusal(await signed(browser.privateKey, browser.id), { key: null })).toEqual([
      403,
      "This browser's key is not paired with this Mac",
    ])
  })

  test("refuses a signature that does not verify: another key's under the paired id, or a body changed after signing", async () => {
    const other = await browserKey()
    for (const raw of [
      await signed(other.privateKey, browser.id),
      await signed(browser.privateKey, browser.id, {}, { body: JSON.stringify({ text: "rm" }) }),
      await signed(browser.privateKey, browser.id, {}, { sig: "AAAA" }),
    ])
      expect(await refusal(raw)).toEqual([403, "This write's signature does not verify"])
  })
})

describe("a pair request from the relay", () => {
  test("waits for the owner's Approve with its key and login, and is answered with the key's fingerprint", async () => {
    const offered: unknown[] = []
    const { dispatch, reached } = spy()
    const answer = await answerRelay(
      JSON.stringify({
        at: NOW.toISOString(),
        id: ID,
        key: browser.key,
        login: "owner",
        type: "pair",
      }),
      {
        ...deps(dispatch),
        keys: {
          offer: async (pair) => {
            offered.push(pair)
            return {
              at: NOW.toISOString(),
              fingerprint: browser.fingerprint,
              id: pair.id,
              key: pair.key,
              login: pair.login,
            }
          },
        },
      },
    )
    expect([answer?.status, answer && words(answer.body), offered, reached]).toEqual([
      202,
      { data: { fingerprint: browser.fingerprint } },
      [{ at: NOW.toISOString(), id: ID, key: browser.key, login: "owner", type: "pair" }],
      [],
    ])
  })

  test("is refused, and held nowhere, for a login other than this Mac's token's or once it is stale", async () => {
    const offered: unknown[] = []
    const keys = {
      offer: async (pair: never) => {
        offered.push(pair)
        return null as never
      },
    }
    const old = new Date(NOW.getTime() - RELAY_MAX_AGE_MS).toISOString()
    for (const over of [{ login: "someone" }, { at: old }]) {
      const pair = {
        at: NOW.toISOString(),
        id: crypto.randomUUID(),
        key: browser.key,
        login: "owner",
        type: "pair",
        ...over,
      }
      const answer = await answerRelay(JSON.stringify(pair), { ...deps(spy().dispatch), keys })
      expect(answer?.status).toBe(403)
    }
    expect(offered).toEqual([])
  })
})

// A socket startRelay holds, opened, fed and closed by the test, keeping what the relay sent it.
type Fake = {
  addEventListener: (
    type: "close" | "message" | "open",
    listener: (event: { code?: number; data?: unknown; reason?: string }) => void,
  ) => void
  // a code and reason, as the hub's close of a refused socket carries
  close: (code?: number, reason?: string) => void
  feed: (data: string) => void
  open: () => void
  readyState: number
  send: (data: string) => void
  sent: string[]
  token: string
  url: string
}

const sockets = () => {
  const made: Fake[] = []
  const connect = (url: URL, token: string) => {
    const on = { close: [], message: [], open: [] } as Record<
      string,
      ((event: { code?: number; data?: unknown; reason?: string }) => void)[]
    >
    const one: Fake = {
      addEventListener: (type, listener) => void on[type]!.push(listener),
      close: (code, reason) => {
        if (one.readyState === 3) return
        one.readyState = 3
        for (const listener of on.close!) listener({ code, reason })
      },
      feed: (data) => {
        for (const listener of on.message!) listener({ data })
      },
      open: () => {
        one.readyState = 1
        for (const listener of on.open!) listener({})
      },
      readyState: 0,
      send: (data) => void one.sent.push(data),
      sent: [],
      token,
      url: String(url),
    }
    made.push(one)
    return one
  }
  return { connect, made }
}

const until = async (what: string, done: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (!done()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await Bun.sleep(5)
  }
}

const relay = (
  connect: ReturnType<typeof sockets>["connect"],
  over: Record<string, unknown> = {},
) =>
  startRelay({
    api: "https://yard.example.com",
    connect,
    cookie: async () => "session=fake",
    dispatch: async () =>
      new Response('{"data":[]}', { headers: { "content-type": "application/json" } }),
    login: async () => "owner",
    token: async () => "yard_fake",
    ...over,
  })

describe("startRelay, this Mac's socket to the hub", () => {
  test("connects to the hub's socket over wss with the token, answers a read on it, and sends a heartbeat", async () => {
    const { connect, made } = sockets()
    const stop = relay(connect, { heartbeatMs: 20 })
    try {
      await until("the socket", () => made.length === 1)
      expect([made[0]!.url, made[0]!.token]).toEqual([
        "wss://yard.example.com/api/v1/yard/relay/socket",
        "yard_fake",
      ])
      made[0]!.open()
      made[0]!.feed(frame({ at: new Date().toISOString(), id: crypto.randomUUID() }))
      await until("an answer", () => made[0]!.sent.some((one) => one.includes('"response"')))
      await until("a heartbeat", () => made[0]!.sent.includes('{"type":"heartbeat"}'))
    } finally {
      stop()
    }
  })

  test("a login that fails, an upgrade the hub refuses and a drop each open again after the backoff", async () => {
    const { connect, made } = sockets()
    let logins = 0
    const stop = relay(connect, {
      login: async () => {
        if (++logins === 1) throw new Error("the hub did not answer")
        return "owner"
      },
    })
    try {
      await until("the first socket, after the login's retry", () => made.length === 1)
      made[0]!.close()
      await until("a socket after the refused upgrade", () => made.length === 2)
      made[1]!.open()
      made[1]!.close()
      await until("a socket after the drop", () => made.length === 3)
    } finally {
      stop()
    }
  }, 15_000)

  // the recycle closed the socket before it opened the next, so a status read in the gap swapped the dashboard for the offline line
  test("the recycle opens the next socket before it lets the old one go", async () => {
    const { connect, made } = sockets()
    const stop = relay(connect, { recycleMs: 30 })
    try {
      await until("the socket", () => made.length === 1)
      made[0]!.open()
      await until("the next socket", () => made.length === 2)
      expect(made[0]!.readyState).toBe(1)
      made[1]!.open()
      expect(made[0]!.readyState).toBe(3)
      expect(made).toHaveLength(2)
    } finally {
      stop()
    }
  })

  test("a next socket that never opens leaves the old one holding the relay", async () => {
    const { connect, made } = sockets()
    const stop = relay(connect, { recycleMs: 30 })
    try {
      await until("the socket", () => made.length === 1)
      made[0]!.open()
      await until("the next socket", () => made.length === 2)
      made[1]!.close()
      expect(made[0]!.readyState).toBe(1)
      await until("another try", () => made.length === 3)
    } finally {
      stop()
    }
  })

  // the recycle closed the old socket on the new one's open, so a read it was still answering never reached the hub
  test("a read in flight across a recycle gets its answer, on the old socket while it is open and on the new one once it is not", async () => {
    const { connect, made } = sockets()
    const held: (() => void)[] = []
    const stop = relay(connect, {
      dispatch: async () => {
        await new Promise<void>((resolve) => held.push(resolve))
        return new Response('{"data":[]}', { headers: { "content-type": "application/json" } })
      },
      recycleMs: 30,
    })
    const answered = (one: Fake) => one.sent.some((data) => data.includes('"response"'))
    try {
      await until("the socket", () => made.length === 1)
      made[0]!.open()
      made[0]!.feed(frame({ at: new Date().toISOString(), id: crypto.randomUUID() }))
      await until("the read", () => held.length === 1)
      await until("the next socket", () => made.length === 2)
      made[1]!.open()
      expect(made[0]!.readyState).toBe(1)
      held[0]!()
      await until("the answer on the old socket", () => answered(made[0]!))
      await until("the old socket closing", () => made[0]!.readyState === 3)
      made[1]!.feed(frame({ at: new Date().toISOString(), id: crypto.randomUUID() }))
      await until("the second read", () => held.length === 2)
      await until("the third socket", () => made.length === 3)
      made[2]!.open()
      made[1]!.close()
      held[1]!()
      await until("the answer on the new socket", () => answered(made[2]!))
    } finally {
      stop()
    }
  })

  // a next socket that died while the old one still owed an answer fell back to the retiring old one, whose own close retried again, so two sockets opened
  test("a next socket that dies while the old one finishes its answer opens one socket again, not two", async () => {
    const { connect, made } = sockets()
    const held: (() => void)[] = []
    const stop = relay(connect, {
      dispatch: async () => {
        await new Promise<void>((resolve) => held.push(resolve))
        return new Response('{"data":[]}', { headers: { "content-type": "application/json" } })
      },
      recycleMs: 30,
    })
    try {
      await until("the socket", () => made.length === 1)
      made[0]!.open()
      made[0]!.feed(frame({ at: new Date().toISOString(), id: crypto.randomUUID() }))
      await until("the read", () => held.length === 1)
      await until("the next socket", () => made.length === 2)
      made[1]!.open()
      made[1]!.close()
      held[0]!()
      await until("the old socket closing", () => made[0]!.readyState === 3)
      await until("a socket after the backoff", () => made.length === 3)
      await Bun.sleep(2500)
      expect(made).toHaveLength(3)
    } finally {
      stop()
    }
  }, 15_000)

  // a socket the hub had dropped stayed open on this Mac, so the Mac read as offline until the recycle
  test("a hub gone silent closes the socket and opens a new one, while its answered heartbeats keep it", async () => {
    const { connect, made } = sockets()
    const stop = relay(connect, { heartbeatMs: 10, silentMs: 60 })
    try {
      await until("the socket", () => made.length === 1)
      made[0]!.open()
      for (let i = 0; i < 6; i++) {
        await Bun.sleep(20)
        made[0]!.feed('{"type":"heartbeat"}')
      }
      expect(made[0]!.readyState).toBe(1)
      await until("the silent socket closing", () => made[0]!.readyState === 3)
      await until("a new socket", () => made.length === 2)
    } finally {
      stop()
    }
  })

  // Vercel ended each hosted socket at its 300 s default duration, so a recycle planned for its 800 s cap never came and the relay dropped every 5 min
  test("the recycle and its connect timeout both fall inside the hosted function's 300 s", () => {
    expect(RECYCLE_MS + CONNECT_MS).toBeLessThan(300_000)
  })

  // after a live roll the hub never answered the upgrade, so the socket sat in CONNECTING with no close event, no retry and no log line
  test("a socket that never opens is closed at the connect timeout, says so, and opens again after the backoff", async () => {
    const said = spyOn(console, "error").mockImplementation(() => {})
    const { connect, made } = sockets()
    const stop = relay(connect, { connectMs: 30 })
    try {
      await until("the socket", () => made.length === 1)
      await until("the stalled socket closing", () => made[0]!.readyState === 3)
      expect(said.mock.calls.flat().join(" ")).toContain("[relay] the hub did not answer")
      await until("a new socket", () => made.length === 2)
    } finally {
      stop()
      said.mockRestore()
    }
  })

  test("a socket that opens and then closes says each, and opens again after the backoff", async () => {
    const told = spyOn(console, "log").mockImplementation(() => {})
    const said = spyOn(console, "error").mockImplementation(() => {})
    const { connect, made } = sockets()
    const stop = relay(connect)
    try {
      await until("the socket", () => made.length === 1)
      made[0]!.open()
      expect(told.mock.calls.flat().join(" ")).toContain("[relay] connected")
      made[0]!.close()
      expect(said.mock.calls.flat().join(" ")).toContain("[relay] the socket closed")
      await until("a new socket", () => made.length === 2)
    } finally {
      stop()
      told.mockRestore()
      said.mockRestore()
    }
  })

  test("a recycle's next socket that never opens is closed at the connect timeout while the old one keeps the relay, and another follows", async () => {
    const said = spyOn(console, "error").mockImplementation(() => {})
    const { connect, made } = sockets()
    const stop = relay(connect, { connectMs: 40, recycleMs: 30 })
    try {
      await until("the socket", () => made.length === 1)
      made[0]!.open()
      await until("the next socket", () => made.length === 2)
      await until("the stalled next socket closing", () => made[1]!.readyState === 3)
      expect(made[0]!.readyState).toBe(1)
      await until("another try", () => made.length === 3)
    } finally {
      stop()
      said.mockRestore()
    }
  })

  // the holding socket's drop returned before its log line, so the dev.log read two connected lines with no drop between them
  test("the old socket dropping while the recycle's next one connects says so, and the next one's open says connected", async () => {
    const told = spyOn(console, "log").mockImplementation(() => {})
    const said = spyOn(console, "error").mockImplementation(() => {})
    const { connect, made } = sockets()
    const stop = relay(connect, { recycleMs: 30 })
    try {
      await until("the socket", () => made.length === 1)
      made[0]!.open()
      await until("the next socket", () => made.length === 2)
      made[0]!.close()
      expect(said.mock.calls.flat().join(" ")).toContain(
        "[relay] the socket closed; the next socket is still connecting",
      )
      made[1]!.open()
      expect(
        told.mock.calls.flat().filter((line) => String(line).includes("[relay] connected")),
      ).toHaveLength(2)
    } finally {
      stop()
      told.mockRestore()
      said.mockRestore()
    }
  })

  // with no token it tries again only after RETRY_MAX_MS, a minute no dep shortens
  test("no token in the Keychain opens no socket", async () => {
    const { connect, made } = sockets()
    const stop = relay(connect, { token: async () => null })
    try {
      await Bun.sleep(100)
      expect(made).toHaveLength(0)
    } finally {
      stop()
    }
  })

  test("a socket the hub refuses says the close code and reason it carries", async () => {
    const said = spyOn(console, "error").mockImplementation(() => {})
    const { connect, made } = sockets()
    const stop = relay(connect)
    try {
      await until("the socket", () => made.length === 1)
      made[0]!.open()
      made[0]!.close(4401, "Unauthorized")
      expect(said.mock.calls.flat().join(" ")).toContain(
        "[relay] the socket closed (4401 Unauthorized)",
      )
    } finally {
      stop()
      said.mockRestore()
    }
  })

  test("stop closes the socket, and one still connecting, and opens no other", async () => {
    const { connect, made } = sockets()
    const stop = relay(connect, { recycleMs: 30 })
    await until("the socket", () => made.length === 1)
    made[0]!.open()
    await until("the next socket", () => made.length === 2)
    stop()
    expect([made[0]!.readyState, made[1]!.readyState]).toEqual([3, 3])
    await Bun.sleep(1200)
    expect(made).toHaveLength(2)
  })
})
