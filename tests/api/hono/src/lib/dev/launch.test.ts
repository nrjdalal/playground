import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SQL } from "bun"
import { RouteConflictError, RouteStore } from "portless"

import type { Attachment } from "../../../../../../api/hono/src/lib/dashboard/cmux"
import {
  apiSettings,
  checkoutOf,
  clearStaleAliases,
  dashboardAliasPairs,
  dashboardEnv,
  devEnv,
  envGaps,
  fixtureStackEnv,
  heldBareHosts,
  herdrAloneEnv,
  isDryRun,
  mainCheckoutOf,
  livePair,
  moveRoute,
  othersLiveDashboard,
  PORTLESS,
  preflight,
  prefixOf,
  type SettingsRead,
  syncAliases,
} from "../../../../../../api/hono/src/lib/dev/launch"
import {
  GuardError,
  type GuardFailure,
  type Located,
  prove,
} from "../../../../../../api/hono/src/lib/sessions/guard"
import { envLines, REQUIRED } from "./env-fixtures"

const LIVE_DASHBOARD = livePair()

const ROOT = join(import.meta.dir, "../../../../../..")

describe("devEnv", () => {
  test("drops the NODE_ENV and SKIP_ENV_VALIDATION a commit recipe exported, and says so", () => {
    const { env, notes } = devEnv(
      { HOME: "/Users/a", NODE_ENV: "production", SKIP_ENV_VALIDATION: "true" },
      "abc1234",
    )
    expect(env.NODE_ENV).toBeUndefined()
    expect(env.SKIP_ENV_VALIDATION).toBeUndefined()
    expect(env.HOME).toBe("/Users/a")
    expect(notes).toEqual([
      "ignoring NODE_ENV=production from the shell, so the stage comes from .env",
      "ignoring SKIP_ENV_VALIDATION=true from the shell, so .env is validated",
    ])
  })

  test("drops a PLAYGROUND_HERDR_ALONE the shell exported, so only the launcher's own herdr-alone start sets it", () => {
    const { env, notes } = devEnv({ PLAYGROUND_HERDR_ALONE: "1" }, "abc1234")
    expect(env.PLAYGROUND_HERDR_ALONE).toBeUndefined()
    expect(notes).toEqual([
      "ignoring PLAYGROUND_HERDR_ALONE=1 from the shell, so only the launcher sets it",
    ])
    expect(herdrAloneEnv(env).PLAYGROUND_HERDR_ALONE).toBe("1")
  })

  test("says nothing when the shell exported neither", () => {
    expect(devEnv({ HOME: "/Users/a" }, "abc1234").notes).toEqual([])
  })

  test("hands the stack HEAD's sha as GIT_SHA, over one the shell exported", () => {
    expect(devEnv({ GIT_SHA: "0000000" }, "abc1234").env.GIT_SHA).toBe("abc1234")
  })

  test("leaves GIT_SHA unset when git names no HEAD, so the baked sha stands", () => {
    expect(devEnv({}, "").env.GIT_SHA).toBeUndefined()
  })

  test("sets portless's settings over the shell's, and keeps its other ones", () => {
    const { env } = devEnv({ PORTLESS: "0", PORTLESS_SYNC_HOSTS: "1" }, "abc1234")
    expect(env).toMatchObject({ ...PORTLESS, PORTLESS: "0" })
  })

  // portless's own default is https on 443, the proxy `portless service install` keeps; the launcher no longer moves every stack to plain http on a port of its own.
  test("leaves portless's proxy, https on its own port, to portless", () => {
    const { env } = devEnv({}, "abc1234")
    expect(env.PORTLESS_HTTPS).toBeUndefined()
    expect(env.PORTLESS_PORT).toBeUndefined()
  })
})

describe("dashboardEnv", () => {
  test("tells the live dashboard's apps the bare names are theirs too", () => {
    expect(dashboardEnv({ branch: LIVE_DASHBOARD.branch, linked: true })).toEqual({
      PLAYGROUND_BARE_NAMES: "1",
    })
  })

  test("tells any other checkout nothing", () => {
    for (const branch of ["feat/a", "main", null]) {
      expect(dashboardEnv({ branch, linked: branch !== "main" })).toEqual({})
    }
  })

  // The apps' ports are portless's pick, so a fixed port would be one nothing listens on (on the live dashboard once: both bare names 502).
  test("leaves each app's port to portless", async () => {
    for (const pkg of ["api/hono", "web/next"]) {
      const { scripts } = await Bun.file(join(ROOT, pkg, "package.json")).json()
      expect([pkg, scripts.dev]).toEqual([pkg, "portless"])
    }
  })
})

describe("syncAliases", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-aliases-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))
  const state = (name: string, list: { hostname: string; pid: number; port: number }[]) => {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, "routes.json"), JSON.stringify(list))
    return join(dir, name)
  }
  const routesIn = async (folder: string) =>
    Object.fromEntries(
      (
        (await Bun.file(join(folder, "routes.json")).json()) as { hostname: string; port: number }[]
      ).map((route) => [route.hostname, route.port]),
    )
  const PAIRS = dashboardAliasPairs("desk")

  test("pairs each bare name with the live dashboard's own name", () => {
    expect(PAIRS).toEqual([
      ["desk.api.playground.localhost", "api.playground.localhost"],
      ["desk.playground.localhost", "playground.localhost"],
    ])
  })

  test("points each bare name at the port the dashboard's stack bound, whatever it is", async () => {
    const folder = state("bound", [
      { hostname: "desk.api.playground.localhost", pid: process.pid, port: 4237 },
      { hostname: "desk.playground.localhost", pid: process.pid, port: 4950 },
    ])
    expect(syncAliases(PAIRS, folder)).toEqual({
      failed: [],
      wrote: ["api.playground.localhost -> 4237", "playground.localhost -> 4950"],
    })
    expect(await routesIn(folder)).toMatchObject({
      "api.playground.localhost": 4237,
      "playground.localhost": 4950,
    })
  })

  test("follows the stack to new ports, and writes nothing while they hold", async () => {
    const folder = state("moved", [
      { hostname: "desk.playground.localhost", pid: process.pid, port: 4111 },
      { hostname: "playground.localhost", pid: 0, port: 4950 },
    ])
    expect(syncAliases(PAIRS, folder).wrote).toEqual(["playground.localhost -> 4111"])
    expect(syncAliases(PAIRS, folder)).toEqual({ failed: [], wrote: [] })
    expect((await routesIn(folder))["playground.localhost"]).toBe(4111)
  })

  test("leaves an alias alone while its stack's route is not up", async () => {
    const folder = state("down", [{ hostname: "playground.localhost", pid: 0, port: 4950 }])
    expect(syncAliases(PAIRS, folder)).toEqual({ failed: [], wrote: [] })
    expect(await routesIn(folder)).toEqual({ "playground.localhost": 4950 })
  })

  test("names a bare name a running stack holds, and never takes it", async () => {
    const folder = state("held", [
      { hostname: "desk.playground.localhost", pid: process.pid, port: 4111 },
      { hostname: "playground.localhost", pid: process.pid, port: 4300 },
    ])
    const synced = syncAliases(PAIRS, folder)
    expect(synced.wrote).toEqual([])
    expect(synced.failed).toHaveLength(1)
    expect(synced.failed[0]).toStartWith("playground.localhost: ")
    expect((await routesIn(folder))["playground.localhost"]).toBe(4300)
  })
})

