import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { checkAliases } from "../../../../scripts/ops/dashboard/alias"

const FILE = "/state/routes.json"
const URLS = ["https://desk.playground.localhost", "https://desk.api.playground.localhost"]
const LIVE: [string, number][] = [
  ["desk.playground.localhost", 4842],
  ["playground.localhost", 4842],
  ["desk.api.playground.localhost", 4843],
  ["api.playground.localhost", 4843],
]
const text = (pairs: [string, number][]) =>
  JSON.stringify(pairs.map(([hostname, port]) => ({ hostname, pid: 0, port })))
const moved = LIVE.map(([host, port]): [string, number] => [
  host,
  host === "playground.localhost" ? 4851 : port,
])

describe("the bare alias reader", () => {
  test("passes while each bare alias holds the port of the live stack's own route", () => {
    expect(checkAliases(FILE, text(LIVE), URLS)).toEqual({
      code: 0,
      line: "playground.localhost and api.playground.localhost hold the live stack's ports 4842 and 4843",
    })
  })

  // on 31 Oct a probe moved playground.localhost to its own web for about 2 s, twice, and nothing checked or alerted
  test("names both ports when a bare alias points somewhere else", () => {
    expect(checkAliases(FILE, text(moved), URLS)).toEqual({
      code: 1,
      line: "playground.localhost points at port 4851, but the live stack's desk.playground.localhost is on 4842",
    })
  })

  test("names a missing route as its own case, never a pass", () => {
    const without = (host: string) => text(LIVE.filter(([h]) => h !== host))
    expect(checkAliases(FILE, without("playground.localhost"), URLS)).toEqual({
      code: 2,
      line: `no route for playground.localhost in ${FILE}`,
    })
    expect(checkAliases(FILE, without("desk.api.playground.localhost"), URLS).line).toBe(
      `no route for desk.api.playground.localhost in ${FILE}`,
    )
  })

  test("names a missing or unreadable route file as its own case, never a pass", () => {
    expect(checkAliases(FILE, null, URLS)).toEqual({ code: 2, line: `no route file at ${FILE}` })
    expect(checkAliases(FILE, "{not json", URLS)).toEqual({
      code: 2,
      line: `the route file ${FILE} is not JSON`,
    })
    expect(checkAliases(FILE, "{}", URLS).code).toBe(2)
  })

  test("exits with its code and prints its line as the supervisor runs it", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "--no-env-file",
        join(import.meta.dir, "../../../../scripts/ops/dashboard/alias.ts"),
        "/nowhere/routes.json",
        ...URLS,
      ],
      { stdout: "pipe" },
    )
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    expect([code, out.trim()]).toEqual([2, "no route file at /nowhere/routes.json"])
  })
})
