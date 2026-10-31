import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { SQL } from "bun"

process.env.BETTER_AUTH_SECRET ||= "yard-store-test-secret-not-for-use-anywhere"
const { createDatabase } = await import("../../../../../../packages/db/dist/index.mjs")
const store = await import("../../../../../../api/hono/src/lib/yard/store")
const { cutoff, sweepOnceADay, take } =
  await import("../../../../../../api/hono/src/lib/yard/limits")

// Yard's store on the migration chain, on a throwaway Postgres in Docker published on 127.0.0.1 only, with made-up members. Skipped where Docker is not running.
const MIGRATIONS = join(import.meta.dir, "../../../../../../packages/db/drizzle")
const PASSWORD = crypto.randomUUID()

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

type Caller = import("../../../../../../api/hono/src/lib/yard/store").Caller

const web = (id: string, owner = false): Caller => ({
  device: "web",
  id,
  login: id,
  owner,
  via: "web",
})
const token = (id: string, owner = false): Caller => ({
  device: "studio",
  id,
  login: id,
  owner,
  via: "token",
})

// Posts with the limits out of the way, since a test posts faster than once a second; the limits have their own test.
const UNLIMITED = { channelHour: 1e6, loginDay: 1e6, loginSecond: 1e6 }

describe.skipIf(!dockerUp())("Yard's store", () => {
  let container = ""
  let sql: SQL
  let db: ReturnType<typeof createDatabase>

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
        sql = new SQL(url, { max: 1 })
        await sql`select 1`
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
        if (statement.trim()) await sql.unsafe(statement)
    for (const [id, role] of [
      ["ada", "owner"],
      ["bo", "member"],
      ["cy", "user"],
      ["di", "member"],
    ])
      await sql`insert into "user" (id, name, email, login, role) values (${id}, ${id}, ${`${id}@example.com`}, ${id}, ${role})`
    db = createDatabase(url)
  }, 60_000)

  afterAll(async () => {
    await sql?.close()
    if (container)
      Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore", stdout: "ignore" })
  })

  const send = (caller: Caller, channelId: string, body: Parameters<typeof store.post>[3]) =>
    store.post(db, caller, channelId, body, UNLIMITED)

  const both = async (name: string) => {
    const channel = await store.createChannel(db, web("ada", true), { name })
    await store.joinChannel(db, web("bo"), channel.id)
    return channel
  }

  describe("channels", () => {
    test("count a member's unread and mentions since they last read, and a read clears them", async () => {
      const { id } = await both("unread")
      await send(web("ada", true), id, { kind: "text", text: "morning" })
      await send(web("ada", true), id, { kind: "text", text: "@bo can you look?" })
      const before = (await store.channels(db, web("bo"))).find((c) => c.id === id)!
      expect([before.unread, before.mentions, before.joined]).toEqual([2, 1, true])
      await store.markRead(db, web("bo"), id)
      const after = (await store.channels(db, web("bo"))).find((c) => c.id === id)!
      expect([after.unread, after.mentions]).toEqual([0, 0])
    })

    test("a name already taken is a conflict", async () => {
      await store.createChannel(db, web("bo"), { name: "taken" })
      await expect(store.createChannel(db, web("di"), { name: "taken" })).rejects.toMatchObject({
        status: 409,
      })
    })

    test("a channel a member has not joined lists unjoined, with nothing unread, and reads as missing", async () => {
      const { id } = await store.createChannel(db, web("bo"), { name: "closed" })
      expect((await store.channels(db, web("di"))).find((c) => c.id === id)).toMatchObject({
        joined: false,
        unread: 0,
      })
      await expect(store.messages(db, web("di"), id, {})).rejects.toMatchObject({ status: 404 })
    })
  })

  describe("DMs", () => {
    test("both sides open the same row, named by the sorted ids, and see the other as its peer", async () => {
      const fromBo = await store.openDm(db, web("bo"), "DI")
      const fromDi = await store.openDm(db, web("di"), "bo")
      expect(fromBo.id).toBe(fromDi.id)
      expect(fromBo.name).toBe("dm:bo:di")
      expect([fromBo.peer?.login, fromDi.peer?.login]).toEqual(["di", "bo"])
    })

    test("a login with no membership, and yourself, open none", async () => {
      await expect(store.openDm(db, web("bo"), "cy")).rejects.toMatchObject({ status: 404 })
      await expect(store.openDm(db, web("bo"), "bo")).rejects.toMatchObject({ status: 400 })
    })
  })

  describe("posts", () => {
    test("a token's steps wait as pending, read by their sender alone, while a browser's send at once", async () => {
      const { id } = await both("tiers")
      const held = await send(token("bo"), id, { kind: "steps", text: "run the suite" })
      const sent = await send(web("bo"), id, { kind: "steps", text: "typed by hand" })
      expect([held.status, sent.status, held.from.device]).toEqual(["pending", "sent", "studio"])
      expect(
        (await store.messages(db, web("ada", true), id, {})).messages.map((m) => m.text),
      ).toEqual(["typed by hand"])
      expect((await store.messages(db, web("bo"), id, {})).messages.map((m) => m.text)).toEqual([
        "run the suite",
        "typed by hand",
      ])
    })

    test("a token's first DM message and its mention wait; its next plain message sends", async () => {
      const { id } = await store.openDm(db, web("ada", true), "di")
      expect((await send(token("ada", true), id, { kind: "text", text: "hi" })).status).toBe(
        "pending",
      )
      expect((await send(token("ada", true), id, { kind: "text", text: "there" })).status).toBe(
        "sent",
      )
      expect((await send(token("ada", true), id, { kind: "text", text: "@di see" })).status).toBe(
        "pending",
      )
    })

    test("an owner-only channel takes the owner alone, and holds the owner's token post", async () => {
      const { id } = await both("releases")
      await sql`update yard_channel set post_rule = 'owner' where id = ${id}`
      await expect(send(web("bo"), id, { kind: "notice", text: "shipped" })).rejects.toMatchObject({
        status: 403,
      })
      expect((await send(web("ada", true), id, { kind: "notice", text: "shipped" })).status).toBe(
        "sent",
      )
      expect((await send(token("ada", true), id, { kind: "notice", text: "shipped" })).status).toBe(
        "pending",
      )
    })

    test("a reply stays in its parent's channel", async () => {
      const a = await both("thread-a")
      const b = await both("thread-b")
      const first = await send(web("bo"), a.id, { kind: "question", text: "why?" })
      await expect(
        send(web("bo"), b.id, { kind: "answer", parent: first.id, text: "because" }),
      ).rejects.toMatchObject({
        status: 404,
      })
      const reply = await send(web("ada", true), a.id, {
        kind: "answer",
        parent: first.id,
        text: "because",
      })
      expect((await store.messages(db, web("bo"), a.id, { parent: first.id })).messages).toEqual([
        reply,
      ])
      expect((await store.messages(db, web("bo"), a.id, {})).messages.map((m) => m.id)).toEqual([
        first.id,
      ])
      await expect(
        send(web("bo"), a.id, { kind: "answer", parent: reply.id, text: "deeper" }),
      ).rejects.toMatchObject({
        status: 400,
      })
    })
  })

  describe("approving", () => {
    test("the sender sends or denies a pending message once; nobody else reaches it", async () => {
      const { id } = await both("approve")
      const held = await send(token("bo"), id, { kind: "fix", text: "patch" })
      await expect(store.ownMessage(db, web("ada", true), held.id)).rejects.toMatchObject({
        status: 404,
      })
      await expect(store.decide(db, web("ada", true), held.id, "sent")).rejects.toMatchObject({
        status: 404,
      })
      expect((await store.decide(db, web("bo"), held.id, "sent")).status).toBe("sent")
      await expect(store.decide(db, web("bo"), held.id, "denied")).rejects.toMatchObject({
        status: 409,
      })
      expect(
        await store.audienceOf(db, web("bo"), await store.ownMessage(db, web("bo"), held.id)),
      ).toEqual(expect.arrayContaining(["ada", "bo"]))
    })
  })

  describe("retention", () => {
    test("a thread lives while its newest message is inside 90 days, and reads past it are gone before any sweep", async () => {
      const { id } = await both("retention")
      const old = new Date(cutoff().getTime() - 86_400_000)
      const kept = await send(web("bo"), id, { kind: "question", text: "old question" })
      await send(web("ada", true), id, { kind: "answer", parent: kept.id, text: "fresh answer" })
      const gone = await send(web("bo"), id, { kind: "text", text: "old note" })
      await sql`update yard_message set at = ${old} where id in (${kept.id}, ${gone.id})`
      expect((await store.messages(db, web("bo"), id, {})).messages.map((m) => m.text)).toEqual([
        "old question",
      ])
      await expect(store.ownMessage(db, web("bo"), gone.id)).rejects.toMatchObject({ status: 404 })
      expect(await sweepOnceADay(db)).toBe(true)
      const left = await sql`select text from yard_message where channel_id = ${id} order by text`
      expect([...left].map((row) => row.text)).toEqual(["fresh answer", "old question"].sort())
    })
  })

  describe("limits", () => {
    test("count in fixed windows and refuse past the limit", async () => {
      const now = Date.UTC(2026, 9, 31, 12, 0, 0)
      expect(await take(db, "post:test", "second", 1, now)).toBe(1)
      await expect(take(db, "post:test", "second", 1, now + 500)).rejects.toMatchObject({
        status: 429,
      })
      expect(await take(db, "post:test", "second", 1, now + 1000)).toBe(1)
    })
  })

  describe("tokens", () => {
    test("a token's secret is shown once, names its member until revoked, and a name is unique", async () => {
      const made = await store.createToken(db, web("bo"), "laptop")
      expect(made.secret).toStartWith("yard_")
      expect((await store.tokenOwner(db, made.secret))?.device).toBe("laptop")
      await expect(store.createToken(db, web("bo"), "laptop")).rejects.toMatchObject({
        status: 409,
      })
      await expect(store.createToken(db, web("bo"), "web")).rejects.toThrow()
      await store.revokeToken(db, web("bo"), made.id)
      expect(await store.tokenOwner(db, made.secret)).toBeNull()
      await expect(store.revokeToken(db, web("di"), made.id)).rejects.toMatchObject({ status: 404 })
    })
  })

  describe("invites", () => {
    test("an invite for a login lets that login in once, as a member in #general", async () => {
      const invite = await store.createInvite(db, web("ada", true), { forLogin: "CY" })
      await expect(store.redeemInvite(db, web("di"), invite.code)).rejects.toMatchObject({
        status: 404,
      })
      expect(await store.redeemInvite(db, web("cy"), invite.code.toLowerCase())).toEqual({
        member: true,
      })
      await expect(store.redeemInvite(db, web("cy"), invite.code)).rejects.toMatchObject({
        status: 404,
      })
      const [row] = await sql`select role from "user" where id = 'cy'`
      expect(row.role).toBe("member")
      expect(
        (await store.channels(db, web("cy"))).find((c) => c.name === store.GENERAL)?.joined,
      ).toBe(true)
    })

    test("a member's request has no code until the owner opens it; the member sees their own requests alone", async () => {
      const asked = await store.requestInvite(db, web("bo"), "eve")
      expect(asked).toMatchObject({ requestedBy: { login: "bo" }, status: "requested" })
      expect((await store.invites(db, web("di"))).map((i) => i.id)).not.toContain(asked.id)
      const opened = await store.decideInvite(db, web("ada", true), asked.id, "approve")
      expect(opened).toMatchObject({ status: "open" })
      expect(opened.code).toMatch(/^[A-Z\d]{4}-[A-Z\d]{4}-[A-Z\d]{4}$/)
      await expect(
        store.decideInvite(db, web("ada", true), asked.id, "approve"),
      ).rejects.toMatchObject({ status: 409 })
      expect((await store.decideInvite(db, web("ada", true), asked.id, "deny")).status).toBe(
        "revoked",
      )
    })

    test("an expired invite lets nobody in", async () => {
      const invite = await store.createInvite(db, web("ada", true), {})
      await sql`update yard_invite set expires_at = now() - interval '1 minute' where id = ${invite.id}`
      await expect(store.redeemInvite(db, web("di"), invite.code)).rejects.toMatchObject({
        status: 404,
      })
    })
  })
})
