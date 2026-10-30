import { describe, expect, test } from "bun:test"

import {
  ApiUnavailable,
  readSession,
  sessionOrUnavailable,
  UNAVAILABLE,
} from "../../../../../../web/next/src/lib/auth/session"

// Seen while the dashboard rolled: the sign-in dialog with "Could not load sign-in options. Refresh to try again.", and the page never came back by itself
const session = { session: { id: "s-1" }, user: { email: "merritt@example.com", id: "u-1" } }
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const down = () => Promise.reject(new TypeError("fetch failed"))

// Each call answers with the next reply in turn; a function is called, so it can throw as fetch does.
const replies = (...answers: (Response | (() => Promise<Response>))[]) => {
  let calls = 0
  const fetchOnce = () => {
    const answer = answers[Math.min(calls++, answers.length - 1)]
    return typeof answer === "function" ? answer() : Promise.resolve(answer.clone())
  }
  return { calls: () => calls, fetchOnce }
}
const noWait = { sleep: async () => {} }

describe("readSession", () => {
  test("a read that fails while the API restarts, then answers, keeps the session", async () => {
    const { calls, fetchOnce } = replies(down, new Response("", { status: 502 }), ok(session))
    expect(await readSession<typeof session>(fetchOnce, noWait)).toEqual(session)
    expect(calls()).toBe(3)
  })

  // A 429 tried every second for the whole wait kept spending the budget it waited on, and the page it then threw into next's error document reloaded on every dev sync (T2 on c813034219)
  test("a 429 from the rate limit gives up at once as ApiUnavailable, never read as signed out", async () => {
    const { calls, fetchOnce } = replies(new Response("", { status: 429 }), ok(session))
    let slept = 0
    const sleep = async () => {
      slept++
    }
    await expect(readSession<typeof session>(fetchOnce, { sleep })).rejects.toBeInstanceOf(
      ApiUnavailable,
    )
    expect(calls()).toBe(1)
    expect(slept).toBe(0)
  })

  test("sessionOrUnavailable answers unavailable for an API that did not answer, and keeps a session or a sign-out", async () => {
    expect(await sessionOrUnavailable(() => Promise.reject(new ApiUnavailable()))).toBe(UNAVAILABLE)
    expect(await sessionOrUnavailable(() => Promise.resolve(session))).toEqual(session)
    expect(await sessionOrUnavailable(() => Promise.resolve(null))).toBeNull()
    await expect(sessionOrUnavailable(() => Promise.reject(new TypeError("bug")))).rejects.toThrow(
      "bug",
    )
  })

  test("a 401, or a session the API says is none, is signed out at once", async () => {
    const unauthorized = replies(new Response("", { status: 401 }))
    expect(await readSession(unauthorized.fetchOnce, noWait)).toBeNull()
    expect(unauthorized.calls()).toBe(1)
    expect(await readSession(replies(ok(null)).fetchOnce, noWait)).toBeNull()
    expect(
      await readSession(replies(new Response("", { status: 200 })).fetchOnce, noWait),
    ).toBeNull()
  })

  test("an API that stays down past the wait throws ApiUnavailable, never reads as signed out", async () => {
    let clock = 0
    const { calls, fetchOnce } = replies(down)
    const read = readSession(fetchOnce, {
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
    })
    await expect(read).rejects.toBeInstanceOf(ApiUnavailable)
    expect(calls()).toBeGreaterThan(5)
  })

  test("a request that never settles is cut at the wait's end and aborted, never holding the page past it", async () => {
    let aborted = false
    const hung = (signal: AbortSignal) => {
      signal.addEventListener("abort", () => void (aborted = true))
      return new Promise<Response>(() => {})
    }
    const started = performance.now()
    await expect(readSession(hung, { waitMs: 50 })).rejects.toBeInstanceOf(ApiUnavailable)
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(aborted).toBe(true)
  })
})
