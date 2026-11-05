import { describe, expect, test } from "bun:test"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "relay-mac-test-secret-not-for-use-anywhere"
const { answerRelay, requireRelay } = await import("../../../../../../api/hono/src/lib/relay/mac")
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

  test("carries the answer's status, content type and bytes back", async () => {
    const answer = await answerRelay(frame(), {
      ...deps(
        async () =>
          new Response(new Uint8Array([0, 255, 7]), {
            headers: { "content-type": "image/png" },
            status: 200,
          }),
      ),
    })
    expect([answer?.status, answer?.contentType, [...Buffer.from(answer!.body, "base64")]]).toEqual(
      [200, "image/png", [0, 255, 7]],
    )
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
