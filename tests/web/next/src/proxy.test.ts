import { describe, expect, test } from "bun:test"

import { config, proxyFor } from "../../../../web/next/src/proxy"

// The proxy reads the request's URL alone; next/server resolves from web/next, not from here.
const request = (path: string) =>
  ({ url: new URL(path, "http://127.0.0.1:3000").href }) as Parameters<
    ReturnType<typeof proxyFor>
  >[0]

describe("the hosted proxy", () => {
  test("runs on /dashboard and every page under it", () => {
    expect(config.matcher).toEqual(["/dashboard", "/dashboard/:path*"])
  })

  test("a hosted build answers each dashboard page with the app's 404", () => {
    for (const path of ["/dashboard", "/dashboard/sessions", "/dashboard/apps/changelog"]) {
      const answer = proxyFor(true)(request(path))
      expect(answer.headers.get("x-middleware-rewrite")).toBe("http://127.0.0.1:3000/404")
    }
  })

  test("a local stack passes every dashboard page straight through", () => {
    const answer = proxyFor(false)(request("/dashboard/sessions"))
    expect(answer.headers.get("x-middleware-rewrite")).toBeNull()
    expect(answer.headers.get("x-middleware-next")).toBe("1")
  })
})
