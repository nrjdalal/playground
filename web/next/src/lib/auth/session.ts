// How long a session read waits on an API that is restarting (a dashboard roll takes seconds) before the page shows an error, never the first-run pane.
export const SESSION_WAIT_MS = 20_000
const SESSION_RETRY_MS = 1_000

// The API gave no answer or a 5xx for the whole wait, or a 429: the session is unknown, not gone.
export class ApiUnavailable extends Error {
  constructor() {
    super("The API is not answering; the session could not be read")
    this.name = "ApiUnavailable"
  }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// One try, bounded by the time the wait has left: an API that takes the connection and never answers is aborted and read as no answer.
async function tryOnce(
  fetchOnce: (signal: AbortSignal) => Promise<Response>,
  ms: number,
): Promise<Response | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, ms)
  })
  try {
    return await Promise.race([fetchOnce(controller.signal).catch(() => null), late])
  } finally {
    clearTimeout(timer)
  }
}

// The session from one get-session call, retried while the API restarts, as the outbox waits out NETWORK_ERROR: no answer or a 5xx is tried again each second until SESSION_WAIT_MS, then ApiUnavailable; a 429 is ApiUnavailable at once, since a retry would spend the budget it waits on. Each try gets only the time left, so a hung request never holds the page past the wait. Signed out (null) only on the API's own word: a 4xx, or a 200 that holds no session.
export async function readSession<S>(
  fetchOnce: (signal: AbortSignal) => Promise<Response>,
  {
    now = Date.now,
    sleep = wait,
    waitMs = SESSION_WAIT_MS,
  }: { now?: () => number; sleep?: (ms: number) => Promise<void>; waitMs?: number } = {},
): Promise<S | null> {
  const until = now() + waitMs
  for (;;) {
    const response = await tryOnce(fetchOnce, Math.max(0, until - now()))
    if (response?.status === 429) throw new ApiUnavailable()
    if (response && response.status < 500) {
      if (!response.ok) return null
      const text = await response.text()
      return text ? (JSON.parse(text) as S | null) : null
    }
    if (now() >= until) throw new ApiUnavailable()
    await sleep(SESSION_RETRY_MS)
  }
}

export const UNAVAILABLE = "unavailable"

// The session, or UNAVAILABLE when the API did not answer, so a page draws its retry state in place of throwing into next's error document, which reloads on every dev sync.
export async function sessionOrUnavailable<S>(
  read: () => Promise<S | null>,
): Promise<S | null | typeof UNAVAILABLE> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof ApiUnavailable) return UNAVAILABLE
    throw error
  }
}