describe("moveRoute", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-move-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))
  const state = (name: string, list: { hostname: string; pid: number; port: number }[]) => {
    mkdirSync(join(dir, name), { recursive: true })
    writeFileSync(join(dir, name, "routes.json"), JSON.stringify(list))
    return join(dir, name)
  }
  const routesIn = async (folder: string) =>
    (await Bun.file(join(folder, "routes.json")).json()) as {
      hostname: string
      pid: number
      port: number
    }[]

  test("moves the web's route to the next server's port in one write, under the same owner", async () => {
    const folder = state("same", [
      { hostname: "desk.api.playground.localhost", pid: process.pid, port: 4237 },
      { hostname: "desk.playground.localhost", pid: process.pid, port: 4950 },
    ])
    moveRoute("desk.playground.localhost", 5011, process.pid, folder)
    expect(await routesIn(folder)).toMatchObject([
      { hostname: "desk.api.playground.localhost", pid: process.pid, port: 4237 },
      { hostname: "desk.playground.localhost", pid: process.pid, port: 5011 },
    ])
  })

  test("refuses a route another live process holds, and leaves it as it was", async () => {
    const other = Bun.spawn(["sleep", "30"])
    try {
      const folder = state("held", [
        { hostname: "desk.playground.localhost", pid: other.pid, port: 4950 },
      ])
      expect(() => moveRoute("desk.playground.localhost", 5011, process.pid, folder)).toThrow()
      expect(await routesIn(folder)).toMatchObject([
        { hostname: "desk.playground.localhost", pid: other.pid, port: 4950 },
      ])
    } finally {
      other.kill()
    }
  })
})

describe("heldBareHosts", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-routes-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))
  const routes = (list: { hostname: string; pid: number; port: number }[]) =>
    writeFileSync(join(dir, "routes.json"), JSON.stringify(list))

  test("names a bare name an alias holds, and none of any other route", () => {
    routes([
      { hostname: "playground.localhost", pid: 0, port: 4950 },
      { hostname: "feat.playground.localhost", pid: 0, port: 4950 },
      { hostname: "feat.api.playground.localhost", pid: process.pid, port: 4100 },
    ])
    expect(heldBareHosts(dir)).toEqual(["playground.localhost"])
  })

  test("names one a running stack holds, and drops one whose stack has gone", () => {
    const gone = Bun.spawnSync(["true"]).pid
    routes([
      { hostname: "api.playground.localhost", pid: process.pid, port: 4100 },
      { hostname: "playground.localhost", pid: gone, port: 4101 },
    ])
    expect(heldBareHosts(dir)).toEqual(["api.playground.localhost"])
  })

  test("names none with no routes file", () => {
    expect(heldBareHosts(join(dir, "missing"))).toEqual([])
  })
})

// The leftovers this machine carried (22 Oct): an earlier dashboard's aliases, pid 0 on ports nothing listens on, which portless keeps forever and a stack on the bare names then conflicts with.
describe("clearStaleAliases", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-stale-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))
  const folder = (name: string, list: { hostname: string; pid: number; port: number }[]) => {
    const path = join(dir, name)
    mkdirSync(path)
    if (list.length > 0) writeFileSync(join(path, "routes.json"), JSON.stringify(list))
    return path
  }
  const silent = async () => false

  test("a fresh machine: clears nothing, and a stack takes the bare names", async () => {
    const path = folder("fresh", [])
    expect(await clearStaleAliases(path, silent)).toEqual([])
    new RouteStore(path).addRoute("playground.localhost", 4300, process.pid)
    expect(new RouteStore(path).loadRoutes().map((route) => route.hostname)).toEqual([
      "playground.localhost",
    ])
  })

  test("a machine with leftovers: clears both, so a stack takes the names portless refused it", async () => {
    const leftovers = [
      { hostname: "playground.localhost", pid: 0, port: 4318 },
      { hostname: "api.playground.localhost", pid: 0, port: 4922 },
    ]
    const before = folder("refused", leftovers)
    expect(() =>
      new RouteStore(before).addRoute("playground.localhost", 4300, process.pid),
    ).toThrow(RouteConflictError)
    const path = folder("leftovers", leftovers)
    expect(await clearStaleAliases(path, silent)).toEqual([
      "playground.localhost -> 4318",
      "api.playground.localhost -> 4922",
    ])
    expect(heldBareHosts(path)).toEqual([])
    new RouteStore(path).addRoute("playground.localhost", 4300, process.pid)
  })

  test("keeps an alias whose port answers, a running stack's route and every other name", async () => {
    const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
    try {
      const path = folder("kept", [
        { hostname: "playground.localhost", pid: 0, port: server.port },
        { hostname: "api.playground.localhost", pid: process.pid, port: 4100 },
        { hostname: "feat.playground.localhost", pid: 0, port: 4999 },
      ])
      expect(await clearStaleAliases(path)).toEqual([])
      expect(heldBareHosts(path)).toEqual(["playground.localhost", "api.playground.localhost"])
    } finally {
      server.stop(true)
    }
  })
})

describe("fixtureStackEnv", () => {
  test("hands a fixture stack the folder the launcher wrote, and that the launcher owns it", () => {
    expect(
      fixtureStackEnv({ PLAYGROUND_FIXTURE_DIR: "elsewhere", HOME: "/h" }, "/c/.turbo/f"),
    ).toEqual({
      PLAYGROUND_FIXTURE_DIR: "/c/.turbo/f",
      PLAYGROUND_FIXTURE_LAUNCHED: "1",
      HOME: "/h",
    })
  })
})

