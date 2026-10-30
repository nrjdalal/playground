import { describe, expect, test } from "bun:test"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the router loads.
process.env.BETTER_AUTH_SECRET ||= "sessions-router-test-secret-not-for-use-anywhere"
const { sessionsRouter, stepsQuerySchema } =
  await import("../../../../../api/hono/src/routers/sessions")

// The router on its own, at its own root (the API mounts it at /api/v1/sessions).
const request = (path: string) => sessionsRouter.request(`http://127.0.0.1${path}`)

describe("the sessions routes", () => {
  test("every route turns away a request with no session, before it reads anything", async () => {
    for (const path of ["/", "/?q=lock", "/s-1", "/s-1/entries", "/s-1/steps?beforeId=u1"]) {
      expect((await request(path)).status).toBe(401)
    }
  })
})

describe("the steps query", () => {
  test("takes exactly one of before and beforeId", () => {
    expect(stepsQuerySchema.safeParse({ beforeId: "u1" }).success).toBe(true)
    expect(stepsQuerySchema.safeParse({ before: "42" }).success).toBe(true)
    expect(stepsQuerySchema.safeParse({}).success).toBe(false)
    expect(stepsQuerySchema.safeParse({ before: "42", beforeId: "u1" }).success).toBe(false)
  })
})
