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
      // the watcher's FSEvents can drop a change under load, so the rescan that catches it runs every 500ms rather than 30s
      INGEST_RESCAN_MS: "500",
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
    try {
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
      while ((await entries()) < 3) await Bun.sleep(100)
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
    } finally {
      // a failed step leaves the follower holding the lock, which would fail every case after it
      follower.kill()
    }
  }, 30_000)

  // a config folder Claude Code has run no session in yet: no projects folder under it
  const freshConfig = () => {
    const fresh = mkdtempSync(join(tmpdir(), "dashboard-ingest-fresh-"))
    return { env: { ...env(), CLAUDE_CONFIG_DIR: fresh }, fresh }
  }

  test("before Claude Code's first session makes the projects folder, status reads no transcripts and blames no database", () => {
    const { env: freshEnv, fresh } = freshConfig()
    try {
      const status = Bun.spawnSync([process.execPath, CLI, "status"], {
        cwd: fresh,
        env: freshEnv,
        stderr: "pipe",
        stdout: "pipe",
      })
      const said = status.stdout.toString() + status.stderr.toString()
      expect(said).not.toContain("database is not ready")
      expect(said).toContain("0 never read")
      expect(status.exitCode).toBe(1)
    } finally {
      rmSync(fresh, { force: true, recursive: true })
    }
  })

  test("before Claude Code's first session makes the projects folder, the follower waits for it, then reads it", async () => {
    const { env: freshEnv, fresh } = freshConfig()
    const session = "66666666-7777-4888-9999-aaaaaaaaaaaa"
    const follower = Bun.spawn([process.execPath, CLI, "--follow"], {
      cwd: fresh,
      env: freshEnv,
      stderr: "pipe",
      stdout: "pipe",
    })
    try {
      const reader = follower.stdout.getReader()
      let log = ""
      while (!log.includes("following")) {
        const { done, value } = await reader.read()
        if (done) break
        log += new TextDecoder().decode(value)
      }
      expect(log).toContain("yet; waiting for Claude Code's first session")
      expect(log).toContain("following")

      mkdirSync(join(fresh, "projects", "-repo"), { recursive: true })
      writeFileSync(
        join(fresh, "projects", "-repo", `${session}.jsonl`),
        line("f1", "first") + line("f2", "second"),
      )
      const stored = async () =>
        (await admin`select count(*)::int as n from claude_entry where session_id = ${session}`)[0]
          .n as number
      while ((await stored()) < 2) await Bun.sleep(100)
      expect(await stored()).toBe(2)

      follower.kill("SIGTERM")
      expect(await follower.exited).toBe(0)
    } finally {
      follower.kill()
      rmSync(fresh, { force: true, recursive: true })
    }
  }, 30_000)
})