describe("isDryRun", () => {
  test("turbo's dry run, either spelling, bare or as json", () => {
    for (const arg of ["--dry", "--dry=json", "--dry-run", "--dry-run=json"]) {
      expect(isDryRun(["--filter=@api/hono", arg])).toBe(true)
    }
  })

  test("nothing else", () => {
    expect(isDryRun([])).toBe(false)
    expect(isDryRun(["--ui", "stream", "--dryer", "--filter=dry"])).toBe(false)
  })
})

describe("prefixOf", () => {
  test("cleans the branch's last segment as portless does", () => {
    const cases: [string, string | null][] = [
      ["feat/a", "a"],
      ["feat/Desk", "desk"],
      ["feat/desk-", "desk"],
      ["feat/desk_", "desk"],
      ["feat/_desk", "desk"],
      ["live/desk", "desk"],
      ["feat/a.b__c", "a-b-c"],
      ["feat/main", "main"],
    ]
    for (const [branch, prefix] of cases)
      expect([branch, prefixOf(branch)]).toEqual([branch, prefix])
  })

  test("gives none on main or master, or when nothing is left", () => {
    for (const branch of ["main", "master", "feat/___", "feat/--"]) {
      expect([branch, prefixOf(branch)]).toEqual([branch, null])
    }
  })
})

// Each repo is a scratch one under the system's temp folder, with git's own settings and this machine's left out.
const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  PATH: process.env.PATH ?? "",
}

const gitIn = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    env: GIT_ENV,
    stdin: "ignore",
  })
  expect({ args, code: result.exitCode }).toEqual({ args, code: 0 })
}

describe("checkoutOf", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-checkout-"))
  const main = join(dir, "main")
  const linked = join(dir, "linked")
  afterAll(() => rmSync(dir, { force: true, recursive: true }))

  test("reads the branch, and whether the checkout is a linked worktree, as portless does", () => {
    mkdirSync(main)
    gitIn(main, "init", "-q", "-b", "main")
    gitIn(main, "commit", "-q", "--allow-empty", "-m", "first")
    gitIn(main, "worktree", "add", "-q", "-b", "feat/a", linked)
    expect(checkoutOf(main)).toEqual({ branch: "main", linked: false })
    expect(checkoutOf(linked)).toEqual({ branch: "feat/a", linked: true })
    gitIn(linked, "switch", "-q", "--detach")
    expect(checkoutOf(linked)).toEqual({ branch: null, linked: true })
  })
})

describe("envGaps", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-gaps-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))

  // A checkout of its own for each case: its .env files, and api/hono as the API's working directory.
  const checkout = (name: string, files: Record<string, string>) => {
    const root = join(dir, name)
    mkdirSync(join(root, "api/hono"), { recursive: true })
    for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text)
    return root
  }
  const read = async (root: string, exported: Record<string, string> = {}) =>
    envGaps(
      root,
      { PATH: process.env.PATH ?? "", ...exported },
      join(ROOT, "packages/env/dist/gaps.mjs"),
    )

  test("a .env with every required key has no gaps", async () => {
    const root = checkout("full", {
      ".env": [
        ...envLines(REQUIRED),
        "POSTGRES_URL=postgres://postgres:pw@127.0.0.1:5432/postgres",
      ].join("\n"),
    })
    expect(await read(root)).toEqual({
      empty: [],
      missing: [],
      ok: true,
      refusal: "fill each from .env.example",
    })
  })

  // one read a case, as in the tests beside it: each starts a bun child, and two in one test passed the serial pass's 5s on a loaded runner
  test.each([
    ["no-url", []],
    ["blank-url", ["POSTGRES_URL="]],
  ])(
    "never names POSTGRES_URL, left out or empty, since the API then starts in setup mode (%s)",
    async (name, extra) => {
      expect(
        await read(checkout(name, { ".env": [...envLines(REQUIRED), ...extra].join("\n") })),
      ).toEqual({
        empty: [],
        missing: [],
        ok: true,
        refusal: "fill each from .env.example",
      })
    },
  )

  test("names each key the .env lacks, with the apps that read it, and the refusal says where to fill them", async () => {
    const read0 = await read(checkout("partial", { ".env": "NODE_ENV=local\n" }))
    expect(read0.ok).toBe(true)
    if (!read0.ok) return
    expect(read0.missing).toContain("HONO_APP_URL (api-hono, auth)")
    expect(read0.missing).toContain("BETTER_AUTH_SECRET (auth)")
    expect(read0.missing).toContain("NEXT_PUBLIC_APP_URL (web-next)")
    expect(read0.refusal).toContain("the .env lacks keys the apps require: ")
    expect(read0.refusal).toContain("fill each from .env.example")
  })

  test("a key left empty is named as empty, not missing, after the missing ones", async () => {
    const read0 = await read(checkout("blank", { ".env": "NODE_ENV=local\nBETTER_AUTH_SECRET=\n" }))
    expect(read0.ok).toBe(true)
    if (!read0.ok) return
    expect(read0.empty).toContain("BETTER_AUTH_SECRET (auth)")
    expect(read0.missing).not.toContain("BETTER_AUTH_SECRET (auth)")
    expect(read0.refusal).toMatch(
      /left empty: BETTER_AUTH_SECRET \(auth\); fill each from \.env\.example$/,
    )
  })

  test("a key that may be blank, or one with a default, never appears", async () => {
    const read0 = await read(checkout("blankable", { ".env": "NODE_ENV=local\n" }))
    expect(read0.ok).toBe(true)
    if (!read0.ok) return
    for (const gap of [...read0.missing, ...read0.empty]) {
      expect(gap).not.toContain("AGENT_SIGNIN_ENABLED")
      expect(gap).not.toContain("HONO_PORT")
      expect(gap).not.toContain("PLAYGROUND_DISPATCHER")
    }
  })

  test("a value the shell exports counts as set", async () => {
    const root = checkout("exported", { ".env": "NODE_ENV=local\n" })
    const read0 = await read(root, {
      ...REQUIRED,
      POSTGRES_URL: "postgres://postgres:pw@127.0.0.1:5432/postgres",
    })
    expect(read0).toEqual({
      empty: [],
      missing: [],
      ok: true,
      refusal: "fill each from .env.example",
    })
  })

  test("a key .env.example does not hold is never named, since no .env line can set it", async () => {
    const root = checkout("derived", {
      ".env.example": [
        "BETTER_AUTH_SECRET=",
        "HONO_APP_URL=",
        "NEXT_PUBLIC_API_URL=",
        "NEXT_PUBLIC_APP_URL=",
        "NODE_ENV=local",
        "POSTGRES_URL=",
      ].join("\n"),
      ".env": "HONO_APP_URL=http://localhost:4000\n",
    })
    const read0 = await read(root)
    expect(read0.ok).toBe(true)
    if (!read0.ok) return
    expect(read0.missing).toContain("NODE_ENV (api-hono, auth, db, web-next)")
    expect(read0.missing).not.toContain("NEXT_PUBLIC_NODE_ENV (web-next)")
  })

  // launch.ts is loaded by the launcher before its own build of @packages/env, so the gaps module is read in the call, never at the top: with the built module aside the file still loads, and a static import fails this probe.
  test("launch.ts loads with @packages/env's built gaps module aside, since the launcher builds env later", () => {
    const built = join(ROOT, "packages/env/dist/gaps.mjs")
    const aside = `${built}.launch-test`
    renameSync(built, aside)
    try {
      const probe = Bun.spawnSync(
        [
          "bun",
          "--no-env-file",
          "-e",
          `await import(${JSON.stringify(join(ROOT, "api/hono/src/lib/dev/launch.ts"))}); process.stdout.write("loaded")`,
        ],
        { stderr: "pipe", stdin: "ignore", stdout: "pipe" },
      )
      expect(probe.stderr.toString()).not.toContain("Cannot find module")
      expect(probe.stdout.toString()).toBe("loaded")
    } finally {
      renameSync(aside, built)
    }
  })

  test("a child that answers ok: false hands the error back unchanged", async () => {
    const stub = join(dir, "error-gaps.mjs")
    writeFileSync(
      stub,
      `export const readEnvGaps = () => ({ error: "the inner read failed", ok: false })\n`,
    )
    const root = checkout("error", { ".env": "NODE_ENV=local\n" })
    expect(await envGaps(root, { PATH: process.env.PATH ?? "" }, stub)).toEqual({
      error: "the inner read failed",
      ok: false,
    })
  })
})

