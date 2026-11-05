import {
  RELAY_MAX_AGE_MS,
  RELAY_PREFIX,
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
  contentType: "application/json",
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
      contentType: response.headers.get("content-type"),
      id: request.id,
      status: response.status,
      type: "response",
    }
  } catch (error) {
    console.error("[relay] a read failed", error)
    return json(request.id, 500, "INTERNAL_SERVER_ERROR", "This Mac could not read it")
  }
}

// Vercel closes a socket at the function's 800 s cap, so this Mac opens a fresh one before then, and after a drop waits 1 s, doubling to a minute.
export const RECYCLE_MS = 750_000
const RETRY_MS = 1000
const RETRY_MAX_MS = 60_000

type RelayDeps = {
  // the hosted API's base URL
  api: string
  // the local owner's session cookie, made once and again after the API refuses it
  cookie: () => Promise<string>
  dispatch: (request: Request) => Promise<Response>
  // the login the token's /me answers
  login: (token: string) => Promise<string>
  // the Keychain token, or null with none
  token: () => Promise<string | null>
}

// Holds the relay while the API runs: one outbound socket to the hub, opened with the owner's token, answering each read, opened again before Vercel's cap and after any drop.
export function startRelay(deps: RelayDeps): () => void {
  const seen: SeenIds = new Map()
  let socket: WebSocket | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let backoff = RETRY_MS
  let stopped = false

  const later = (ms: number) => {
    if (stopped) return
    timer = setTimeout(() => void open(), ms)
    timer.unref?.()
  }

  const open = async () => {
    try {
      const token = await deps.token()
      if (!token) return later(RETRY_MAX_MS)
      const login = await deps.login(token)
      const url = new URL(`${RELAY_PREFIX}/socket`, deps.api)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      // Bun's WebSocket takes headers, which the DOM type this package compiles against leaves out
      const opened = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } } as never)
      socket = opened
      let recycle: ReturnType<typeof setTimeout> | null = null
      opened.addEventListener("open", () => {
        backoff = RETRY_MS
        recycle = setTimeout(() => opened.close(), RECYCLE_MS)
        recycle.unref?.()
      })
      opened.addEventListener("message", (event) => {
        void answerRelay(String(event.data), { ...deps, login, seen }).then((answer) => {
          if (answer && opened.readyState === WebSocket.OPEN) opened.send(JSON.stringify(answer))
        })
      })
      opened.addEventListener("close", () => {
        if (recycle) clearTimeout(recycle)
        if (socket === opened) socket = null
        later(backoff)
        backoff = Math.min(backoff * 2, RETRY_MAX_MS)
      })
    } catch (error) {
      console.error("[relay] could not open", error)
      later(backoff)
      backoff = Math.min(backoff * 2, RETRY_MAX_MS)
    }
  }

  void open()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    socket?.close()
  }
}
