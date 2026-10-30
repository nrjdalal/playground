import { describe, expect, test } from "bun:test"

import { webStacks } from "../../../../../../api/hono/src/lib/dashboard/stacks"

// the owner: "below done make preview tab, whenever we need active development, we can use all this available space as browser/iframe"
describe("webStacks", () => {
  test("each web host with a process behind it, A to Z, by its first label", () => {
    expect(
      webStacks([
        { hostname: "pg-2.playground.localhost", pid: 2 },
        { hostname: "desk.playground.localhost", pid: 1 },
      ]),
    ).toEqual([
      { name: "desk", url: "https://desk.playground.localhost" },
      { name: "pg-2", url: "https://pg-2.playground.localhost" },
    ])
  })

  test("an API host, an alias (pid 0, or none), a bare app host and an outside host are left out", () => {
    expect(
      webStacks([
        { hostname: "api.pg-2.playground.localhost", pid: 3 },
        { hostname: "pg-2.api.playground.localhost", pid: 3 },
        { hostname: "alias.playground.localhost" },
        { hostname: "alias.desk.playground.localhost", pid: 0 },
        { hostname: "playground.localhost", pid: 4 },
        { hostname: "pg-2.dispatcher.example.com", pid: 5 },
        { pid: 6 },
      ]),
    ).toEqual([])
  })

  test("a routes file that is not a list reads as no stacks", () => {
    expect(webStacks(null)).toEqual([])
    expect(webStacks({ hostname: "desk.playground.localhost", pid: 1 })).toEqual([])
  })
})
