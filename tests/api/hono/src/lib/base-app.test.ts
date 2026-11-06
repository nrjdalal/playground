import { describe, expect, test } from "bun:test"

// The router's auth refuses Better Auth's default secret under NODE_ENV=production, which CI's build step sets; any secret serves requests that carry no session. Set before the app loads.
process.env.BETTER_AUTH_SECRET ||= "base-app-test-secret-not-for-use-anywhere"
const { baseApp } = await import("../../../../../api/hono/src/lib/base-app")

describe("the request log every build mounts (PG-1023)", () => {
  // a reveal's value rides its response body alone, so the request log, which writes the method, the path and the status, holds none of it
  test("logs a reveal's method, path and status, and nothing of its response's value", async () => {
    const value = `made-up-secret-${crypto.randomUUID()}`
    const logged: string[] = []
    const console_ = {
      error: console.error,
      info: console.info,
      log: console.log,
      warn: console.warn,
    }
    for (const name of ["error", "info", "log", "warn"] as const)
      console[name] = (...args: unknown[]) => void logged.push(args.map(String).join(" "))
    let body = ""
    try {
      // the logger takes console.log as the app is built, so the app is built after the swap
      const app = baseApp().post("/api/v1/inbox/:id/reveal", (c) => c.json({ data: { value } }))
      const response = await app.request("http://127.0.0.1/api/v1/inbox/i1/reveal", {
        method: "POST",
      })
      body = await response.text()
    } finally {
      Object.assign(console, console_)
    }
    expect(body).toContain(value)
    expect(logged.join("\n")).toContain("POST /api/v1/inbox/i1/reveal")
    expect(logged.join("\n")).not.toContain(value)
  })
})
