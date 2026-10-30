import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { SQL } from "bun"

type Reader = import("../../../../../../api/hono/src/lib/onboard/checks").Reader

const MIGRATIONS = join(import.meta.dir, "../../../../../../packages/db/drizzle")
const PASSWORD = crypto.randomUUID()

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

// Every probe answers, so every row reads ok but the argv listed as failing.
const reader = (failing: string[] = []): Reader => ({
  exists: () => true,
  has: () => true,
  listens: async () => true,
  run: async (argv) =>
    failing.includes(argv.join(" ")) ? { code: 1, stdout: "" } : { code: 0, stdout: "v22.11.0\n" },
})

const GH_SIGNED_OUT = "gh auth status --active -h github.com"

describe.skipIf(!dockerUp())("the done mark in app_state", () => {
  let container = ""
  let admin: SQL
  let checks: typeof import("../../../../../../api/hono/src/lib/onboard/checks")
  let mark: typeof import("../../../../../../api/hono/src/lib/onboard/done-mark")
  let db: ReturnType<typeof import("../../../../../../packages/db/dist/index.mjs").createDatabase>

  // A Postgres of this file's own on loopback, with every migration the repo ships, removed with its volume once the file is done.
  beforeAll(async () => {
    container = Bun.spawnSync([
      "docker",
      "run",
      "-d",
      "--rm",
      "-e",
      `POSTGRES_PASSWORD=${PASSWORD}`,
      "-p",
      "127.0.0.1::5432",
      "postgres:18-alpine",
    ])
      .stdout.toString()
      .trim()
    const port = Bun.spawnSync(["docker", "port", container, "5432/tcp"])
      .stdout.toString()
      .trim()
      .split(":")
      .at(-1)
    const url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`
    for (let i = 0; i < 60; i++) {
      try {
        admin = new SQL(url, { max: 1 })
        await admin`select 1`
        break
      } catch {
        await Bun.sleep(500)
      }
    }
    const journal = await Bun.file(join(MIGRATIONS, "meta/_journal.json")).json()
    for (const { tag } of journal.entries as { tag: string }[]) {
      for (const statement of (await Bun.file(join(MIGRATIONS, `${tag}.sql`)).text()).split(
        "--> statement-breakpoint",
      )) {
        if (statement.trim()) await admin.unsafe(statement)
      }
    }
    checks = await import("../../../../../../api/hono/src/lib/onboard/checks")
    mark = await import("../../../../../../api/hono/src/lib/onboard/done-mark")
    db = (await import("../../../../../../packages/db/dist/index.mjs")).createDatabase(url)
  }, 60_000)

  afterAll(async () => {
    await admin?.close()
    if (container)
      Bun.spawnSync(["docker", "rm", "-f", "-v", container], { stderr: "ignore", stdout: "ignore" })
  })

  const rows = async (): Promise<{ done_at: string; key: string; kind: string }[]> =>
    await admin`select key, jsonb_typeof(value) as kind, value->>'doneAt' as done_at from app_state`

  const read = (failing: string[] = [], database: "ok" | { status: "idle" } = "ok") =>
    checks.firstRunChecks({
      database,
      env: { HOME: "/Users/someone" },
      login: () => true,
      mark: mark.doneMark(db, () => true),
      reader: reader(failing),
      source: { kind: "live", rule: "own" },
    })

  test("is not written while a row is MISSING, nor with no database", async () => {
    expect((await read([GH_SIGNED_OUT])).done).toBe(false)
    expect((await read([], { status: "idle" })).done).toBe(false)
    expect(await rows()).toEqual([])
  })

  test("is written once, as an object holding doneAt, the first time every row passes", async () => {
    const first = await read()
    expect(first.done).toBe(true)
    expect(first.checks.length).toBeGreaterThan(0)
    const [row, ...rest] = await rows()
    expect(rest).toEqual([])
    expect(row).toMatchObject({ key: mark.DONE_KEY, kind: "object" })
    expect(Number.isNaN(Date.parse(row!.done_at))).toBe(false)
  })

  test("once written, every read is done with no rows, even with a probe that would fail now", async () => {
    const before = await rows()
    expect(await read([GH_SIGNED_OUT])).toEqual({ checks: [], done: true })
    await mark.doneMark(db, () => true).write()
    expect(await rows()).toEqual(before)
  })
})

describe("the done mark on a stack that does not read this Mac", () => {
  // A fixture stack's mark lives in the API's memory alone, so a restart or PLAYGROUND_ONBOARD_MISSING shows the checks again; any reach for the database fails this test.
  test("is kept in memory and never touches the database", async () => {
    const { doneMark } = await import("../../../../../../api/hono/src/lib/onboard/done-mark")
    const untouchable = new Proxy(
      {},
      {
        get: () => {
          throw new Error("a fixture stack's done mark reached the database")
        },
      },
    ) as Parameters<typeof doneMark>[0]
    const mark = doneMark(untouchable, () => false)
    expect(await mark.read()).toBe(false)
    await mark.write()
    expect(await mark.read()).toBe(true)
  })
})
