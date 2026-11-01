import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildOf,
  fetchHealth,
  readRunning,
  versionOf,
} from "../../../../../packages/scripts/src/health-beat/running"

const scratch = mkdtempSync(join(tmpdir(), "health-running-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

describe("versionOf, the main checkout's git describe", () => {
  test("a tag alone", () => {
    expect(versionOf({ code: 0, out: "v0.0.23-0-g8b6438a\n" })).toBe("v0.0.23")
  })

  test("a tag plus local commits, one or more", () => {
    expect(versionOf({ code: 0, out: "v0.0.23-1-g8b6438a\n" })).toBe(
      "v0.0.23 + 1 local commit (8b6438a)",
    )
    expect(versionOf({ code: 0, out: "v0.0.23-12-g8b6438a\n" })).toBe(
      "v0.0.23 + 12 local commits (8b6438a)",
    )
  })

  test("an unreadable describe prints unknown with git's reason", () => {
    expect(
      versionOf({ code: 128, out: "fatal: No names found, cannot describe anything.\n" }),
    ).toBe("unknown (git describe: fatal: No names found, cannot describe anything.)")
  })
})

const PROD = [
  "  99085 94877 bash /x/desk/scripts/ops/dashboard/run.sh",
  "    576 99085 bash /x/desk/scripts/ops/dashboard/supervisor.sh",
  "  49510   576 bun ../../packages/scripts/src/portless.ts bun /d/builds/1a1291d54884f782f5c7e71c10a9637a1c174987/web/web/next/server.js",
  "  49526 49510 bun /d/builds/1a1291d54884f782f5c7e71c10a9637a1c174987/web/web/next/server.js",
  "    700     1 node /elsewhere/node_modules/.bin/next dev",
  "    800     1 bash /x/idle.sh",
].join("\n")

const DEV = [
  "  4100  4000 node /x/node_modules/.bin/portless --script dev:app",
  "  4101  4100 bun run dev:app",
  "  4102  4101 node /x/web/next/node_modules/.bin/next dev --turbopack",
  "  4200     1 bun /d/builds/abc1234/web/web/next/server.js",
].join("\n")

const MAIN = { code: 0, out: "main\n" }
const SHA = { version: "0.0.1-1a1291d" }

describe("buildOf, the main checkout's branch, the live Dashboard's web and its /api/health", () => {
  test("a branch's build, as a /builds/<sha>/ path in the route's tree, at the version /api/health reports", () => {
    expect(buildOf({ branch: MAIN, health: SHA, ps: PROD, root: 99085 })).toBe(
      "main build, at 1a1291d",
    )
    expect(buildOf({ branch: MAIN, health: SHA, ps: PROD, root: 576 })).toBe(
      "main build, at 1a1291d",
    )
    expect(buildOf({ branch: MAIN, health: SHA, ps: DEV, root: 4200 })).toBe(
      "main build, at 1a1291d",
    )
  })

  test("a branch's dev server, as next dev in the route's tree", () => {
    const feature = { code: 0, out: "feat/x\n" }
    expect(
      buildOf({ branch: feature, health: { version: "0.0.1-9f0e1d2" }, ps: DEV, root: 4100 }),
    ).toBe("feat/x dev server, at 9f0e1d2")
    expect(buildOf({ branch: MAIN, health: SHA, ps: DEV, root: 4101 })).toBe(
      "main dev server, at 1a1291d",
    )
  })

  test("a version with no sha prints as /api/health reports it", () => {
    expect(buildOf({ branch: MAIN, health: { version: "0.0.1" }, ps: DEV, root: 4100 })).toBe(
      "main dev server, at 0.0.1",
    )
  })

  test("an unreadable branch, kind or version prints unknown with the reason, never a guess", () => {
    expect(
      buildOf({
        branch: MAIN,
        health: { reason: "no answer" },
        ps: PROD,
        root: null,
        why: "no route",
      }),
    ).toBe("main, unknown (no route), at unknown (no answer)")
    expect(buildOf({ branch: MAIN, health: SHA, ps: PROD, root: 800 })).toBe(
      "main, unknown (neither a /builds/<sha>/ path nor next dev runs under pid 800), at 1a1291d",
    )
    expect(buildOf({ branch: MAIN, health: SHA, ps: PROD, root: 4242 })).toBe(
      "main, unknown (pid 4242 is not running), at 1a1291d",
    )
    expect(
      buildOf({
        branch: { code: 0, out: "main\nwarning: something\n" },
        health: SHA,
        ps: PROD,
        root: 99085,
      }),
    ).toBe("main build, at 1a1291d")
    expect(buildOf({ branch: { code: 0, out: "" }, health: SHA, ps: PROD, root: 99085 })).toBe(
      "unknown branch (detached HEAD) build, at 1a1291d",
    )
    expect(
      buildOf({
        branch: { code: 128, out: "fatal: not a git repository\n" },
        health: SHA,
        ps: PROD,
        root: 99085,
      }),
    ).toBe("unknown branch (git branch: fatal: not a git repository) build, at 1a1291d")
  })
})

describe("readRunning", () => {
  const routes = (rows: unknown) => {
    const dir = mkdtempSync(join(scratch, "portless-"))
    writeFileSync(join(dir, "routes.json"), JSON.stringify(rows))
    return dir
  }
  const run = (ps: string) => async (argv: string[]) => {
    if (argv.includes("describe")) return { code: 0, out: "v0.0.23-1-g8b6438a\n" }
    if (argv.includes("branch")) return { code: 0, out: "main\n" }
    if (argv[0] === "ps") return { code: 0, out: ps }
    return { code: 1, out: "" }
  }

  test("reads the main checkout, then the web route's owner for playground.localhost and the API's port for api.playground.localhost", async () => {
    const asked: string[] = []
    const got = await readRunning({
      health: async (url) => {
        asked.push(url)
        return { version: "0.0.1-1a1291d" }
      },
      portless: routes([
        { hostname: "dashboard.playground.localhost", pid: 99085, port: 58008 },
        { hostname: "playground.localhost", pid: 0, port: 58008 },
        { hostname: "dashboard.api.playground.localhost", pid: 57787, port: 4459 },
        { hostname: "api.playground.localhost", pid: 0, port: 4459 },
      ]),
      repo: "/repo",
      run: run(PROD),
    })
    expect(got).toEqual({
      build: "main build, at 1a1291d",
      version: "v0.0.23 + 1 local commit (8b6438a)",
    })
    expect(asked).toEqual(["http://127.0.0.1:4459/api/health"])
  })

  test("a route that holds the bare name itself is its own owner", async () => {
    const got = await readRunning({
      health: async () => ({ version: "0.0.1-9f0e1d2" }),
      portless: routes([
        null,
        "junk",
        { hostname: "playground.localhost", pid: 4100, port: 3000 },
        { hostname: "api.playground.localhost", pid: 4300, port: 4000 },
      ]),
      repo: "/repo",
      run: run(DEV),
    })
    expect(got.build).toBe("main dev server, at 9f0e1d2")
  })

  test("no routes file, or no owner for the web's port, prints unknown with the reason", async () => {
    const none = await readRunning({
      health: async () => ({ version: "0.0.1-1a1291d" }),
      portless: join(scratch, "missing"),
      repo: "/repo",
      run: run(PROD),
    })
    expect(none.build).toBe(
      "main, unknown (portless has no route for playground.localhost), at unknown (portless has no route for api.playground.localhost)",
    )
    const orphan = await readRunning({
      health: async () => ({ reason: "/api/health did not answer: refused" }),
      portless: routes([
        { hostname: "playground.localhost", pid: 0, port: 58008 },
        { hostname: "api.playground.localhost", pid: 0, port: 4459 },
      ]),
      repo: "/repo",
      run: run(PROD),
    })
    expect(orphan.build).toBe(
      "main, unknown (no running stack holds playground.localhost's port 58008), at unknown (/api/health did not answer: refused)",
    )
  })
})

describe("fetchHealth", () => {
  const serve = (body: string, status = 200) =>
    Bun.serve({ fetch: () => new Response(body, { status }), hostname: "127.0.0.1", port: 0 })

  test("the version an answer carries, else what the answer was", async () => {
    const good = serve(JSON.stringify({ data: { version: "0.0.1-1a1291d" } }))
    const none = serve(JSON.stringify({ data: {} }), 503)
    const html = serve("<html></html>", 502)
    try {
      expect(await fetchHealth(`${good.url}api/health`)).toEqual({ version: "0.0.1-1a1291d" })
      expect(await fetchHealth(`${none.url}api/health`)).toEqual({
        reason: "/api/health answered 503 with no version",
      })
      expect(await fetchHealth(`${html.url}api/health`)).toEqual({
        reason: "/api/health answered 502, not JSON",
      })
    } finally {
      for (const server of [good, none, html]) server.stop(true)
    }
  })

  test("no answer names the error", async () => {
    const gone = serve("")
    const url = `${gone.url}api/health`
    gone.stop(true)
    const got = await fetchHealth(url)
    expect("reason" in got && got.reason.startsWith("/api/health did not answer: ")).toBe(true)
  })
})