describe("apiSettings", () => {
  // this checkout's own build of the loader, which `bun run test` builds first
  const loader = Bun.resolveSync("@packages/env/load-dotenv", join(ROOT, "api/hono"))
  const dir = mkdtempSync(join(tmpdir(), "dev-url-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))

  // A checkout of its own for each case: its .env files, and api/hono as the API's working directory.
  const checkout = (name: string, files: Record<string, string>) => {
    const root = join(dir, name)
    mkdirSync(join(root, "api/hono"), { recursive: true })
    for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text)
    return root
  }
  const read = (root: string, exported: Record<string, string> = {}) =>
    apiSettings(root, { PATH: process.env.PATH ?? "", ...exported }, loader)

  test("reads .env from the checkout's root", () => {
    const root = checkout("base", { ".env": "POSTGRES_URL=postgres://base\n" })
    expect(read(root)).toEqual({
      ok: true,
      settings: { POSTGRES_URL: "postgres://base" },
    })
  })

  test("an exported POSTGRES_URL wins over .env, as the API sees it", () => {
    const root = checkout("exported", { ".env": "POSTGRES_URL=postgres://base\n" })
    expect(read(root, { POSTGRES_URL: "postgres://shell" })).toEqual({
      ok: true,
      settings: { POSTGRES_URL: "postgres://shell" },
    })
  })

  test("the stage's own file wins over both", () => {
    const root = checkout("staged", {
      ".env": "NODE_ENV=local\nPOSTGRES_URL=postgres://base\n",
      ".env.local": "POSTGRES_URL=postgres://staged\n",
    })
    expect(read(root, { POSTGRES_URL: "postgres://shell" })).toEqual({
      ok: true,
      settings: { NODE_ENV: "local", POSTGRES_URL: "postgres://staged" },
    })
  })

  test("reads who runs the stack, a factory role and Claude Code, from the shell it starts in", () => {
    const root = checkout("agent", {})
    expect(read(root, { CLAUDECODE: "1", PLAYGROUND_ROLE: "worker" })).toEqual({
      ok: true,
      settings: { CLAUDECODE: "1", PLAYGROUND_ROLE: "worker" },
    })
  })

  test("reads where the dashboard's data comes from as the API will, an empty value as unset and an old name under its new one", () => {
    const root = checkout("dashboard", {
      ".env": [
        "PLAYGROUND_FIXTURE=fixtures/mine.json",
        "DESK_LIVE_READS=", // read as PLAYGROUND_LIVE_READS
        "DESK_FIXTURE_DIR=scratch/fx", // read as PLAYGROUND_FIXTURE_DIR
        "",
      ].join("\n"),
    })
    expect(read(root)).toEqual({
      ok: true,
      settings: {
        PLAYGROUND_FIXTURE: "fixtures/mine.json",
        PLAYGROUND_FIXTURE_DIR: "scratch/fx",
      },
    })
  })

  test("is empty when nothing sets them", () => {
    expect(read(checkout("none", {}))).toEqual({ ok: true, settings: {} })
  })

  test("a read that fails says why, rather than reading as unset", () => {
    const failed = apiSettings(
      checkout("broken", {}),
      { PATH: process.env.PATH ?? "" },
      join(dir, "missing-loader.mjs"),
    )
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.error).toContain("missing-loader.mjs")
  })
})

const URL = "postgres://postgres:pw@127.0.0.1:33001/postgres"
const BRANCH = { branch: "feat/a", linked: true }
// cmux answering this process, as it answers one in a cmux terminal; the attachment tests below say otherwise
const attach = async (): Promise<Attachment> => ({ state: "attached" })
// The API's settings: a factory stack's, which reads the fixture, unless a test adds others.
const FACTORY = { PLAYGROUND_ROLE: "worker" }
const read =
  (url: string | undefined, settings: Record<string, string> = FACTORY): (() => SettingsRead) =>
  () => ({ ok: true, settings: { POSTGRES_URL: url, ...settings } })
// A person's own clone, outside the factory's folders, and a worker's worktree.
const OWN_ROOT = "/home/me/dispatcher"
const FACTORY_ROOT = "/home/me/dispatcher/.claude/worktrees/pg-1"
// A live-reads stack that opts in to cmux's sessions, as the attachment tests below need.
const OPT_IN = { PLAYGROUND_CMUX_SESSIONS: "true" }
const LIVE_READS = { ...OPT_IN, PLAYGROUND_LIVE_READS: "1" }

