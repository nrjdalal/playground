import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { rmSync } from "node:fs"
import { dirname, join } from "node:path"

import { SQL } from "bun"

import { liveReadsEnv } from "../../../../live-reads"
import { slowChild } from "../../../../slow-child"

// The CLI driven as Playground runs it, as its own process, against a throwaway Postgres in Docker published on 127.0.0.1 only and migrated as the dashboard's is, with made-up sessions and messages written straight into it as ingest would. Skipped where Docker is not running.
const CLI = join(import.meta.dir, "../../../../../api/hono/src/bin/dashboard-thread.ts")
const MIGRATIONS = join(import.meta.dir, "../../../../../packages/db/drizzle")
// made at run time, so no password is ever written into the repo
const PASSWORD = crypto.randomUUID()
const BUN = slowChild("bun")
const DISPATCHER = "probe-thread-dispatcher"
const SESSION = "11111111-2222-4333-8444-555555555555"
const OTHER = "66666666-7777-4888-8999-aaaaaaaaaaaa"
afterAll(() => {
  if (BUN !== "bun") rmSync(dirname(BUN), { force: true, recursive: true })
})

setDefaultTimeout(60_000)

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

describe.skipIf(!dockerUp())("the bun run thread CLI", () => {
  let container = ""
  let url = ""
  let admin: SQL
  let seq = 0

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
    await admin`insert into claude_session (id, name, last_active_at) values (${SESSION}, ${DISPATCHER}, now()), (${OTHER}, 'worker-other', now())`
  }, 60_000)

  afterAll(async () => {
    await admin?.close()
    if (container)
      Bun.spawnSync(["docker", "rm", "-f", "-v", container], { stderr: "ignore", stdout: "ignore" })
  })

  const cli = async (args: string[]) => {
    const proc = Bun.spawn([BUN, CLI, ...args], {
      env: liveReadsEnv({ ...process.env, PLAYGROUND_DISPATCHER: DISPATCHER, POSTGRES_URL: url }),
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, stderr, stdout }
  }

  // One transcript line as ingest writes it: a uuid of its own, the next byte offset, and the time it was said.
  const say = async (text: string, at: string, session = SESSION, kind = "human") => {
    const uuid = crypto.randomUUID()
    seq += 100
    const type = kind === "assistant" ? "assistant" : "user"
    await admin`insert into claude_entry (session_id, uuid, seq, at, kind, type, text, raw) values (${session}, ${uuid}, ${seq}, ${at}::timestamptz, ${kind}, ${type}, ${text}, '{}'::jsonb)`
    return uuid
  }

  const open = async (title: string) => {
    const made = await cli(["new", title])
    expect(made.code).toBe(0)
    expect(made.stdout).toMatch(/^\S{4}\n$/)
    return made.stdout.trim()
  }

  const tagOf = async (uuid: string) => {
    const [row] = await admin`select thread_id, thread_seq from claude_entry where uuid = ${uuid}`
    return { id: row.thread_id as string | null, seq: row.thread_seq as number | null }
  }

  test("new opens a thread under its title and prints its 4-character id", async () => {
    const id = await open("Ship the threads store")
    const [row] = await admin`select title, archived_at from thread where id = ${id}`
    expect(row).toMatchObject({ archived_at: null, title: "Ship the threads store" })
  })

  test("route tags the newest untagged message that starts with the quote, the dispatcher's by default", async () => {
    const id = await open("Rename the sidebar")
    const older = await say("rename the sidebar to Threads", "2026-10-22T10:00:00Z")
    const newer = await say("rename the sidebar to Threads please", "2026-10-22T10:05:00Z")
    const elsewhere = await say("rename the sidebar to Threads", "2026-10-22T10:10:00Z", OTHER)
    // the dispatcher's own reply opening with his words is newer, and is passed over
    const reply = await say(
      "rename the sidebar: on it",
      "2026-10-22T10:06:00Z",
      SESSION,
      "assistant",
    )
    const routed = await cli(["route", id, "--quote", "rename the sidebar"])
    expect(routed.code).toBe(0)
    expect(await tagOf(newer)).toEqual({ id, seq: 1 })
    expect(await tagOf(older)).toEqual({ id: null, seq: null })
    expect(await tagOf(elsewhere)).toEqual({ id: null, seq: null })
    expect(await tagOf(reply)).toEqual({ id: null, seq: null })
    // the same quote again takes the newest one still untagged
    expect((await cli(["route", id, "--quote", "rename the sidebar"])).code).toBe(0)
    expect(await tagOf(older)).toEqual({ id, seq: 2 })
    expect(await tagOf(reply)).toEqual({ id: null, seq: null })
  })

  test("route moves the thread's updatedAt to the routed message's time", async () => {
    const id = await open("Bump the thread")
    // said after the thread was opened, so its time is later than the thread's own
    const at = new Date(Date.now() + 60_000).toISOString()
    const peer = await say("\nbump report: done", at, SESSION, "peer")
    expect((await cli(["route", id, "--quote", "bump report"])).code).toBe(0)
    expect(await tagOf(peer)).toEqual({ id, seq: 1 })
    const [row] = await admin`select updated_at from thread where id = ${id}`
    expect(new Date(row.updated_at).toISOString()).toBe(at)
  })

  test("--session routes another session's message, and each thread counts from 1", async () => {
    const first = await open("Fix the composer")
    const second = await open("Fix the inbox")
    const a = await say("composer drops the draft", "2026-10-22T11:00:00Z", OTHER)
    const b = await say("inbox shows a stale count", "2026-10-22T11:01:00Z", OTHER)
    const c = await say("composer report: fixed in #12", "2026-10-22T11:02:00Z", OTHER)
    for (const [id, quote] of [
      [first, "composer drops"],
      [second, "inbox shows"],
      [first, "composer report"],
    ] as const) {
      expect((await cli(["route", id, "--quote", quote, "--session", OTHER])).code).toBe(0)
    }
    expect(await tagOf(a)).toEqual({ id: first, seq: 1 })
    expect(await tagOf(b)).toEqual({ id: second, seq: 1 })
    expect(await tagOf(c)).toEqual({ id: first, seq: 2 })
  })

  test("route waits for ingest to bring the message", async () => {
    const id = await open("Late message")
    const routing = cli(["route", id, "--quote", "arrives late", "--wait", "20"])
    await Bun.sleep(1500)
    const late = await say("arrives late, after the route started", "2026-10-22T12:00:00Z")
    expect((await routing).code).toBe(0)
    expect(await tagOf(late)).toEqual({ id, seq: 1 })
  })

  test("route fails once its wait runs out, naming the quote", async () => {
    const id = await open("Never said")
    const routed = await cli(["route", id, "--quote", "nobody said this", "--wait", "1"])
    expect(routed.code).toBe(1)
    expect(routed.stderr).toContain('"nobody said this"')
  })

  test("route leaves a message another route tagged first, and keeps polling", async () => {
    const id = await open("Raced")
    const other = await open("Raced elsewhere")
    const raced = await say("raced away by another route", "2026-10-22T13:00:00Z")
    const [{ updated_at: before }] = await admin`select updated_at from thread where id = ${id}`
    // another connection tags the message and holds its transaction open, so the route's select still sees it untagged and its update waits on the row
    const racer = new SQL(url, { max: 1 })
    const held = await racer.reserve()
    await held`begin`
    await held`update claude_entry set thread_id = ${other}, thread_seq = 1 where uuid = ${raced}`
    const routing = cli(["route", id, "--quote", "raced away", "--wait", "3"])
    let blocked = false
    for (let i = 0; i < 300 && !blocked; i++) {
      const [{ n }] =
        await admin`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'update%claude_entry%'`
      blocked = n > 0
      if (!blocked) await Bun.sleep(100)
    }
    await held`commit`
    held.release()
    await racer.close()
    const routed = await routing
    expect(blocked).toBe(true)
    expect(routed.code).toBe(1)
    expect(routed.stdout).not.toContain("routed")
    expect(await tagOf(raced)).toEqual({ id: other, seq: 1 })
    const [{ updated_at: after }] = await admin`select updated_at from thread where id = ${id}`
    expect(after).toEqual(before)
  })

  test("route refuses a thread that does not exist", async () => {
    const routed = await cli(["route", "zz9z", "--quote", "anything", "--wait", "0"])
    expect(routed.code).toBe(1)
    expect(routed.stderr).toContain("no thread zz9z")
  })

  test("title renames a thread", async () => {
    const id = await open("Working name")
    const titled = await cli(["title", id, "ZeroStarter"])
    expect(titled.code).toBe(0)
    expect(titled.stdout).toContain(id)
    const [row] = await admin`select title from thread where id = ${id}`
    expect(row.title).toBe("ZeroStarter")
  })

  test("title refuses a thread that does not exist", async () => {
    const titled = await cli(["title", "zz9z", "Anything"])
    expect(titled.code).toBe(1)
    expect(titled.stderr).toContain("no thread zz9z")
  })

  test("title refuses an empty title with one line, keeping the old one", async () => {
    const id = await open("Kept name")
    const titled = await cli(["title", id, "   "])
    expect(titled.code).toBe(1)
    expect(titled.stderr.split("\n").filter((line) => line.trim())).toHaveLength(1)
    const [row] = await admin`select title from thread where id = ${id}`
    expect(row.title).toBe("Kept name")
  })

  test("list prints the open threads, newest first, with their unread counts", async () => {
    // the earlier tests' threads leave the list, so it holds this test's alone
    await admin`update thread set archived_at = now()`
    // busy is opened first, so only the route's bump can put it on top
    const busy = await open("Busy thread")
    const quiet = await open("Quiet thread")
    const gone = await open("Archived thread")
    // a session's report, since unread counts only what someone else wrote
    await say("busy one", new Date().toISOString(), SESSION, "peer")
    expect((await cli(["route", busy, "--quote", "busy one"])).code).toBe(0)
    await admin`update thread set archived_at = now() where id = ${gone}`
    const listed = await cli(["list"])
    expect(listed.code).toBe(0)
    const lines = listed.stdout.trim().split("\n")
    expect(lines[0]).toBe(`${busy} 1 unread · Busy thread`)
    expect(lines).toContain(`${quiet} 0 unread · Quiet thread`)
    expect(listed.stdout).not.toContain(gone)
    // a pinned thread leads, whatever its time
    await admin`update thread set pinned_at = now() where id = ${quiet}`
    const pinned = (await cli(["list"])).stdout.trim().split("\n")
    expect(pinned[0]).toBe(`${quiet} 0 unread, pinned · Quiet thread`)
    expect(pinned[1]).toBe(`${busy} 1 unread · Busy thread`)
  })

  test("prints its usage for anything else", async () => {
    for (const args of [
      [],
      ["new"],
      ["route", "abcd"],
      ["route", "abcd", "--color", "x"],
      ["title"],
      ["title", "abcd"],
      ["list", "x"],
    ]) {
      const result = await cli(args)
      expect(result.code).toBe(2)
      expect(result.stderr).toContain("usage: bun run thread")
    }
  })

  // the dashboard's own change path caps a title at threadPatchSchema's 200, so a longer CLI title would land and then be untouchable
  test("refuses a title past 200 characters from new and title with one line, and 200 goes through", async () => {
    const cap = "a".repeat(200)
    const long = `${cap}!`
    const refusedNew = await cli(["new", long])
    expect(refusedNew.code).toBe(1)
    expect(refusedNew.stderr).toBe("thread: a title takes at most 200 characters\n")
    const [{ n }] = await admin`select count(*)::int as n from thread where title = ${long}`
    expect(n).toBe(0)
    const id = await open(cap)
    const renamed = await cli(["title", id, cap])
    expect(renamed.code).toBe(0)
    const [row] = await admin`select title from thread where id = ${id}`
    expect(row.title).toBe(cap)
    const refusedTitle = await cli(["title", id, long])
    expect(refusedTitle.code).toBe(1)
    expect(refusedTitle.stderr).toBe("thread: a title takes at most 200 characters\n")
    const [kept] = await admin`select title from thread where id = ${id}`
    expect(kept.title).toBe(cap)
  })

  // the schema's zod .max counts code points, so the CLI must too: 200 emoji are 200 characters and 400 UTF-16 units
  test("200 emoji go through and 201 are refused", async () => {
    const cap = "🎉".repeat(200)
    const id = await open(cap)
    const [row] = await admin`select title from thread where id = ${id}`
    expect(row.title).toBe(cap)
    const refused = await cli(["title", id, `${cap}🎉`])
    expect(refused.code).toBe(1)
    expect(refused.stderr).toBe("thread: a title takes at most 200 characters\n")
    const [{ n }] = await admin`select count(*)::int as n from thread where title = ${`${cap}🎉`}`
    expect(n).toBe(0)
  })
})
