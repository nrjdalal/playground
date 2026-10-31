import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { SQL } from "bun"

import { MAX_TEXT } from "../../../../../packages/message/src/index"

// Yard's tables as the migration chain builds them, on a throwaway Postgres in Docker published on 127.0.0.1 only, with made-up users. Skipped where Docker is not running.
const MIGRATIONS = join(import.meta.dir, "../../../../../packages/db/drizzle")
const PASSWORD = "yard-schema-test"

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

describe.skipIf(!dockerUp())("Yard's tables", () => {
  let container = ""
  let db: SQL

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
        db = new SQL(url, { max: 1 })
        await db`select 1`
        break
      } catch {
        await Bun.sleep(500)
      }
    }
    const journal = await Bun.file(join(MIGRATIONS, "meta/_journal.json")).json()
    for (const { tag } of journal.entries as { tag: string }[])
      for (const statement of (await Bun.file(join(MIGRATIONS, `${tag}.sql`)).text()).split(
        "--> statement-breakpoint",
      ))
        if (statement.trim()) await db.unsafe(statement)
    for (const id of ["ada", "bo"])
      await db`insert into "user" (id, name, email) values (${id}, ${id}, ${`${id}@example.com`})`
  }, 60_000)

  afterAll(() => {
    if (container)
      Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore", stdout: "ignore" })
  })

  const channel = async (name: string, kind: string) => {
    const [row] =
      await db`insert into yard_channel (id, kind, name) values (${crypto.randomUUID()}, ${kind}, ${name}) returning id`
    for (const user of ["ada", "bo"])
      await db`insert into yard_member (channel_id, user_id) values (${row.id}, ${user})`
    return row.id as string
  }

  const post = (channelId: string, text: string, status = "sent") =>
    db`insert into yard_message (id, channel_id, device, kind, status, text, user_id) values (${crypto.randomUUID()}, ${channelId}, ${"studio"}, ${"text"}, ${status}, ${text}, ${"ada"})`

  // What a member reads in a channel: every sent message, and their own pending ones.
  const visible = async (channelId: string, reader: string) =>
    (
      await db`select text from yard_message where channel_id = ${channelId} and (status = 'sent' or user_id = ${reader}) order by at`
    ).map((row: { text: string }) => row.text)

  test.each([
    ["general", "channel"],
    ["dm:ada:bo", "dm"],
  ])("a message in %s, a %s, is written and read back", async (name, kind) => {
    const id = await channel(name, kind)
    await post(id, `hello in ${name}`)
    expect(await visible(id, "bo")).toEqual([`hello in ${name}`])
  })

  test("a pending message is read by its sender alone", async () => {
    const id = await channel("releases", "channel")
    await post(id, "steps to try", "pending")
    expect(await visible(id, "ada")).toEqual(["steps to try"])
    expect(await visible(id, "bo")).toEqual([])
  })

  // A write the database refuses, awaited so the query runs.
  const refused = async (write: () => PromiseLike<unknown>) => {
    try {
      await write()
      return false
    } catch {
      return true
    }
  }

  test("a channel kind, a message kind or status it does not know, and text past the limit are refused", async () => {
    const id = await channel("bugs", "channel")
    expect(await refused(() => channel("x", "group"))).toBe(true)
    expect(
      await refused(
        () =>
          db`insert into yard_message (id, channel_id, device, kind, text, user_id) values (${crypto.randomUUID()}, ${id}, ${"studio"}, ${"shout"}, ${"hi"}, ${"ada"})`,
      ),
    ).toBe(true)
    expect(await refused(() => post(id, "hi", "lost"))).toBe(true)
    expect(await refused(() => post(id, "a".repeat(MAX_TEXT + 1)))).toBe(true)
    expect(await refused(() => post(id, "a".repeat(MAX_TEXT)))).toBe(false)
  })
})