// Stand-ins for the guard: the container that publishes the port, or the guard's own refusal, and a proof that records each call.
const located = (name: string): Located => ({
  owner: { addresses: ["127.0.0.1"], id: `${name}-id`, image: "postgres:alpine", name },
  target: { database: "postgres", host: "127.0.0.1", port: 33001 },
})
const failing = (failure: GuardFailure, message: string) => () => {
  throw new GuardError(failure, message)
}
const proving = () => {
  const calls: string[] = []
  const prove = async (url: string, { owner }: Located) => {
    calls.push(owner.name)
    return `${url} is ${owner.name}`
  }
  return { calls, prove }
}
// A database the migration has filled; the empty-database tests below name the refusal instead.
const seeded = async (): Promise<number> => 2

describe("preflight", () => {
  // The branch comes first, so a CI runner's detached HEAD refuses before anything asks cmux.
  test("refuses a detached HEAD, which portless gives no branch prefix, before asking cmux or reading POSTGRES_URL", async () => {
    let reads = 0
    let asked = 0
    const checked = await preflight(
      { branch: null, linked: true },
      () => {
        reads++
        return { ok: true, settings: { POSTGRES_URL: URL } }
      },
      {
        attach: async () => {
          asked++
          return { state: "attached" }
        },
      },
    )
    expect([asked, reads]).toEqual([0, 0])
    expect(checked.ok).toBe(false)
    if (!checked.ok) {
      expect(checked.refusal).toStartWith("this checkout is on a detached HEAD")
      expect(checked.refusal).toContain("git switch -c <name>")
    }
  })

  test("refuses main, master or a branch that cleans to nothing in a linked worktree, which portless gives no prefix either", async () => {
    for (const branch of ["main", "master", "feat/___"]) {
      const checked = await preflight({ branch, linked: true }, read(URL), { attach })
      expect(checked.ok).toBe(false)
      if (!checked.ok) expect(checked.refusal).toStartWith(`this worktree is on ${branch}`)
    }
    const { prove } = proving()
    const mainCheckout = await preflight({ branch: "main", linked: false }, read(URL), {
      attach,
      bare: () => [],
      locate: () => located("playground-a-db"),
      prove,
      tables: seeded,
    })
    expect(mainCheckout.ok).toBe(true)
  })

  // On this machine the live dashboard holds the bare names through its aliases, so a clone on main, or the main checkout, would take them from it; on a machine whose own clone is the dashboard, nothing holds them and that clone takes them.
  test("refuses a checkout portless gives the bare names while they are held, before reading its settings", async () => {
    for (const branch of ["main", "canary", "feat/a"]) {
      let reads = 0
      const checked = await preflight(
        { branch, linked: false },
        () => {
          reads++
          return { ok: true, settings: { POSTGRES_URL: URL } }
        },
        { attach, bare: () => ["playground.localhost"] },
      )
      expect(reads).toBe(0)
      expect(checked.ok).toBe(false)
      if (!checked.ok) {
        expect(checked.refusal).toStartWith("this checkout is not a linked worktree")
        expect(checked.refusal).toContain("(playground.localhost)")
        expect(checked.refusal).toContain(".claude/worktrees/")
      }
    }
  })

  test("never reads the routes for a linked worktree, which portless gives its branch's names", async () => {
    let asked = 0
    const { prove } = proving()
    const checked = await preflight(BRANCH, read(URL), {
      attach,
      bare: () => {
        asked++
        return ["playground.localhost"]
      },
      locate: () => located("playground-a-db"),
      prove,
      tables: seeded,
    })
    expect([asked, checked.ok]).toEqual([0, true])
  })

  test("never reads the routes under PORTLESS=0, whose stack takes fixed ports and no names", async () => {
    let asked = 0
    const { prove } = proving()
    const before = process.env.PORTLESS
    process.env.PORTLESS = "0"
    try {
      const checked = await preflight({ branch: "main", linked: false }, read(URL), {
        attach,
        bare: () => {
          asked++
          return ["playground.localhost"]
        },
        locate: () => located("playground-a-db"),
        prove,
        tables: seeded,
      })
      expect([asked, checked.ok]).toEqual([0, true])
    } finally {
      if (before === undefined) delete process.env.PORTLESS
      else process.env.PORTLESS = before
    }
  })

  test("refuses a branch whose prefix would be the live dashboard's own", async () => {
    for (const branch of ["feat/Dashboard", "feat/dashboard_", "try/-dashboard-"]) {
      const checked = await preflight({ branch, linked: true }, read(URL), { attach })
      expect(checked.ok).toBe(false)
      if (!checked.ok) {
        expect(checked.refusal).toStartWith(`branch ${branch} takes portless's prefix dashboard`)
      }
    }
  })

  test("refuses a live-reading start cmux would not answer while a session is live in cmux, before locating its database, naming the fix for each way", async () => {
    const cases: [Attachment, string][] = [
      [
        { detail: "Start the app from a cmux terminal", state: "detached" },
        "this process does not descend from a cmux terminal",
      ],
      [
        { detail: "cmux is not installed or not on PATH", state: "missing" },
        "cmux is not installed",
      ],
      [
        { detail: "cmux list-workspaces failed: socket not found", state: "unreachable" },
        "cmux did not answer a read (cmux list-workspaces failed: socket not found)",
      ],
    ]
    for (const [reach, refusal] of cases) {
      let locates = 0
      const checked = await preflight(BRANCH, read(URL, LIVE_READS), {
        attach: async () => reach,
        held: async () => ["builder"],
        locate: () => {
          locates++
          return located("playground-a-db")
        },
      })
      expect(locates).toBe(0)
      expect(checked.ok).toBe(false)
      if (!checked.ok) {
        expect(checked.refusal).toStartWith(refusal)
        expect(checked.refusal).toContain(
          "only while no factory session is live in cmux, and 1 is: builder",
        )
      }
    }
  })

  // with every session on herdr, a dashboard started outside cmux reads herdr alone; ps and the registry say whether cmux holds one, since cmux will not answer
  test("starts a live-reading stack cmux would not answer once no session is live in cmux, reading herdr alone", async () => {
    for (const reach of [
      { detail: "Start the app from a cmux terminal", state: "detached" },
      { detail: "cmux is not installed or not on PATH", state: "missing" },
    ] as const) {
      const { prove } = proving()
      const checked = await preflight(BRANCH, read(URL, LIVE_READS), {
        attach: async () => reach,
        held: async () => [],
        locate: () => located("playground-a-db"),
        prove,
        tables: seeded,
      })
      expect(checked).toMatchObject({
        dashboard: { cmux: false, kind: "live", reason: reach.detail },
        ok: true,
      })
    }
  })

  test("refuses a live-reading start cmux would not answer when ps or the registry cannot say whether cmux holds a session", async () => {
    const checked = await preflight(BRANCH, read(URL, LIVE_READS), {
      attach: async () => ({ detail: "Start the app from a cmux terminal", state: "detached" }),
      held: async () => null,
    })
    expect(checked.ok).toBe(false)
    if (!checked.ok)
      expect(checked.refusal).toContain("could not be read from ps and Claude's registry")
  })

  test("asks nothing of ps or the registry while cmux answers", async () => {
    let asked = 0
    const { prove } = proving()
    const checked = await preflight(BRANCH, read(URL, LIVE_READS), {
      attach,
      held: async () => {
        asked++
        return []
      },
      locate: () => located("playground-a-db"),
      prove,
      tables: seeded,
    })
    expect(asked).toBe(0)
    expect(checked).toMatchObject({ dashboard: { cmux: true, kind: "live" }, ok: true })
  })

  // A fixture stack reads no cmux, so asking whether cmux answers it would open the live socket for nothing; a detached one leaks nothing.
  test("starts a fixture stack without asking cmux, carrying the fixture it will write", async () => {
    let asked = 0
    const { prove } = proving()
    const checked = await preflight(BRANCH, read(URL), {
      attach: async () => {
        asked++
        return { state: "attached" }
      },
      locate: () => located("playground-a-db"),
      prove,
      tables: seeded,
    })
    expect(asked).toBe(0)
    expect(checked.ok).toBe(true)
    if (checked.ok) {
      expect(checked.dashboard.kind).toBe("fixture")
      if (checked.dashboard.kind === "fixture") {
        expect(checked.dashboard.fixture.cmux.sessions.length).toBeGreaterThan(0)
      }
    }
  })

  test("refuses a fixture that does not load, before asking cmux or locating the database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dev-fixture-"))
    writeFileSync(join(dir, "broken.json"), "{ not json")
    writeFileSync(join(dir, "shapeless.json"), JSON.stringify({ anchor: "now" }))
    for (const [file, words] of [
      ["broken.json", "does not read as JSON"],
      ["shapeless.json", "is not a fixture: anchor"],
    ] as const) {
      let touched = 0
      const checked = await preflight(BRANCH, read(URL, { PLAYGROUND_FIXTURE: file }), {
        attach: async () => {
          touched++
          return { state: "attached" }
        },
        locate: () => {
          touched++
          return located("playground-a-db")
        },
        root: dir,
      })
      expect(touched).toBe(0)
      expect(checked.ok).toBe(false)
      if (!checked.ok) {
        expect(checked.refusal).toContain(join(dir, file))
        expect(checked.refusal).toContain(words)
        expect(checked.refusal).toContain("PLAYGROUND_FIXTURE")
      }
    }
    rmSync(dir, { force: true, recursive: true })
  })

  test("refuses settings that mix the live machine with a made-up one, before asking cmux", async () => {
    const cases: [typeof BRANCH, Record<string, string>, string][] = [
      [
        { branch: LIVE_DASHBOARD.branch, linked: true },
        { PLAYGROUND_FIXTURE: "x.json" },
        "which always reads the live machine",
      ],
      [BRANCH, { ...LIVE_READS, PLAYGROUND_FIXTURE: "x.json" }, "set one of them"],
    ]
    for (const [checkout, settings, words] of cases) {
      let asked = 0
      const checked = await preflight(checkout, read(URL, settings), {
        attach: async () => {
          asked++
          return { state: "attached" }
        },
      })
      expect(asked).toBe(0)
      expect(checked.ok).toBe(false)
      if (!checked.ok) expect(checked.refusal).toContain(words)
    }
  })

  test("asks cmux on the live dashboard's branch and on a live-reads stack that opt in to cmux's sessions, and reads live there", async () => {
    for (const [checkout, settings] of [
      [{ branch: LIVE_DASHBOARD.branch, linked: true }, OPT_IN],
      [BRANCH, LIVE_READS],
    ] as const) {
      let asked = 0
      const { prove } = proving()
      const checked = await preflight(checkout, read(URL, settings), {
        attach: async () => {
          asked++
          return { state: "attached" }
        },
        locate: () => located("playground-a-db"),
        prove,
        tables: seeded,
      })
      expect(asked).toBe(1)
      expect(checked).toMatchObject({ dashboard: { kind: "live" }, ok: true })
    }
  })

  // cmux runs sessions Playground never started (the owner's own, another factory's), so a stack shows them only once it opts in; until then the launcher asks neither cmux nor ps, and a factory session live in cmux holds nothing up
  test("reads the live machine through herdr alone unless the stack opts in to cmux's sessions, asking cmux nothing", async () => {
    for (const [checkout, settings, root] of [
      [{ branch: LIVE_DASHBOARD.branch, linked: true }, {}, undefined],
      [BRANCH, { PLAYGROUND_LIVE_READS: "1" }, undefined],
      [{ branch: "main", linked: false }, { PLAYGROUND_CMUX_SESSIONS: "false" }, OWN_ROOT],
    ] as const) {
      const { prove } = proving()
      const checked = await preflight(checkout, read(URL, settings), {
        attach: async () => {
          throw new Error("a stack that has not opted in asked cmux")
        },
        bare: () => [],
        held: async () => {
          throw new Error("a stack that has not opted in read ps and the registry")
        },
        locate: () => located("playground-a-db"),
        prove,
        root,
        tables: seeded,
      })
      expect(checked).toMatchObject({
        dashboard: { cmux: false, kind: "live", reason: null },
        ok: true,
      })
    }
  })

  test("reads a person's own clone live, asking cmux once it opts in, and names the rule it matched", async () => {
    let asked = 0
    const { prove } = proving()
    const checked = await preflight({ branch: "main", linked: false }, read(URL, OPT_IN), {
      attach: async () => {
        asked++
        return { state: "attached" }
      },
      bare: () => [],
      locate: () => located("playground-a-db"),
      prove,
      root: OWN_ROOT,
      tables: seeded,
    })
    expect(asked).toBe(1)
    expect(checked).toMatchObject({ dashboard: { kind: "live", rule: "own" }, ok: true })
  })

  test("reads the fixture in a worktree under .claude/worktrees/ with no role, never asking cmux", async () => {
    let asked = 0
    const { prove } = proving()
    const checked = await preflight(BRANCH, read(URL, {}), {
      attach: async () => {
        asked++
        return { state: "attached" }
      },
      locate: () => located("playground-a-db"),
      prove,
      root: FACTORY_ROOT,
      tables: seeded,
    })
    expect(asked).toBe(0)
    expect(checked).toMatchObject({ dashboard: { kind: "fixture", rule: "factory" }, ok: true })
  })

  test("refuses an own-machine start under Claude Code with no role, before asking cmux or locating the database", async () => {
    let asked = 0
    let locatedCalls = 0
    const checked = await preflight(
      { branch: "main", linked: false },
      read(URL, { CLAUDECODE: "1" }),
      {
        attach: async () => {
          asked++
          return { state: "attached" }
        },
        locate: () => {
          locatedCalls++
          return located("playground-a-db")
        },
        prove: proving().prove,
        bare: () => [],
        root: OWN_ROOT,
      },
    )
    expect(asked).toBe(0)
    expect(locatedCalls).toBe(0)
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.refusal).toContain("Claude Code")
  })

  test("a launcher a test run spawns in a person's own clone, with no role, reads the fixture and never asks cmux", async () => {
    // the launcher drops the test run's NODE_ENV, so .env's stage decides it; the suite's PLAYGROUND_FIXTURE holds it to the fixture rule
    const { env } = devEnv({ PLAYGROUND_FIXTURE: "shipped", NODE_ENV: "test" }, "")
    expect(env.NODE_ENV).toBeUndefined()
    const checked = await preflight(
      { branch: "main", linked: false },
      read(URL, { PLAYGROUND_FIXTURE: env.PLAYGROUND_FIXTURE ?? "", NODE_ENV: "local" }),
      {
        attach: async () => {
          throw new Error("a test run's launcher asked cmux")
        },
        locate: () => located("playground-a-db"),
        prove: proving().prove,
        bare: () => [],
        root: OWN_ROOT,
        tables: seeded,
      },
    )
    expect(checked).toMatchObject({ dashboard: { kind: "fixture", rule: "fixture" }, ok: true })
  })

  test("refuses settings that cannot be read, with the reader's own words", async () => {
    const checked = await preflight(BRANCH, () => ({ error: "SyntaxError: bad .env", ok: false }), {
      attach,
    })
    expect(checked).toEqual({
      ok: false,
      refusal: "the API's settings could not be read: SyntaxError: bad .env",
    })
  })

  test("a missing POSTGRES_URL starts the stack in setup mode, locating no database", async () => {
    let touched = 0
    const checked = await preflight(BRANCH, read(undefined), {
      attach,
      locate: () => {
        touched++
        return located("playground-a-db")
      },
    })
    expect(touched).toBe(0)
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.proof).toContain("first run")
  })

  // A fresh install's dashboard checkout has no database yet, so its first run makes one as any checkout's does.
  test("a missing POSTGRES_URL on the live dashboard's checkout starts it in setup mode too", async () => {
    const checked = await preflight(
      { branch: LIVE_DASHBOARD.branch, linked: true },
      read(undefined, {}),
      {
        attach,
        containers: () => [
          { name: "playground-a-db", state: "exited" },
          { name: `${LIVE_DASHBOARD.database}-Ab123`, state: "exited" },
          { name: `${LIVE_DASHBOARD.database}-x9Kq`, state: "running" },
        ],
      },
    )
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.proof).toContain("first run")
  })

  // pglaunch reuses only a running container it named itself, so setup there would start a second, empty database beside one it cannot reuse; a running one it named is reused, as Try again does.
  test("a missing POSTGRES_URL on the live dashboard's checkout is refused while its database exists where pglaunch cannot reuse it", async () => {
    const cases = [
      { name: LIVE_DASHBOARD.database, state: "running" },
      { name: LIVE_DASHBOARD.database, state: "exited" },
      { name: `${LIVE_DASHBOARD.database}-x9Kq`, state: "exited" },
    ]
    for (const held of cases) {
      const { name } = held
      const checked = await preflight(
        { branch: LIVE_DASHBOARD.branch, linked: true },
        read(undefined, {}),
        { attach, containers: () => [{ name: "playground-a-db", state: "running" }, held] },
      )
      expect(checked.ok).toBe(false)
      if (!checked.ok) {
        expect(checked.refusal).toStartWith(`POSTGRES_URL is unset, but ${name} holds`)
        expect(checked.refusal).toContain(`docker start ${name}`)
      }
    }
  })

  test("refuses a remote database before anything connects", async () => {
    const checked = await preflight(BRANCH, read("postgres://u:p@example.com/postgres"), { attach })
    expect(checked.ok).toBe(false)
    if (!checked.ok) {
      expect(checked.refusal).toContain("not this machine")
      expect(checked.refusal).toContain("-p 127.0.0.1::5432")
    }
  })

  test("names the fix for each way the guard refuses", async () => {
    const cases: [GuardFailure, string, string][] = [
      ["docker-down", "docker ps failed: Cannot connect", "start Docker"],
      [
        "vanished",
        "container checks-2 was removed while the check read Docker, the second in a row",
        "Docker is up",
      ],
      ["no-docker", "docker is not on PATH", "install Docker"],
      ["no-owner", "no single running Docker container publishes port 33001", "docker start"],
      ["exposed", "playground-a-db publishes port 33001 beyond loopback", "-p 127.0.0.1::5432"],
    ]
    for (const [failure, message, fix] of cases) {
      const checked = await preflight(BRANCH, read(URL), {
        attach,
        locate: failing(failure, message),
      })
      expect(checked.ok).toBe(false)
      if (!checked.ok) {
        expect(checked.refusal).toStartWith(`${message}; `)
        expect(checked.refusal).toContain(fix)
        if (failure === "vanished") expect(checked.refusal).not.toContain("start Docker")
      }
    }
  })

  test("keeps the live dashboard's database to the live dashboard's own branch, refused before the proof runs anything in it", async () => {
    const elsewhere = proving()
    const refused = await preflight(BRANCH, read(URL), {
      attach,
      locate: () => located(LIVE_DASHBOARD.database),
      prove: elsewhere.prove,
    })
    expect(elsewhere.calls).toEqual([])
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.refusal).toContain(
        `points at ${LIVE_DASHBOARD.database}, the live dashboard's database`,
      )
    }
    const dashboard = proving()
    const passed = await preflight({ branch: LIVE_DASHBOARD.branch, linked: true }, read(URL), {
      attach,
      locate: () => located(LIVE_DASHBOARD.database),
      prove: dashboard.prove,
      tables: seeded,
    })
    expect(passed).toMatchObject({
      ok: true,
      proof: `${URL} is ${LIVE_DASHBOARD.database}`,
    })
  })

  test("passes a worktree's own container, carrying the guard's proof", async () => {
    const { calls, prove } = proving()
    expect(
      await preflight(BRANCH, read(URL), {
        attach,
        locate: () => located("playground-a-db"),
        prove,
        tables: seeded,
      }),
    ).toMatchObject({ ok: true, proof: `${URL} is playground-a-db` })
    expect(calls).toEqual(["playground-a-db"])
  })

  test("refuses a database with no tables, naming the migrate command", async () => {
    const checked = await preflight(BRANCH, read(URL), {
      attach,
      locate: () => located("playground-a-db"),
      prove: proving().prove,
      tables: async () => 0,
    })
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.refusal).toBe("database has no tables: run bun run db:migrate")
    const filled = await preflight(BRANCH, read(URL), {
      attach,
      locate: () => located("playground-a-db"),
      prove: proving().prove,
      tables: async () => 2,
    })
    expect(filled).toMatchObject({ ok: true, proof: `${URL} is playground-a-db` })
  })
})

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

