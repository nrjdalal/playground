import { describe, expect, test } from "bun:test"

// Better Auth refuses its default secret under NODE_ENV=production, which CI's build step sets; set one before the middleware loads.
process.env.BETTER_AUTH_SECRET ||= "auth-middleware-test-secret-not-for-use-anywhere"
const { OWNER_READ_LIMIT, USER_LIMIT, userLimiter } =
  await import("../../../../../api/hono/src/middlewares/auth")
const { Hono } = await import("../../../../../api/hono/node_modules/hono")

type Vars = { session: { userId: string }; user: { banned: boolean; role: string } }

function app(userId: string, role: string) {
  return new Hono<{ Variables: Vars }>()
    .use("*", async (c, next) => {
      c.set("session", { userId })
      c.set("user", { banned: false, role })
      await next()
    })
    .use("*", userLimiter as never)
    .get("/", (c) => c.text("ok"))
    .post("/", (c) => c.text("ok"))
}

async function statuses(target: ReturnType<typeof app>, method: string, count: number) {
  const seen: number[] = []
  for (let i = 0; i < count; i++) seen.push((await target.request("/", { method })).status)
  return seen
}

describe("userLimiter", () => {
  test("sizes the owner read budget at ten times the shared one", () => {
    expect(USER_LIMIT).toBe(120)
    expect(OWNER_READ_LIMIT).toBe(1200)
  })

  test("lets an owner read past the shared limit, up to the read budget", async () => {
    const seen = await statuses(app("u-owner-reads", "owner"), "GET", OWNER_READ_LIMIT + 1)
    expect(seen.slice(0, OWNER_READ_LIMIT).every((status) => status === 200)).toBe(true)
    expect(seen[OWNER_READ_LIMIT]).toBe(429)
  })

  test("keeps an owner's writes on the shared limit, untouched by the reads", async () => {
    const owner = app("u-owner-writes", "owner")
    expect((await statuses(owner, "GET", 300)).every((status) => status === 200)).toBe(true)
    const writes = await statuses(owner, "POST", USER_LIMIT + 1)
    expect(writes.slice(0, USER_LIMIT).every((status) => status === 200)).toBe(true)
    expect(writes[USER_LIMIT]).toBe(429)
  })

  test("keeps every other rung's reads on the shared limit", async () => {
    const seen = await statuses(app("u-admin-reads", "admin"), "GET", USER_LIMIT + 1)
    expect(seen.slice(0, USER_LIMIT).every((status) => status === 200)).toBe(true)
    expect(seen[USER_LIMIT]).toBe(429)
  })
})
