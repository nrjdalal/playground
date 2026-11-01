import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildOf,
  checkoutOf,
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

describe("checkoutOf, the main checkout's version beside main's latest tag", () => {
  const DESCRIBE = { code: 0, out: "v0.0.23-1-g8b6438a\n" }
  test("a checkout behind main names main's latest tag", () => {
    expect(
      checkoutOf({
        ancestor: { code: 1, out: "" },
        describe: DESCRIBE,
        mainTag: { code: 0, out: "v0.0.25\n" },
      }),
    ).toBe("v0.0.23 + 1 local commit (8b6438a), behind main v0.0.25")
  })

  test("a checkout level with main, or ahead of it, says only its own version", () => {
    expect(
      checkoutOf({
        ancestor: { code: 0, out: "" },
        describe: { code: 0, out: "v0.0.25-0-gb73af93\n" },
        mainTag: { code: 0, out: "v0.0.25\n" },
      }),
    ).toBe("v0.0.25")
  })

  test("an ancestry it cannot read leaves the comparison out too", () => {
    expect(
      checkoutOf({
        ancestor: { code: 128, out: "fatal: Not a valid commit name v0.0.25\n" },
        describe: DESCRIBE,
        mainTag: { code: 0, out: "v0.0.25\n" },
      }),
    ).toBe("v0.0.23 + 1 local commit (8b6438a)")
  })

  test("a main tag it cannot read leaves the comparison out, never a guess", () => {
    expect(
      checkoutOf({
        describe: DESCRIBE,
        mainTag: { code: 128, out: "fatal: Not a valid object name origin/main\n" },
      }),
    ).toBe("v0.0.23 + 1 local commit (8b6438a)")
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

// the live Dashboard after its supervisor took the route: run.sh owns it, and the web it started runs with ppid 1 on the route's port
const SUPERVISED = [
  "  99085 94877 bash /x/desk/scripts/ops/dashboard/run.sh",
  "    576 99085 bash /x/desk/scripts/ops/dashboard/supervisor.sh",
  "  49510     1 bun ../../packages/scripts/src/portless.ts bun /d/builds/1a1291d54884f782f5c7e71c10a9637a1c174987/web/web/next/server.js",
  "  49526 49510 bun /d/builds/1a1291d54884f782f5c7e71c10a9637a1c174987/web/web/next/server.js",
].join("\n")

// next's standalone server.js moves into its build folder before it listens, so only the launcher above it still works in the Dashboard's checkout
const CHDIR = [
  "  99085 94877 bash /x/desk/scripts/ops/dashboard/run.sh",
  "  49510     1 bun /x/desk/packages/scripts/src/launcher.ts",
  "  49526 49510 bun /d/builds/1a1291d54884f782f5c7e71c10a9637a1c174987/web/web/next/server.js",
].join("\n")

const DEV = [
  "  4100  4000 node /x/node_modules/.bin/portless --script dev:app",
  "  4101  4100 bun run dev:app",
  "  4102  4101 node /x/web/next/node_modules/.bin/next dev --turbopack",
  "  4200     1 bun /d/builds/abc1234/web/web/next/server.js",
].join("\n")

const MAIN = { code: 0, out: "main\n" }
const SHA = { version: "0.0.1-1a1291d" }

describe("buildOf, the Dashboard checkout's branch, the live Dashboard's web and its /api/health", () => {
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

  test("a branch's build, as a /builds/<sha>/ path on the process listening on the route's port, when the route's owner runs none", () => {
    expect(
      buildOf({
        branch: MAIN,
        health: SHA,
        listeners: [49526],
        port: 58008,
        ps: SUPERVISED,
        root: 99085,
      }),
    ).toBe("main build, at 1a1291d")
    expect(
      buildOf({
        branch: MAIN,
        health: SHA,
        listeners: [49526],
        port: 58008,
        ps: SUPERVISED,
        root: 4242,
      }),
    ).toBe("main build, at 1a1291d")
  })

  test("the Dashboard's sha carries the tag at it or the nearest before it, or says why it cannot", () => {
    const B73 = { version: "0.0.1-b73af937" }
    expect(
      buildOf({
        branch: MAIN,
        health: B73,
        ps: PROD,
        root: 99085,
        tag: { code: 0, out: "v0.0.25\n" },
      }),
    ).toBe("main build, at b73af937 (v0.0.25)")
    expect(
      buildOf({
        branch: MAIN,
        health: B73,
        ps: PROD,
        root: 99085,
        tag: { code: 128, out: "fatal: Not a valid object name b73af937\n" },
      }),
    ).toBe(
      "main build, at b73af937 (tag unknown: git describe: fatal: Not a valid object name b73af937)",
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

  test("an unreadable kind or version prints unknown with the reason, and an unreadable branch is left out, never a guess", () => {
    expect(
      buildOf({
        branch: MAIN,
        health: { reason: "no answer" },
        ps: PROD,
        root: null,
        why: "no route",
      }),
    ).toBe("unknown (no route), at unknown (no answer)")
    expect(buildOf({ branch: MAIN, health: SHA, port: 58008, ps: PROD, root: 800 })).toBe(
      "unknown (neither a /builds/<sha>/ path nor next dev runs under pid 800 or on port 58008), at 1a1291d",
    )
    expect(buildOf({ branch: MAIN, health: SHA, port: 58008, ps: SUPERVISED, root: 99085 })).toBe(
      "unknown (neither a /builds/<sha>/ path nor next dev runs under pid 99085 or on port 58008), at 1a1291d",
    )
    expect(buildOf({ branch: MAIN, health: SHA, ps: PROD, root: 4242 })).toBe(
      "unknown (pid 4242 is not running), at 1a1291d",
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
      "build, at 1a1291d",
    )
    expect(
      buildOf({
        branch: { code: 128, out: "fatal: not a git repository\n" },
        health: SHA,
        ps: PROD,
        root: 99085,
      }),
    ).toBe("build, at 1a1291d")
    expect(buildOf({ health: SHA, port: 58008, ps: PROD, root: 800 })).toBe(
      "unknown (neither a /builds/<sha>/ path nor next dev runs under pid 800 or on port 58008), at 1a1291d",
    )
  })
})

describe("readRunning", () => {
  const routes = (rows: unknown) => {
    const dir = mkdtempSync(join(scratch, "portless-"))
    writeFileSync(join(dir, "routes.json"), JSON.stringify(rows))
    return dir
  }
  const git = {
    ancestor: 1,
    branches: {} as Record<string, string>,
    cwd: "/desk/web/next",
    cwds: {} as Record<string, string>,
    mainTag: { code: 1, out: "" },
    tags: { "1a1291d": "v0.0.23", "9f0e1d2": "v0.0.23" } as Record<string, string>,
  }
  const asks: string[][] = []
  const branchReads: string[] = []
  const tagReads: string[] = []
  const run = (ps: string) => async (argv: string[]) => {
    if (argv[0] === "git") asks.push(argv.slice(3))
    if (argv.includes("--long")) return { code: 0, out: "v0.0.23-1-g8b6438a\n" }
    if (argv.includes("origin/main")) return git.mainTag
    if (argv.includes("--is-ancestor")) return { code: git.ancestor, out: "" }
    if (argv.includes("describe")) {
      tagReads.push(argv[2]!)
      const tag = git.tags[argv.at(-1)!]
      return tag ? { code: 0, out: `${tag}\n` } : { code: 128, out: "fatal: no tag\n" }
    }
    if (argv.includes("branch")) branchReads.push(argv[2]!)
    if (argv.includes("branch") && argv[2]!.includes("/builds/"))
      return { code: 128, out: "fatal: not a git repository\n" }
    if (argv.includes("branch")) return { code: 0, out: `${git.branches[argv[2]!] ?? "main"}\n` }
    if (argv[0] === "lsof" && argv.includes("cwd")) {
      const folder = git.cwds[argv[3]!] ?? git.cwd
      return folder ? { code: 0, out: `p${argv[3]}\nfcwd\nn${folder}\n` } : { code: 1, out: "" }
    }
    if (argv[0] === "ps") return { code: 0, out: ps }
    if (argv[0] === "lsof" && listening[argv[2]!]) return { code: 0, out: listening[argv[2]!] }
    return { code: 1, out: "" }
  }
  const listening: Record<string, string> = {}

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
      build: "main build, at 1a1291d (v0.0.23)",
      version: "v0.0.23 + 1 local commit (8b6438a)",
    })
    expect(asked).toEqual(["http://127.0.0.1:4459/api/health"])
  })

  test("names the Dashboard's branch from its own checkout, the working folder of the process serving it, when the main checkout is on another", async () => {
    git.branches = { "/desk/web/next": "dashboard", "/repo": "main" }
    branchReads.length = 0
    try {
      const got = await readRunning({
        health: async () => ({ version: "0.0.1-1a1291d" }),
        portless: routes([
          { hostname: "dashboard.playground.localhost", pid: 99085, port: 58008 },
          { hostname: "playground.localhost", pid: 0, port: 58008 },
          { hostname: "api.playground.localhost", pid: 0, port: 4459 },
        ]),
        repo: "/repo",
        run: run(PROD),
      })
      expect(got.build).toBe("dashboard build, at 1a1291d (v0.0.23)")
      expect(branchReads).toEqual(["/desk/web/next"])
      git.cwd = ""
      const unread = await readRunning({
        health: async () => ({ version: "0.0.1-1a1291d" }),
        portless: routes([
          { hostname: "playground.localhost", pid: 99085, port: 58008 },
          { hostname: "api.playground.localhost", pid: 0, port: 4459 },
        ]),
        repo: "/repo",
        run: run(PROD),
      })
      expect(unread.build).toBe("build, at 1a1291d (v0.0.23)")
    } finally {
      git.branches = {}
      git.cwd = "/desk/web/next"
    }
  })

  test("walks up from a server that moved into its build folder to the launcher's checkout, and reads the sha's tag there", async () => {
    listening["-iTCP:58008"] = "49526\n"
    git.cwds = {
      "49510": "/x/desk/web/next",
      "49526": "/d/builds/1a1291d54884f782f5c7e71c10a9637a1c174987/web/web/next",
    }
    git.branches = { "/x/desk/web/next": "dashboard" }
    branchReads.length = 0
    tagReads.length = 0
    try {
      const got = await readRunning({
        health: async () => ({ version: "0.0.1-1a1291d" }),
        portless: routes([
          { hostname: "dashboard.playground.localhost", pid: 99085, port: 58008 },
          { hostname: "playground.localhost", pid: 0, port: 58008 },
          { hostname: "api.playground.localhost", pid: 0, port: 4459 },
        ]),
        repo: "/repo",
        run: run(CHDIR),
      })
      expect(got.build).toBe("dashboard build, at 1a1291d (v0.0.23)")
      expect(branchReads).toEqual([
        "/d/builds/1a1291d54884f782f5c7e71c10a9637a1c174987/web/web/next",
        "/x/desk/web/next",
      ])
      expect(tagReads).toContain("/x/desk/web/next")
    } finally {
      delete listening["-iTCP:58008"]
      git.cwds = {}
      git.branches = {}
    }
  })

  test("names main's latest tag when the checkout is behind it, and the tag at the Dashboard's sha", async () => {
    git.mainTag = { code: 0, out: "v0.0.25\n" }
    git.tags["b73af937"] = "v0.0.25"
    asks.length = 0
    try {
      const got = await readRunning({
        health: async () => ({ version: "0.0.1-b73af937" }),
        portless: routes([
          { hostname: "dashboard.playground.localhost", pid: 99085, port: 58008 },
          { hostname: "playground.localhost", pid: 0, port: 58008 },
          { hostname: "api.playground.localhost", pid: 0, port: 4459 },
        ]),
        repo: "/repo",
        run: run(PROD),
      })
      expect(got).toEqual({
        build: "main build, at b73af937 (v0.0.25)",
        version: "v0.0.23 + 1 local commit (8b6438a), behind main v0.0.25",
      })
      expect(asks).toContainEqual(["describe", "--tags", "--abbrev=0", "origin/main"])
      expect(asks).toContainEqual(["merge-base", "--is-ancestor", "v0.0.25", "HEAD"])
      expect(asks).toContainEqual(["describe", "--tags", "--abbrev=0", "b73af937"])
      git.ancestor = 0
      const level = await readRunning({
        health: async () => ({ version: "0.0.1-b73af937" }),
        portless: routes([{ hostname: "playground.localhost", pid: 99085, port: 58008 }]),
        repo: "/repo",
        run: run(PROD),
      })
      expect(level.version).toBe("v0.0.23 + 1 local commit (8b6438a)")
    } finally {
      git.ancestor = 1
      git.mainTag = { code: 1, out: "" }
      git.tags = { "1a1291d": "v0.0.23", "9f0e1d2": "v0.0.23" }
    }
  })

  test("reads the supervised web from the process listening on the route's port, read through lsof", async () => {
    listening["-iTCP:58008"] = "49526\n"
    try {
      const got = await readRunning({
        health: async () => ({ version: "0.0.1-1a1291d" }),
        portless: routes([
          { hostname: "dashboard.playground.localhost", pid: 99085, port: 58008 },
          { hostname: "playground.localhost", pid: 0, port: 58008 },
          { hostname: "api.playground.localhost", pid: 0, port: 4459 },
        ]),
        repo: "/repo",
        run: run(SUPERVISED),
      })
      expect(got.build).toBe("main build, at 1a1291d (v0.0.23)")
    } finally {
      delete listening["-iTCP:58008"]
    }
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
    expect(got.build).toBe("main dev server, at 9f0e1d2 (v0.0.23)")
  })

  test("no routes file, or no owner for the web's port, prints unknown with the reason", async () => {
    const none = await readRunning({
      health: async () => ({ version: "0.0.1-1a1291d" }),
      portless: join(scratch, "missing"),
      repo: "/repo",
      run: run(PROD),
    })
    expect(none.build).toBe(
      "unknown (portless has no route for playground.localhost), at unknown (portless has no route for api.playground.localhost)",
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
      "unknown (no running stack holds playground.localhost's port 58008), at unknown (/api/health did not answer: refused)",
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