// The real guard, against a throwaway container on 127.0.0.1 standing in for the live dashboard's database.
describe.skipIf(!dockerUp())("preflight against a real container", () => {
  const name = `dispatcher-test-preflight-${process.pid}`
  const liveDashboard = { branch: LIVE_DASHBOARD.branch, database: name }
  let url = ""

  beforeAll(async () => {
    const started = Bun.spawnSync([
      "docker",
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "-e",
      "POSTGRES_PASSWORD=preflight-test",
      "-p",
      "127.0.0.1::5432",
      "postgres:18-alpine",
    ])
    expect({ code: started.exitCode, stderr: started.stderr.toString() }).toMatchObject({ code: 0 })
    const port = Bun.spawnSync(["docker", "port", name, "5432/tcp"])
      .stdout.toString()
      .trim()
      .split(":")
      .at(-1)
    url = `postgres://postgres:preflight-test@127.0.0.1:${port}/postgres`
    // over TCP, since the server initdb runs first listens only on the socket and then restarts
    let ready = false
    for (let i = 0; i < 60 && !ready; i++) {
      ready =
        Bun.spawnSync(["docker", "exec", name, "pg_isready", "-h", "127.0.0.1"]).exitCode === 0
      if (!ready) await Bun.sleep(500)
    }
    expect(ready).toBe(true)
  }, 60_000)

  // docker rm -fv of a container on a loaded machine can cross bun's 5s default, the recorded hook timeout
  afterAll(() => {
    Bun.spawnSync(["docker", "rm", "-fv", name], { stderr: "ignore", stdout: "ignore" })
  }, 60_000)

  // A fresh container's database has no tables, so the launcher refuses rather than booting a stack whose sign-in later times out.
  test("refuses a database with no tables, naming the migrate command", async () => {
    const checked = await preflight({ branch: liveDashboard.branch, linked: true }, read(url), {
      attach,
      liveDashboard,
    })
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.refusal).toBe("database has no tables: run bun run db:migrate")
  }, 30_000)

  test("passes the live dashboard's branch, with the proof naming the container", async () => {
    // the refusal test above needs this database with no tables; the marker stands for the schema the migration makes
    const sql = new SQL(url, { max: 1 })
    try {
      await sql`create table if not exists schema_marker (id text primary key)`
    } finally {
      await sql.close()
    }
    const checked = await preflight({ branch: liveDashboard.branch, linked: true }, read(url), {
      attach,
      liveDashboard,
    })
    expect(checked.ok).toBe(true)
    if (checked.ok) expect(checked.proof).toContain(`is ${name} (postgres:18-alpine)`)
  }, 30_000)

  test("refuses any other branch on the container's name alone, before the proof runs", async () => {
    const proofs: string[] = []
    const checked = await preflight(BRANCH, read(url), {
      attach,
      liveDashboard,
      prove: (target, found) => {
        proofs.push(found.owner.name)
        return prove(target, found)
      },
    })
    expect(proofs).toEqual([])
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.refusal).toContain(`points at ${name}`)
  }, 30_000)
})

