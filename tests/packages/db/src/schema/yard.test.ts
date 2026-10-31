import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { SQL } from "bun"

import { MAX_TEXT } from "../../../../../packages/message/src/index"

// Yard's tables as the migration chain builds them, on a throwaway Postgres in Docker published on 127.0.0.1 only, with made-up users. Skipped where Docker is not running.
const MIGRATIONS = join(import.meta.dir, "../../../../../packages/db/drizzle")
const PASSWORD = crypto.randomUUID()

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
    for (const id of ["ada", "bo", "cy"])
      await db`insert into "user" (id, name, email) values (${id}, ${id}, ${`${id}@example.com`})`
  }, 60_000)

  afterAll(async () => {
    await db?.close()
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

  const post = (channelId: string, text: string, status = "sent", userId = "ada") =>
    db`insert into yard_message (id, channel_id, device, kind, login, status, text, user_id) values (${crypto.randomUUID()}, ${channelId}, ${"studio"}, ${"text"}, ${userId}, ${status}, ${text}, ${userId})`

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

  // The message of the error a write is refused with, awaited so the query runs, or null when it is taken.
  const refusal = async (write: () => PromiseLike<unknown>) => {
    try {
      await write()
      return null
    } catch (error) {
      return (error as Error).message
    }
  }

  test("a channel kind, a message kind or status it does not know, and text past the limit are refused", async () => {
    const id = await channel("bugs", "channel")
    expect(await refusal(() => channel("x", "group"))).toContain("yard_channel_kind_check")
    expect(
      await refusal(
        () =>
          db`insert into yard_message (id, channel_id, device, kind, login, text, user_id) values (${crypto.randomUUID()}, ${id}, ${"studio"}, ${"shout"}, ${"ada"}, ${"hi"}, ${"ada"})`,
      ),
    ).toContain("yard_message_kind_check")
    expect(await refusal(() => post(id, "hi", "lost"))).toContain("yard_message_status_check")
    expect(await refusal(() => post(id, "a".repeat(MAX_TEXT + 1)))).toContain(
      "yard_message_text_check",
    )
    expect(await refusal(() => post(id, "a".repeat(MAX_TEXT)))).toBeNull()
  })

  test.each([
    ["dm:ada:cy", "channel"],
    ["ada-cy", "dm"],
  ])("a channel named %s of kind %s is refused", async (name, kind) => {
    expect(await refusal(() => channel(name, kind))).toContain("yard_channel_dm_name_check")
  })

  test("deleting a user keeps their messages, attributed by login and device", async () => {
    const id = await channel("random", "channel")
    await post(id, "from cy", "sent", "cy")
    await db`delete from "user" where id = ${"cy"}`
    expect([
      ...(await db`select device, login, user_id from yard_message where channel_id = ${id}`),
    ]).toEqual([{ device: "studio", login: "cy", user_id: null }])
  })
})
