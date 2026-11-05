import {
  RELAY_HEADERS,
  RELAY_HEARTBEAT_MS,
  RELAY_MAX_AGE_MS,
  RELAY_PREFIX,
  RELAY_SILENT_MS,
  relayAllowed,
  type RelayRequest,
  relayRequestSchema,
  type RelayResponse,
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

// Pure but for seen, which it updates: the request a frame holds once it passes requireRelay, or the answer that refuses it. It refuses an id seen before, a request RELAY_MAX_AGE_MS old or from as far ahead, a login other than this Mac's own token's, and a path off the GET allowlist, so a refused frame never reaches a route. A frame with no readable id gets no answer.
export function requireRelay(
  raw: string,
  { login, now, seen }: { login: string; now: Date; seen: SeenIds },
): { request: RelayRequest } | { refused: RelayResponse } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const frame = relayRequestSchema.safeParse(parsed)
  if (!frame.success) return null
  const request = frame.data
  const at = Date.parse(request.at)
  for (const [id, until] of seen) if (until <= now.getTime()) seen.delete(id)
  if (seen.has(request.id))
    return { refused: json(request.id, 409, "CONFLICT", "This request was answered already") }
  seen.set(request.id, at + RELAY_MAX_AGE_MS)
  if (Math.abs(now.getTime() - at) >= RELAY_MAX_AGE_MS)
    return { refused: json(request.id, 403, "FORBIDDEN", "This request is too old to answer") }
  if (request.login.toLowerCase() !== login.toLowerCase())
    return { refused: json(request.id, 403, "FORBIDDEN", "This Mac answers its own owner alone") }
  if (!relayAllowed(request.method, request.path))
    return { refused: json(request.id, 403, "FORBIDDEN", "Answer on the Mac") }
  return { request }
}

// Answers one frame: requireRelay first, then the request runs in this Mac's own API as its local owner's session, so the routes' own owner check still runs here.
export async function answerRelay(
  raw: string,
  {
    cookie,
    dispatch,
    login,
    now = new Date(),
    seen,
  }: {
    cookie: () => Promise<string>
    dispatch: (request: Request) => Promise<Response>
    login: string
    now?: Date
    seen: SeenIds
  },
): Promise<RelayResponse | null> {
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

// Vercel closes a socket at the function's 800 s cap, so this Mac opens a fresh one at RECYCLE_MS and lets the old one go once the new one is open and the old one's answers are out; after a drop it waits 1 s, doubling to a minute.
export const RECYCLE_MS = 750_000
const RETRY_MS = 1000
const RETRY_MAX_MS = 60_000

// The socket startRelay holds: a WebSocket, or a test's fake of one.
export type RelaySocket = {
  addEventListener: (
    type: "close" | "message" | "open",
    listener: (event: { data?: unknown }) => void,
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
  // the local owner's session cookie, made once and again after the API refuses it
  cookie: () => Promise<string>
  dispatch: (request: Request) => Promise<Response>
  // RELAY_HEARTBEAT_MS, RECYCLE_MS and RELAY_SILENT_MS by default; a test shortens them
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

// Holds the relay while the API runs: one outbound socket to the hub, opened with the owner's token, answering each read and sending a heartbeat every RELAY_HEARTBEAT_MS, replaced before Vercel's cap, and opened again after any drop or once the hub has been silent for RELAY_SILENT_MS.
export function startRelay(deps: RelayDeps): () => void {
  const {
    connect = webSocket,
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
      let heard = Date.now()
      let recycle: ReturnType<typeof setTimeout> | null = null
      sockets.set(opened, () => {
        retiring.add(opened)
        if (answering === 0) opened.close()
      })
      const end = () => {
        if (ended) return
        ended = true
        sockets.delete(opened)
        retiring.delete(opened)
        if (beat) clearInterval(beat)
        if (recycle) clearTimeout(recycle)
        // a socket a newer one replaced ends with nothing more to do
        if (socket !== opened) return
        // a replacement that never opened leaves the old socket holding the relay
        socket =
          previous?.readyState === WebSocket.OPEN && !retiring.has(previous) ? previous : null
        retry()
      }
      opened.addEventListener("open", () => {
        backoff = RETRY_MS
        heard = Date.now()
        if (previous) sockets.get(previous)?.()
        beat = setInterval(() => {
          // the hub answers each heartbeat, so its silence means a dead socket, whose close event may never come
          if (Date.now() - heard >= silentMs) {
            end()
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
      opened.addEventListener("close", end)
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
