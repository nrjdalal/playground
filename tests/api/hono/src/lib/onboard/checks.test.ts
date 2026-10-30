import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const { COMMANDS, firstRunChecks, onboardChecks } =
  await import("../../../../../../api/hono/src/lib/onboard/checks")
const { FIX_IDS, fixtureFixed } = await import("../../../../../../api/hono/src/lib/onboard/fix-ids")
type Reader = import("../../../../../../api/hono/src/lib/onboard/checks").Reader
type Check = import("../../../../../../api/hono/src/lib/onboard/checks").Check

const ORDER = [
  "bun",
  "claude",
  "cmux",
  "docker",
  "Database",
  "gh",
  "git",
  "herdr",
  "Homebrew",
  "node",
  "portless",
  "python3",
  "uv",
  "Settings",
]

const HOME = "/Users/someone"
const CA = `${HOME}/.portless/ca.pem`

// A machine as a script: the tools on PATH, the files there, the loopback ports that take a connection, and each argv's answer keyed by its words; anything else exits 1.
const machine = (
  on: string[],
  answers: Record<string, { code?: number; stdout?: string }> = {},
  files: string[] = [],
  { ports = [443] }: { ports?: number[] } = {},
) => {
  const ran: string[][] = []
  const reader: Reader = {
    exists: (path) => files.includes(path),
    has: (tool) => on.includes(tool),
    listens: async (port) => ports.includes(port),
    run: async (argv) => {
      ran.push(argv)
      return { code: 0, stdout: "", ...(answers[argv.join(" ")] ?? { code: 1 }) }
    },
  }
  return { ran, reader }
}

const TOOLS = [
  "brew",
  "bun",
  "claude",
  "cmux",
  "docker",
  "gh",
  "git",
  "herdr",
  "node",
  "python3",
  "uv",
]

const ANSWERS = {
  "bun --version": { stdout: "1.3.2\n" },
  "claude --version": { stdout: "2.1.4 (Claude Code)\n" },
  "docker info --format {{.ServerVersion}}": { stdout: "28.3.1\n" },
  "gh --version": { stdout: "gh version 2.80.0 (2026-09-01)\n" },
  "gh auth status --active -h github.com": {},
  "git --version": { stdout: "git version 2.51.0\n" },
  "herdr --version": { stdout: "herdr 0.4.2\n" },
  "node --version": { stdout: "v22.11.0\n" },
  "python3 --version": { stdout: "Python 3.13.1\n" },
  [`security verify-cert -c ${CA} -L -p ssl`]: {},
  "uv --version": { stdout: "uv 0.9.2\n" },
}

const everything = () => machine(TOOLS, ANSWERS, [CA])

const live = { kind: "live", rule: "own" } as const
const env = { HOME }
const signedUp = { env, login: () => true, source: live }
const byName = <T extends { name: string }>(checks: T[]): Record<string, T> =>
  Object.fromEntries(checks.map((c) => [c.name, c]))

// The shapes of a command a person would type: the app runs every step itself, so no row's text names one.
const COMMAND =
  /\b(brew |curl |gh auth|open -a|bun run|playground [a-z]|sudo |npx |portless (service|trust))/

const words = (check: Check) => [check.detail, check.need, check.note, check.action?.label]

