import { signedBytes } from "@packages/message"

import { type KeyStore, type PairedKey, remoteKeys } from "@/lib/relay/key"
import {
  pathOn,
  RELAY_HEADERS,
  RELAY_HEARTBEAT_MS,
  RELAY_MAX_AGE_MS,
  RELAY_PREFIX,
  RELAY_SILENT_MS,
  relayAllowed,
  relayPairSchema,
  type RelayRequest,
  relayRequestSchema,
  type RelayResponse,
  type RelayWrite,
  relayWriteSchema,
} from "@/lib/relay/protocol"

// This Mac's side of the relay: it dials out to the hosted hub and answers the owner's reads from its own dashboard, in process, so no port opens here.

// The ids this Mac has answered, each kept until it is too old to come again.
export type SeenIds = Map<string, number>

const json = (id: string, status: number, code: string, message: string): RelayResponse => ({
  body: Buffer.from(JSON.stringify({ error: { code, message } })).toString("base64"),
  headers: { "content-type": "application/json" },
  id,
  status,
  type: "response",
})

const parse = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

const sameLogin = (one: string, other: string) => one.toLowerCase() === other.toLowerCase()

// Updates seen: the refusal every relayed frame meets first, in this order: an id seen before, then a frame RELAY_MAX_AGE_MS old or from as far ahead, then a login other than this Mac's own token's.
export function refuseStale(
  frame: { at: string; id: string; login: string },
  { login, now, seen }: { login: string; now: Date; seen: SeenIds },
): RelayResponse | null {
  const at = Date.parse(frame.at)
  for (const [id, until] of seen) if (until <= now.getTime()) seen.delete(id)
  if (seen.has(frame.id))
    return json(frame.id, 409, "CONFLICT", "This request was answered already")
  seen.set(frame.id, at + RELAY_MAX_AGE_MS)
  if (Math.abs(now.getTime() - at) >= RELAY_MAX_AGE_MS)
    return json(frame.id, 403, "FORBIDDEN", "This request is too old to answer")
  if (!sameLogin(frame.login, login))
    return json(frame.id, 403, "FORBIDDEN", "This Mac answers its own owner alone")
  return null
}

// Pure but for seen, which it updates: the request a frame holds once it passes requireRelay, or the answer that refuses it. It refuses as refuseStale does, then a path off the GET allowlist, so a refused frame never reaches a route. A frame with no readable id gets no answer.
export function requireRelay(
  raw: string,
  deps: { login: string; now: Date; seen: SeenIds },
): { request: RelayRequest } | { refused: RelayResponse } | null {
  const frame = relayRequestSchema.safeParse(parse(raw))
  if (!frame.success) return null
  const request = frame.data
  const refused = refuseStale(request, deps)
  if (refused) return { refused }
  if (!relayAllowed(request.method, request.path))
    return { refused: json(request.id, 403, "FORBIDDEN", "Answer on the Mac") }
  return { request }
}

