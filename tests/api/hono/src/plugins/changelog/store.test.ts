import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { SQL } from "bun"

import type { NewEntry } from "../../../../../../api/hono/src/plugins/changelog/sources"

// The store against a throwaway Postgres in Docker published on 127.0.0.1 only, migrated as the dashboard's is, so the source-key rule is the table's own. Skipped where Docker is not running.
const MIGRATIONS = join(import.meta.dir, "../../../../../../packages/db/drizzle")
const PASSWORD = "changelog-store-test"

const dockerUp = (): boolean =>
  Bun.which("docker") !== null &&
  Bun.spawnSync(["docker", "info"], { stderr: "ignore", stdout: "ignore" }).exitCode === 0

const entry = (sourceKey: string | null, text: string, at: string): NewEntry => ({
  at: new Date(at),
  kind: "feature",
  link: null,
  sourceKey,
  text,
})

describe.skipIf(!dockerUp())("the changelog store", () => {
  let container = ""
  let url = ""
  let admin: SQL
  let store: typeof import("../../../../../../api/hono/src/plugins/changelog/store")
  let db: ReturnType<typeof import("../../../../../../packages/db/dist/index.mjs").createDatabase>

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
    process.env.POSTGRES_URL ||= url
    store = await import("../../../../../../api/hono/src/plugins/changelog/store")
    db = (await import("../../../../../../packages/db/dist/index.mjs")).createDatabase(url)
  }, 60_000)

  afterAll(() => {
    if (container)
      Bun.spawnSync(["docker", "rm", "-fv", container], { stderr: "ignore", stdout: "ignore" })
  })

  test("adds a keyed row once, however often it is offered, and a keyless row every time", async () => {
    const rows = [
      entry("pr:o/r#1", "One.", "2026-10-06T10:00:00Z"),
      entry(null, "By hand.", "2026-10-07T10:00:00Z"),
    ]
    const first = await store.addEntries(db, rows, "seed")
    expect(first.added.map((e) => e.text)).toEqual(["One.", "By hand."])
    const again = await store.addEntries(db, rows, "seed")
    expect(again.added.map((e) => e.text)).toEqual(["By hand."])
    expect(again.skipped.map((e) => e.sourceKey)).toEqual(["pr:o/r#1"])
    expect(await store.knownKeys(db, ["pr:o/r#1", "pr:o/r#2"])).toEqual(new Set(["pr:o/r#1"]))
  })

  test("lists the newest first, by when each happened", async () => {
    const entries = await store.listEntries(db)
    expect(entries.map((e) => e.text)).toEqual(["By hand.", "By hand.", "One."])
    expect(entries[2]).toMatchObject({ actor: "seed", kind: "feature", link: null })
  })

  test("a row already there gains only the detail and screenshots it lacked", async () => {
    const plain = { ...entry("pr:o/r#7", "Seven.", "2026-10-05T10:00:00Z") }
    await store.addEntries(db, [plain], "ops-dashboard")
    const fuller = {
      ...plain,
      detail: "What it does.",
      images: [{ alt: "Before", id: "a.png" }],
      text: "A new line.",
    }
    const version = async () =>
      (await admin`select xmin::text as v from changelog_entry where source_key = 'pr:o/r#7'`)[0].v
    const untouched = await version()
    await store.addEntries(db, [plain], "ops-dashboard")
    expect(await version()).toBe(untouched)
    const result = await store.addEntries(db, [fuller], "seed")
    expect(result.skipped.map((e) => e.sourceKey)).toEqual(["pr:o/r#7"])
    await store.addEntries(
      db,
      [{ ...fuller, detail: "Other.", images: [{ alt: "X", id: "b.png" }] }],
      "seed",
    )
    const row = (await store.listEntries(db)).find((e) => e.text === "Seven.")
    expect(row).toMatchObject({
      actor: "ops-dashboard",
      detail: "What it does.",
      images: [{ alt: "Before", id: "a.png" }],
    })
    expect(await store.keysWithImages(db, ["pr:o/r#7", "pr:o/r#1"])).toEqual(new Set(["pr:o/r#7"]))
    const [stored] =
      await admin`select jsonb_typeof(images) as type from changelog_entry where source_key = 'pr:o/r#7'`
    expect(stored.type).toBe("array")
  })

  test("a detail refresh rewrites the detail once, clears one the rule no longer gives, and leaves the rest", async () => {
    const seven = { ...entry("pr:o/r#7", "Seven.", "2026-10-05T10:00:00Z"), detail: "- New." }
    const refresh = { refreshDetail: true }
    expect((await store.addEntries(db, [seven], "seed", refresh)).updated).toBe(1)
    expect((await store.addEntries(db, [seven], "seed", refresh)).updated).toBe(0)
    const row = () => store.listEntries(db).then((rows) => rows.find((e) => e.text === "Seven."))
    expect(await row()).toMatchObject({
      detail: "- New.",
      images: [{ alt: "Before", id: "a.png" }],
    })
    const cleared = { ...seven, detail: null }
    expect((await store.addEntries(db, [cleared], "seed", refresh)).updated).toBe(1)
    expect((await store.addEntries(db, [cleared], "seed", refresh)).updated).toBe(0)
    expect(await row()).toMatchObject({ detail: null, images: [{ alt: "Before", id: "a.png" }] })
  })

  test("a refresh rewrites a merge's line too, once", async () => {
    const seven = {
      ...entry("pr:o/r#7", "Seven, by today's rule.", "2026-10-05T10:00:00Z"),
      detail: null,
    }
    const refresh = { refreshDetail: true }
    expect((await store.addEntries(db, [seven], "seed", refresh)).updated).toBe(1)
    expect((await store.addEntries(db, [seven], "seed", refresh)).updated).toBe(0)
    // a plain sync that does rewrite the row, gaining its detail, still leaves its line
    const plain = { ...seven, detail: "- Gained.", text: "Not without a refresh." }
    expect((await store.addEntries(db, [plain], "seed")).updated).toBe(1)
    const texts = (await store.listEntries(db)).map((e) => e.text)
    expect(texts).toContain("Seven, by today's rule.")
    expect(texts).not.toContain("Not without a refresh.")
  })

  test("lists every merge's key, and drops the rows of the keys it is given", async () => {
    await store.addEntries(
      db,
      [entry("pr:o/r#291", "Bump.", "2026-10-07T09:00:00Z")],
      "ops-dashboard",
    )
    expect(await store.pullKeys(db)).toEqual(
      expect.arrayContaining(["pr:o/r#1", "pr:o/r#7", "pr:o/r#291"]),
    )
    expect(await store.dropKeys(db, ["pr:o/r#291", "pr:o/r#999"])).toBe(1)
    expect(await store.dropKeys(db, [])).toBe(0)
    expect(await store.pullKeys(db)).not.toContain("pr:o/r#291")
  })

  test("counts unread per viewer from their last look, never moving the mark back or past now", async () => {
    await admin`insert into "user" (id, name, email) values ('u1', 'One', 'one@local.host'), ('u2', 'Two', 'two@local.host')`
    const total = (await store.listEntries(db)).length
    expect(await store.unreadCount(db, "u1")).toBe(total)
    expect(await store.seenAt(db, "u1")).toBeNull()
    const newest = (await store.listEntries(db))
      .map((e) => e.createdAt)
      .sort()
      .at(-1)!
    await store.markSeen(db, "u1", new Date(newest))
    expect(await store.unreadCount(db, "u1")).toBe(0)
    expect(await store.unreadCount(db, "u2")).toBe(total)
    await store.markSeen(db, "u1", new Date("2020-01-01T00:00:00Z"))
    expect((await store.seenAt(db, "u1"))?.toISOString()).toBe(newest)
    await store.addEntries(db, [entry(null, "Later.", "2026-10-07T12:00:00Z")], "cli")
    expect(await store.unreadCount(db, "u1")).toBe(1)
    const mark = await store.markSeen(db, "u1", new Date("2999-01-01T00:00:00Z"))
    const [{ now }] = await admin`select now() as now`
    expect(mark.getTime()).toBeLessThanOrEqual(new Date(now).getTime())
    expect(await store.unreadCount(db, "u1")).toBe(0)
  })

  test("drops the fixture's rows alone", async () => {
    await store.addEntries(db, [entry("fixture:1", "Made up.", "2026-10-07T09:00:00Z")], "fixture")
    const before = (await store.listEntries(db)).length
    await store.dropFixtureRows(db)
    const after = await store.listEntries(db)
    expect(after).toHaveLength(before - 1)
    expect(after.some((e) => e.text === "Made up.")).toBe(false)
  })
})