describe("onboardChecks on a machine it reads", () => {
  test("answers every row in the owner's order, ok with no action or note, through COMMANDS alone", async () => {
    const { ran, reader } = everything()
    const checks = await onboardChecks({ ...signedUp, database: "ok", reader })
    expect(checks.map((c) => c.name)).toEqual(ORDER)
    for (const check of checks)
      expect(check).toMatchObject({ action: null, note: null, status: "ok" })
    expect(byName(checks).node!.detail).toBe("22.11.0")
    expect(byName(checks).Database!.detail).toBe("local Postgres is running")
    const allowed = [
      COMMANDS.caTrusted(CA),
      COMMANDS.dockerInfo(),
      COMMANDS.ghLogin(),
      ...TOOLS.filter((t) => t !== "brew" && t !== "cmux").map((tool) =>
        COMMANDS.version(tool as never),
      ),
    ].map((argv) => argv.join(" "))
    for (const argv of ran) expect(allowed).toContain(argv.join(" "))
  })

  test("reads cmux from PATH alone and never runs it, since cmux runs only through cmux.ts", async () => {
    const { ran, reader } = everything()
    const checks = await onboardChecks({ ...signedUp, database: "ok", reader })
    expect(byName(checks).cmux).toMatchObject({ detail: "installed", status: "ok" })
    expect(ran.some((argv) => argv[0] === "cmux")).toBe(false)
  })

  test("each missing tool names the fix id that installs it, and one with no fix carries a note alone", async () => {
    const { reader } = machine([], {}, [CA])
    const rows = byName(await onboardChecks({ ...signedUp, database: "ok", reader }))
    const actions = Object.fromEntries(
      Object.values(rows).map((row) => [row.name, row.action?.id ?? null]),
    )
    expect(actions).toEqual({
      bun: null,
      claude: "claude",
      cmux: null,
      Database: null,
      docker: "docker",
      gh: "gh-login",
      git: "git",
      herdr: "herdr",
      Homebrew: null,
      node: "node",
      portless: null,
      python3: "python",
      Settings: null,
      uv: null,
    })
    for (const row of Object.values(rows))
      if (row.action && row.action.id !== "settings")
        expect(FIX_IDS as readonly string[]).toContain(row.action.id)
    expect(rows.bun).toMatchObject({ detail: "not found", status: "MISSING" })
    expect(rows.bun!.note).toBeTruthy()
    expect(rows.uv).toMatchObject({ action: null, detail: "not found", status: "optional" })
    expect(rows.uv!.note).toBeTruthy()
  })

  test("gh not signed in, Docker not running and an old node are MISSING, each with its fix", async () => {
    const { reader } = machine(
      TOOLS,
      {
        ...ANSWERS,
        "gh auth status --active -h github.com": { code: 1 },
        "docker info --format {{.ServerVersion}}": { code: 1 },
        "node --version": { stdout: "v18.19.0\n" },
      },
      [CA],
    )
    const rows = byName(await onboardChecks({ ...signedUp, database: { status: "idle" }, reader }))
    expect(rows.gh).toMatchObject({
      action: { id: "gh-login" },
      detail: "not signed in",
      need: "sync and private repos",
      status: "MISSING",
    })
    expect(rows.docker).toMatchObject({
      action: { id: "docker" },
      detail: "not running",
      status: "MISSING",
    })
    expect(rows.node).toMatchObject({
      action: { id: "node" },
      detail: "18.19.0, needs 20.9 or newer",
      status: "MISSING",
    })
  })

  test("no row's words name a command, on a machine with everything missing or broken", async () => {
    const { reader } = machine(["docker", "gh", "node"], {
      "node --version": { stdout: "v18.0.0\n" },
    })
    const checks = await onboardChecks({
      database: { status: "idle" },
      env,
      login: () => false,
      reader,
      source: live,
    })
    for (const check of checks)
      for (const text of words(check)) expect(text ?? "").not.toMatch(COMMAND)
    for (const check of checks)
      if (check.status !== "ok") expect(check.note, check.name).toBeTruthy()
  })
})