// Pure but for seen, which it shares with requireRelay: the write a frame holds once the paired key's signature checks out, or the answer that refuses it, before any route runs. It refuses, in this order: an id seen before, a frame RELAY_MAX_AGE_MS old or ahead, a login other than this Mac's token's or the paired key's, a path off writes, a keyId other than the paired key's (none, once revoked), and a signature that does not verify over signedBytes.
export async function requireSignedWrite(
  raw: string,
  {
    key,
    writes,
    ...deps
  }: {
    key: PairedKey | null
    login: string
    now: Date
    seen: SeenIds
    writes: readonly string[]
  },
): Promise<{ refused: RelayResponse } | { write: RelayWrite } | null> {
  const frame = relayWriteSchema.safeParse(parse(raw))
  if (!frame.success) return null
  const write = frame.data
  const stale = refuseStale(write, deps)
  if (stale) return { refused: stale }
  const refuse = (message: string) => ({ refused: json(write.id, 403, "FORBIDDEN", message) })
  if (key && !sameLogin(write.login, key.login))
    return refuse("This Mac answers its own owner alone")
  if (!pathOn(writes, write.path)) return refuse("Send it on the Mac")
  if (!key || write.keyId !== key.id)
    return refuse("This browser's key is not paired with this Mac")
  const verified = await crypto.subtle
    .importKey("jwk", key.key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    .then(async (publicKey) =>
      crypto.subtle.verify(
        { hash: "SHA-256", name: "ECDSA" },
        publicKey,
        new Uint8Array(Buffer.from(write.sig, "base64url")),
        await signedBytes(write),
      ),
    )
    .catch(() => false)
  if (!verified) return refuse("This write's signature does not verify")
  return { write }
}

// Answers one frame. A pair request, once refuseStale passes it, waits in keys for the owner's Approve on this Mac and is answered with its fingerprint. A read passes requireRelay first, then runs in this Mac's own API as its local owner's session, so the routes' own owner check still runs here.
export async function answerRelay(
  raw: string,
  {
    cookie,
    dispatch,
    keys = remoteKeys,
    login,
    now = new Date(),
    seen,
  }: {
    cookie: () => Promise<string>
    dispatch: (request: Request) => Promise<Response>
    keys?: Pick<KeyStore, "offer">
    login: string
    now?: Date
    seen: SeenIds
  },
): Promise<RelayResponse | null> {
  const pair = relayPairSchema.safeParse(parse(raw))
  if (pair.success) {
    const refused = refuseStale(pair.data, { login, now, seen })
    if (refused) return refused
    const { fingerprint } = await keys.offer(pair.data)
    return {
      body: Buffer.from(JSON.stringify({ data: { fingerprint } })).toString("base64"),
      headers: { "content-type": "application/json" },
      id: pair.data.id,
      status: 202,
      type: "response",
    }
  }
  const checked = requireRelay(raw, { login, now, seen })
  if (checked === null || "refused" in checked) return checked?.refused ?? null
  const { request } = checked
  try {
    const response = await dispatch(
      new Request(`http://127.0.0.1${request.path}`, { headers: { cookie: await cookie() } }),
    )
    return {
      body: Buffer.from(await response.arrayBuffer()).toString("base64"),
      headers: Object.fromEntries(
        RELAY_HEADERS.flatMap((name) => {
          const value = response.headers.get(name)
          return value === null ? [] : [[name, value]]
        }),
      ),
      id: request.id,
      status: response.status,
      type: "response",
    }
  } catch (error) {
    console.error("[relay] a read failed", error)
    return json(request.id, 500, "INTERNAL_SERVER_ERROR", "This Mac could not read it")
  }
}

// Vercel ends the hosted function, and its socket, at the 300 s default duration (measured on 5 Nov: the last heartbeat answered at 286 s, an unclean close at 316 s), so this Mac opens a fresh one at RECYCLE_MS and lets the old one go once the new one is open and the old one's answers are out; after a drop it waits 1 s, doubling to a minute. 240 s leaves 60 s of the 300 s default, so a maxDuration set in api/hono/vercel.json moves RECYCLE_MS with it.
export const RECYCLE_MS = 240_000
// A hub that takes the connection but never answers the upgrade leaves the socket in CONNECTING, with no close event until Bun gives up at about 124 s, so this Mac closes it at CONNECT_MS, which with login's 15 s still fits RECYCLE_MS's 60 s margin to the cap, and opens again after the backoff.
export const CONNECT_MS = 30_000
const RETRY_MS = 1000
const RETRY_MAX_MS = 60_000

// The socket startRelay holds: a WebSocket, or a test's fake of one.
export type RelaySocket = {
  addEventListener: (
    type: "close" | "message" | "open",
    listener: (event: { code?: number; data?: unknown; reason?: string }) => void,
  ) => void
  close: () => void
  readyState: number
  send: (data: string) => void
}

type RelayDeps = {
  // the hosted API's base URL
  api: string
  // opens the socket; a WebSocket by default
  connect?: (url: URL, token: string) => RelaySocket
  // CONNECT_MS, RELAY_HEARTBEAT_MS, RECYCLE_MS and RELAY_SILENT_MS by default; a test shortens them
  connectMs?: number
  // the local owner's session cookie, made once and again after the API refuses it
  cookie: () => Promise<string>
  dispatch: (request: Request) => Promise<Response>
  heartbeatMs?: number
  // the login the token's /me answers
  login: (token: string) => Promise<string>
  recycleMs?: number
  silentMs?: number
  // the Keychain token, or null with none
  token: () => Promise<string | null>
}

// Bun's WebSocket takes headers, which the DOM type this package compiles against leaves out
const webSocket = (url: URL, token: string): RelaySocket =>
  new WebSocket(url, { headers: { authorization: `Bearer ${token}` } } as never)

// Holds the relay while the API runs: one outbound socket to the hub, opened with the owner's token, answering each read and sending a heartbeat every RELAY_HEARTBEAT_MS, replaced before Vercel's cap, and opened again after any drop, a socket not open within CONNECT_MS, or once the hub has been silent for RELAY_SILENT_MS, each connect and each end said in a `[relay]` line.
export function startRelay(deps: RelayDeps): () => void {
  const {
    connect = webSocket,
    connectMs = CONNECT_MS,
    heartbeatMs = RELAY_HEARTBEAT_MS,
    recycleMs = RECYCLE_MS,
    silentMs = RELAY_SILENT_MS,
  } = deps
  const seen: SeenIds = new Map()
  // every socket not yet closed, each with what lets it go once the answers it owes are out
  const sockets = new Map<RelaySocket, () => void>()
  const retiring = new Set<RelaySocket>()
  let socket: RelaySocket | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let backoff = RETRY_MS
  let stopped = false

  const later = (ms: number) => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void open(), ms)
    timer.unref?.()
  }

  const retry = () => {
    later(backoff)
    backoff = Math.min(backoff * 2, RETRY_MAX_MS)
  }

  const open = async () => {
    const previous = socket
    try {
      const token = await deps.token()
      if (!token) return later(RETRY_MAX_MS)
      const login = await deps.login(token)
      if (stopped) return
      const url = new URL(`${RELAY_PREFIX}/socket`, deps.api)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      const opened = connect(url, token)
      socket = opened
      let answering = 0
      let beat: ReturnType<typeof setInterval> | null = null
      let ended = false
      // opened, and not yet let go by a successor that opened
      let holding = false
      let heard = Date.now()
      let recycle: ReturnType<typeof setTimeout> | null = null
      let connecting: ReturnType<typeof setTimeout> | null = null
      sockets.set(opened, () => {
        retiring.add(opened)
        if (answering === 0) opened.close()
      })
      const end = (why: string) => {
        if (ended) return
        ended = true
        const held = holding && !retiring.has(opened)
        sockets.delete(opened)
        retiring.delete(opened)
        if (beat) clearInterval(beat)
        if (recycle) clearTimeout(recycle)
        if (connecting) clearTimeout(connecting)
        if (stopped) return
        // a socket a newer one replaced ends with nothing more to do, but one that drops while the recycle's next socket still connects says so, and that socket's own open or end decides what comes next
        if (socket !== opened) {
          if (held) console.error(`[relay] ${why}; the next socket is still connecting`)
          return
        }
        // a replacement that never opened leaves the old socket holding the relay
        socket =
          previous?.readyState === WebSocket.OPEN && !retiring.has(previous) ? previous : null
        console.error(`[relay] ${why}; opening again in ${backoff / 1000} s`)
        retry()
      }
      connecting = setTimeout(() => {
        end(`the hub did not answer within ${connectMs / 1000} s`)
        opened.close()
      }, connectMs)
      connecting.unref?.()
      opened.addEventListener("open", () => {
        if (connecting) clearTimeout(connecting)
        holding = true
        backoff = RETRY_MS
        heard = Date.now()
        // a recycle's next socket opens beside one that holds the relay already
        if (previous?.readyState !== WebSocket.OPEN) console.log(`[relay] connected to ${url.host}`)
        if (previous) sockets.get(previous)?.()
        beat = setInterval(() => {
          // the hub answers each heartbeat, so its silence means a dead socket, whose close event may never come
          if (Date.now() - heard >= silentMs) {
            end(`the hub was silent for ${silentMs / 1000} s`)
            opened.close()
          } else if (opened.readyState === WebSocket.OPEN)
            opened.send(JSON.stringify({ type: "heartbeat" }))
        }, heartbeatMs)
        recycle = setTimeout(() => void open(), recycleMs)
        beat.unref?.()
        recycle.unref?.()
      })
      opened.addEventListener("message", (event) => {
        heard = Date.now()
        answering++
        void answerRelay(String(event.data), { ...deps, login, seen }).then((answer) => {
          // whichever socket is open takes the answer, so a read in flight across a recycle still reaches the hub
          const out = [opened, socket].find((one) => one?.readyState === WebSocket.OPEN)
          if (answer && out) out.send(JSON.stringify(answer))
          if (--answering === 0 && retiring.has(opened)) opened.close()
        })
      })
      // the hub closes a socket it refuses with 4000 + the status and its reason (refusedUpgradeCloses in lib/server.ts)
      opened.addEventListener("close", ({ code, reason }) =>
        end(
          code
            ? `the socket closed (${[code, reason].filter(Boolean).join(" ")})`
            : "the socket closed",
        ),
      )
    } catch (error) {
      console.error("[relay] could not open", error)
      if (socket === previous) retry()
    }
  }

  void open()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    for (const one of [...sockets.keys()]) one.close()
  }
}
