import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { SQL } from "bun"

// Runs the repair through psql, as it is run on the dashboard, against a throwaway Postgres in Docker published on 127.0.0.1 only, with the repo's migrations applied; skipped where Docker is not running.
const IMAGE = "postgres:18-alpine"
const PASSWORD = "repair-test"
const MIGRATIONS = join(import.meta.dir, "../../../../packages/db/drizzle")
const REPAIR = join(import.meta.dir, "../../../../packages/db/repairs/jsonb-strings.sql")
const ENTRIES = 25_001

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

describe.skipIf(!dockerUp())("the jsonb strings repair", () => {
  let container = ""
  let admin: SQL

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
      IMAGE,
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
    // As the importer stored them before the fix: two sessions' costs and every line as a JSON string, one session's costs and one line already an object.
    await admin`insert into claude_session (id, costs) values
      ('s-a', to_jsonb('{"1":0.5}'::text)),
      ('s-b', to_jsonb('{"7":1.25,"9":2}'::text)),
      ('s-c', '{"3":4}'::jsonb)`
    await admin.unsafe(`
      insert into claude_entry (session_id, uuid, seq, kind, type, raw)
      select case when n % 2 = 0 then 's-a' else 's-b' end, 'u' || n, n, 'assistant', 'assistant',
        to_jsonb(jsonb_build_object('n', n, 'message', jsonb_build_object('usage', jsonb_build_object('output_tokens', n)))::text)
      from generate_series(1, ${ENTRIES}) n
    `)
    await admin`insert into claude_entry (session_id, uuid, seq, kind, type, raw) values ('s-c', 'u0', 0, 'human', 'user', '{"n":0,"message":{"usage":{"output_tokens":0}}}'::jsonb)`
  }, 120_000)

  afterAll(() => {
    if (container)
      Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore", stdout: "ignore" })
  })

  const repair = () =>
    Bun.spawnSync(
      [
        "docker",
        "exec",
        "-i",
        container,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-f",
        "-",
      ],
      { stdin: Bun.file(REPAIR) },
    )

  test("every string becomes the object it holds, in batches that each commit, and the check after reads zero", async () => {
    const run = repair()
    expect(run.exitCode).toBe(0)
    const notices = run.stderr.toString().match(/claude_entry: \d+ fixed/g) ?? []
    expect(notices.length).toBe(Math.ceil((ENTRIES + 1) / 10_000))
    expect(run.stderr.toString()).toContain(`${ENTRIES} in all`)
    expect(run.stdout.toString()).toMatch(
      /^UPDATE 2\n[^]*costs_strings \| raw_strings *\n-+\+-+\n +0 \| +0\n/,
    )
    const sessions =
      await admin`select id, jsonb_typeof(costs) as type, costs from claude_session order by id`
    expect(
      sessions.map((r: { costs: unknown; id: string; type: string }) => [r.id, r.type, r.costs]),
    ).toEqual([
      ["s-a", "object", { "1": 0.5 }],
      ["s-b", "object", { "7": 1.25, "9": 2 }],
      ["s-c", "object", { "3": 4 }],
    ])
    const [lines] = await admin`
      select count(*)::int as objects,
        count(*) filter (where (raw ->> 'n')::int = (raw #>> '{message,usage,output_tokens}')::int)::int as whole
      from claude_entry where jsonb_typeof(raw) = 'object'`
    expect(lines).toEqual({ objects: ENTRIES + 1, whole: ENTRIES + 1 })
  }, 120_000)

  test("a second run finds nothing left to change", () => {
    const run = repair()
    expect(run.exitCode).toBe(0)
    expect(run.stderr.toString()).toContain("0 in all")
    expect(run.stderr.toString()).not.toMatch(/claude_entry: [1-9]\d* fixed/)
  }, 120_000)
})