describe("the rows the app cannot fix itself", () => {
  test("Homebrew is ok on PATH or in either of its own folders, and optional with a note when absent", async () => {
    const at = async (on: string[], files: string[]) =>
      byName(
        await onboardChecks({
          ...signedUp,
          database: "ok",
          reader: machine(on, ANSWERS, files).reader,
        }),
      ).Homebrew
    expect(await at(["brew"], [])).toMatchObject({ action: null, status: "ok" })
    expect(await at([], ["/opt/homebrew/bin/brew"])).toMatchObject({ status: "ok" })
    expect(await at([], ["/usr/local/bin/brew"])).toMatchObject({ status: "ok" })
    const absent = await at([], [])
    expect(absent).toMatchObject({ action: null, detail: "not found", status: "optional" })
    expect(absent!.note).toBeTruthy()
  })

  test("portless is ok once its proxy answers and its CA is trusted, and optional with a note otherwise", async () => {
    const at = async (files: string[], trusted: boolean, ports = [443]) =>
      byName(
        await onboardChecks({
          ...signedUp,
          database: "ok",
          reader: machine(
            TOOLS,
            { ...ANSWERS, [`security verify-cert -c ${CA} -L -p ssl`]: { code: trusted ? 0 : 1 } },
            files,
            { ports },
          ).reader,
        }),
      ).portless
    expect(await at([CA], true)).toMatchObject({ status: "ok" })
    for (const [files, trusted, ports, detail] of [
      [[CA], true, [], "not running"],
      [[CA], false, [443], "not trusted"],
      [[], true, [443], "not trusted"],
    ] as const) {
      const row = await at([...files], trusted, [...ports])
      expect(row).toMatchObject({ action: null, detail, status: "optional" })
      expect(row!.note).toBeTruthy()
    }
  })

  test("portless's proxy is looked for on the port its state folder saved, by the dev launcher's own rule", async () => {
    const dir = mkdtempSync(join(tmpdir(), "portless-state-"))
    const ca = join(dir, "ca.pem")
    const at = async (ports: number[], extra = {}) =>
      byName(
        await onboardChecks({
          ...signedUp,
          database: "ok",
          env: { HOME, PORTLESS_STATE_DIR: dir, ...extra },
          reader: machine(
            TOOLS,
            { ...ANSWERS, [`security verify-cert -c ${ca} -L -p ssl`]: {} },
            [ca],
            { ports },
          ).reader,
        }),
      ).portless!.detail
    try {
      expect(await at([], { PORTLESS_PORT: "443" })).toBe("not running")
      expect(await at([443], { PORTLESS_PORT: "443" })).toBe("ready")
      writeFileSync(join(dir, "proxy.port"), "444\n")
      expect(await at([443])).toBe("not running")
      expect(await at([444])).toBe("ready")
      writeFileSync(join(dir, "proxy.port"), "1355\n")
      expect(await at([])).toBe("ready")
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })

  test("portless is not needed on a stack started with PORTLESS=0, whatever its proxy and CA", async () => {
    const { reader } = machine(TOOLS, ANSWERS, [], { ports: [] })
    const rows = byName(
      await onboardChecks({ ...signedUp, database: "ok", env: { HOME, PORTLESS: "0" }, reader }),
    )
    expect(rows.portless).toMatchObject({
      action: null,
      detail: "not needed",
      note: null,
      status: "ok",
    })
  })

  test("portless reads its CA from PORTLESS_STATE_DIR when it is set", async () => {
    const ca = "/elsewhere/ca.pem"
    const { reader } = machine(
      TOOLS,
      { ...ANSWERS, [`security verify-cert -c ${ca} -L -p ssl`]: {} },
      [ca],
    )
    const rows = byName(
      await onboardChecks({
        ...signedUp,
        database: "ok",
        env: { HOME, PORTLESS_STATE_DIR: "/elsewhere" },
        reader,
      }),
    )
    expect(rows.portless!.status).toBe("ok")
  })

  test("Settings is ok once a login is named, else optional with Settings' step as its action", async () => {
    const { reader } = everything()
    const rows = byName(
      await onboardChecks({ database: "ok", env, login: () => false, reader, source: live }),
    )
    expect(rows.Settings).toMatchObject({ action: { id: "settings" }, status: "optional" })
    expect(rows.Settings!.note).toBeTruthy()
  })
})

describe("the Database row", () => {
  const run = async (
    database: Parameters<typeof onboardChecks>[0]["database"],
    dockerUp = true,
  ) => {
    const { reader } = machine(
      ["docker"],
      dockerUp ? { "docker info --format {{.ServerVersion}}": { stdout: "28.3.1\n" } } : {},
    )
    return byName(await onboardChecks({ ...signedUp, database, reader })).Database
  }

  test("waits on docker, then reads setup's state until the database runs, with Start as its action", async () => {
    expect(await run({ status: "idle" }, false)).toMatchObject({ action: null, status: "waiting" })
    expect(await run({ status: "idle" })).toMatchObject({
      action: { id: "database" },
      detail: "not started",
      status: "MISSING",
    })
    expect(await run({ status: "starting", step: "Waiting for Postgres" })).toMatchObject({
      action: null,
      detail: "Waiting for Postgres",
      status: "waiting",
    })
    expect(await run({ reason: "Postgres did not start", status: "failed" })).toMatchObject({
      action: { id: "database" },
      detail: "Postgres did not start",
      status: "MISSING",
    })
    expect(await run("ok", false)).toMatchObject({ action: null, status: "ok" })
  })
})

// The done mark as the database would hold it, counting each read and write.
const memoryMark = (done = false) => {
  const mark = { done, reads: 0, writes: 0 }
  return {
    mark,
    store: {
      read: async () => (mark.reads++, mark.done),
      write: async () => {
        mark.writes++
        mark.done = true
      },
    },
  }
}

describe("firstRunChecks and the done mark", () => {
  test("with no database it answers the rows and done false, and never reaches a mark", async () => {
    const { reader } = everything()
    const answer = await firstRunChecks({
      ...signedUp,
      database: { status: "idle" },
      mark: null,
      reader,
    })
    expect(answer.done).toBe(false)
    expect(answer.checks.map((c) => c.name)).toEqual(ORDER)
  })

  test("writes the mark only once every row is ok or optional and the database runs", async () => {
    const { reader } = machine(
      TOOLS,
      { ...ANSWERS, "gh auth status --active -h github.com": { code: 1 } },
      [CA],
    )
    const { mark, store } = memoryMark()
    const missing = await firstRunChecks({ ...signedUp, database: "ok", mark: store, reader })
    expect(missing.done).toBe(false)
    expect(mark.writes).toBe(0)

    const optional = machine(
      TOOLS.filter((t) => t !== "uv" && t !== "brew"),
      ANSWERS,
      [CA],
    )
    const passed = await firstRunChecks({
      ...signedUp,
      database: "ok",
      login: () => false,
      mark: store,
      reader: optional.reader,
    })
    expect(passed.done).toBe(true)
    expect(passed.checks.map((c) => c.name)).toEqual(ORDER)
    expect(mark.writes).toBe(1)
  })

  test("a live read runs every probe whatever the mark says, reports it, and never writes it", async () => {
    const { ran, reader } = everything()
    const done = memoryMark(true)
    const live = await firstRunChecks({
      ...signedUp,
      database: "ok",
      live: true,
      mark: done.store,
      reader,
    })
    expect(live.done).toBe(true)
    expect(live.checks.map((c) => c.name)).toEqual(ORDER)
    expect(ran.length).toBeGreaterThan(0)
    const fresh = memoryMark()
    const first = await firstRunChecks({
      ...signedUp,
      database: "ok",
      live: true,
      mark: fresh.store,
      reader,
    })
    expect(first.done).toBe(false)
    expect([done.mark.writes, fresh.mark.writes]).toEqual([0, 0])
  })

  test("a mark that cannot be read answers the rows as not done, never a failed read", async () => {
    const { reader } = everything()
    const broken = {
      read: async () => {
        throw new Error('relation "app_state" does not exist')
      },
      write: async () => {},
    }
    const answer = await firstRunChecks({ ...signedUp, database: "ok", mark: broken, reader })
    expect(answer.done).toBe(false)
    expect(answer.checks.map((c) => c.name)).toEqual(ORDER)
  })

  test("once the mark is written, a read runs no probe and answers no rows", async () => {
    const { ran, reader } = everything()
    const { mark, store } = memoryMark(true)
    expect(await firstRunChecks({ ...signedUp, database: "ok", mark: store, reader })).toEqual({
      checks: [],
      done: true,
    })
    expect(ran).toEqual([])
    expect(mark.writes).toBe(0)
  })
})

describe("a fixture stack", () => {
  const fixture = { file: null, kind: "fixture", rule: "test" } as const
  afterEach(() => fixtureFixed.clear())

  test("answers the fixture's rows and runs nothing; PLAYGROUND_ONBOARD_MISSING picks its missing set", async () => {
    const { ran, reader } = machine([])
    const ok = await onboardChecks({ database: "ok", env: {}, reader, source: fixture })
    expect(ok.map((c) => c.name)).toEqual(ORDER)
    expect(ok.every((c) => c.status === "ok")).toBe(true)
    const missing = byName(
      await onboardChecks({
        database: { status: "idle" },
        env: { PLAYGROUND_ONBOARD_MISSING: "1" },
        reader,
        source: fixture,
      }),
    )
    expect(missing.docker).toMatchObject({ action: { id: "docker" }, status: "MISSING" })
    expect(missing.Database!.status).toBe("waiting")
    expect(missing.gh).toMatchObject({
      action: { id: "gh-login" },
      detail: "not signed in",
      status: "MISSING",
    })
    expect(missing.uv!.status).toBe("optional")
    expect(ran).toEqual([])
  })

  test("a made-up fix's id reads its row ok on the next read", async () => {
    const { reader } = machine([])
    const read = async () =>
      byName(
        await onboardChecks({
          database: "ok",
          env: { PLAYGROUND_ONBOARD_MISSING: "1" },
          reader,
          source: fixture,
        }),
      ).docker
    expect((await read())!.status).toBe("MISSING")
    fixtureFixed.add("docker")
    expect(await read()).toMatchObject({ action: null, note: null, status: "ok" })
  })

  test("a live-reads stack and a person's own stack ignore PLAYGROUND_ONBOARD_MISSING and read the machine", async () => {
    for (const rule of ["live-reads", "own"] as const) {
      const { reader } = everything()
      const checks = await onboardChecks({
        database: "ok",
        env: { HOME, PLAYGROUND_ONBOARD_MISSING: "1" },
        login: () => true,
        reader,
        source: { kind: "live", rule },
      })
      expect(checks.every((c) => c.status === "ok")).toBe(true)
    }
  })
})