// bun run ask refuses the live dashboard's database by this same check, so a worktree's inbox item never lands in the owner's inbox.
describe("othersLiveDashboard", () => {
  test("is the live dashboard's database from any branch but its own", () => {
    expect(othersLiveDashboard(LIVE_DASHBOARD.database, "pg-306-inbox")).toBe(true)
    expect(othersLiveDashboard(LIVE_DASHBOARD.database, null)).toBe(true)
    expect(othersLiveDashboard(LIVE_DASHBOARD.database, LIVE_DASHBOARD.branch)).toBe(false)
    expect(othersLiveDashboard("playground-pg-306-inbox-db", "pg-306-inbox")).toBe(false)
  })

  test("is also the one first run started on the live checkout, which pglaunch names with a 4-character suffix", () => {
    const started = `${LIVE_DASHBOARD.database}-Ab12`
    expect(othersLiveDashboard(started, "pg-306-inbox")).toBe(true)
    expect(othersLiveDashboard(started, LIVE_DASHBOARD.branch)).toBe(false)
    for (const name of [`${LIVE_DASHBOARD.database}-Ab123`, `${LIVE_DASHBOARD.database}-x`]) {
      expect(othersLiveDashboard(name, "pg-306-inbox")).toBe(false)
    }
  })

  test("bun run ask runs it before it proves or touches the database", async () => {
    const cli = await Bun.file(
      `${import.meta.dir}/../../../../../../api/hono/src/bin/dashboard-ask.ts`,
    ).text()
    const refusal = cli.indexOf("othersLiveDashboard(located.owner.name")
    expect(refusal).toBeGreaterThan(-1)
    expect(refusal).toBeLessThan(cli.indexOf("await prove("))
    expect(refusal).toBeLessThan(cli.indexOf("createDatabase(env.POSTGRES_URL)"))
  })
})

describe("mainCheckoutOf", () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-main-"))
  const main = join(dir, "main")
  const linked = join(dir, "linked")
  afterAll(() => rmSync(dir, { force: true, recursive: true }))

  test("names the main checkout from a linked worktree, as the live dashboard's is", () => {
    mkdirSync(main)
    gitIn(main, "init", "-q", "-b", "main")
    gitIn(main, "commit", "-q", "--allow-empty", "-m", "first")
    gitIn(main, "worktree", "add", "-q", "--detach", linked)
    expect(mainCheckoutOf(linked)).toBe(realpathSync(main))
    expect(mainCheckoutOf(main)).toBe(realpathSync(main))
    expect(mainCheckoutOf(tmpdir())).toBeNull()
  })
})
