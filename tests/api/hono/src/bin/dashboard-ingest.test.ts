import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SQL } from "bun"

import { liveReadsEnv } from "../../../../live-reads"

// The CLI is driven as the runner hosting the dashboard runs it, as its own process, against a throwaway Postgres in Docker published on 127.0.0.1 only, with CLAUDE_CONFIG_DIR pointing at scratch transcripts. Skipped where Docker is not running.
const CLI = join(import.meta.dir, "../../../../../api/hono/src/bin/dashboard-ingest.ts")
const MIGRATIONS = join(import.meta.dir, "../../../../../packages/db/drizzle")
const PASSWORD = "dashboard-ingest-test"
const SESSION = "55555555-6666-4777-8888-999999999999"

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

const line = (uuid: string, text: string) =>
  `${JSON.stringify({
    type: "user",
    uuid,
    timestamp: "2026-10-06T10:00:00.000Z",
    entrypoint: "cli",
    origin: { kind: "human" },
    message: { role: "user", content: text },
  })}\n`

describe.skipIf(!dockerUp())("the bun run ingest CLI", () => {
  let container = ""
  let url = ""
  let home = ""
  let admin: SQL
  let transcript = ""

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
    url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`
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
    home = mkdtempSync(join(tmpdir(), "dashboard-ingest-"))
    mkdirSync(join(home, "projects", "-repo"), { recursive: true })
    transcript = join(home, "projects", "-repo", `${SESSION}.jsonl`)
    writeFileSync(transcript, line("u1", "first") + line("u2", "second"))
  }, 60_000)

  afterAll(() => {
    if (container)
      Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore", stdout: "ignore" })
    if (home) rmSync(home, { force: true, recursive: true })
  })

  const env = (postgres = url) =>
    liveReadsEnv({
      ...process.env,
      CLAUDE_CONFIG_DIR: home,
      // every scratch transcript is stored, as on a stack opted in to every session (own.ts)
      PLAYGROUND_CMUX_SESSIONS: "true",
      POSTGRES_URL: postgres,
    })

  const cli = (args: string[], postgres?: string) => {
    const result = Bun.spawnSync([process.execPath, CLI, ...args], {
      cwd: home,
      env: env(postgres),
      stderr: "pipe",
      stdout: "pipe",
    })
    return { code: result.exitCode, out: result.stdout.toString() + result.stderr.toString() }
  }

  const entries = async () =>
    (await admin`select count(*)::int as n from claude_entry where session_id = ${SESSION}`)[0]
      .n as number

  test("refuses a database it cannot prove is a local container, before writing anything", () => {
    const { code, out } = cli([], "postgres://u:p@db.example.com:5432/postgres")
    expect(code).toBe(1)
    expect(out).toContain("refusing to write: POSTGRES_URL points at db.example.com")
  })

  test("status says no follower runs and the transcript was never read", () => {
    const { code, out } = cli(["status"])
    expect(code).toBe(1)
    expect(out).toContain("follower: not running")
    expect(out).toContain("1 never read")
  })

  test("a follower backfills and holds the lock; a second copy does nothing; status sees it; new lines arrive; SIGTERM stops it cleanly", async () => {
    const follower = Bun.spawn([process.execPath, CLI, "--follow"], {
      cwd: home,
      env: env(),
      stderr: "pipe",
      stdout: "pipe",
    })
    const reader = follower.stdout.getReader()
    let log = ""
    while (!log.includes("following")) {
      const { done, value } = await reader.read()
      if (done) break
      log += new TextDecoder().decode(value)
    }
    expect(log).toMatch(
      /writing to 127\.0\.0\.1:\d+\/postgres is \S+ \(postgres:18-alpine\), published on 127\.0\.0\.1 only/,
    )
    expect(await entries()).toBe(2)

    const second = cli(["--follow"])
    expect(second.code).toBe(0)
    expect(second.out).toContain("another importer holds the lock; nothing to do")

    const running = cli(["status"])
    expect(running.code).toBe(0)
    expect(running.out).toContain("follower: running")
    expect(running.out).toContain("0 with unread bytes")
    expect(running.out).toMatch(/sessions: 1, entries: 2, newest entry: \d{4}-/)

    appendFileSync(transcript, line("u3", "third"))
    for (let i = 0; i < 40 && (await entries()) < 3; i++) await Bun.sleep(250)
    expect(await entries()).toBe(3)

    follower.kill("SIGTERM")
    expect(await follower.exited).toBe(0)
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      log += new TextDecoder().decode(value)
    }
    expect(log).toContain("stopped by SIGTERM")
    expect(cli(["status"]).code).toBe(1)
  }, 30_000)
})
