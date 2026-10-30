import { changelogEntry, changelogSeen, type Database } from "@packages/db"
import { and, count, desc, eq, inArray, sql } from "drizzle-orm"

import type { NewEntry } from "@/plugins/changelog/sources"
import type { ChangelogEntry, ChangelogImage, ChangelogKind } from "@/plugins/changelog/types"

// An entry as the table holds it: its screenshots by id alone, before the API reads their sizes.
export type StoredEntry = Omit<ChangelogEntry, "images"> & { images: ChangelogImage[] }

// The rows it adds, each by its source key at most once: a row whose key is already there is skipped, so a re-run, or a seed after a sync, adds nothing. A skipped row only gains what it lacked, a detail where it has none and screenshots where it has none, so rows synced before those were kept fill in; its line, kind and time stay. With refreshDetail a skipped row takes the line and the detail given in place of its own, none included, so a line or detail an older rule wrote goes; a row that already holds them is not rewritten, so a second refresh changes nothing. updated counts the skipped rows rewritten. A hand-added row has no key and is always added.
export async function addEntries(
  db: Database,
  entries: NewEntry[],
  actor: string,
  { refreshDetail = false }: { refreshDetail?: boolean } = {},
): Promise<{ added: NewEntry[]; skipped: NewEntry[]; updated: number }> {
  if (!entries.length) return { added: [], skipped: [], updated: 0 }
  const rows = await db
    .insert(changelogEntry)
    .values(
      entries.map((entry) => ({
        ...entry,
        actor,
        detail: entry.detail ?? null,
        images: entry.images ?? [],
      })),
    )
    .onConflictDoUpdate({
      target: changelogEntry.sourceKey,
      set: {
        detail: refreshDetail
          ? sql`excluded.detail`
          : sql`coalesce(${changelogEntry.detail}, excluded.detail)`,
        images: sql`case when ${changelogEntry.images} = '[]'::jsonb then excluded.images else ${changelogEntry.images} end`,
        text: refreshDetail ? sql`excluded.text` : changelogEntry.text,
      },
      // only a row that gains something is rewritten, so a sync of unchanged merges writes nothing
      setWhere: refreshDetail
        ? sql`${changelogEntry.detail} is distinct from excluded.detail or ${changelogEntry.text} is distinct from excluded.text or (${changelogEntry.images} = '[]'::jsonb and excluded.images <> '[]'::jsonb)`
        : sql`(${changelogEntry.detail} is null and excluded.detail is not null) or (${changelogEntry.images} = '[]'::jsonb and excluded.images <> '[]'::jsonb)`,
    })
    .returning({
      inserted: sql<boolean>`xmax = 0`,
      sourceKey: changelogEntry.sourceKey,
    })
  const keys = new Set(rows.filter((row) => row.inserted).map((row) => row.sourceKey))
  return {
    added: entries.filter((entry) => entry.sourceKey === null || keys.has(entry.sourceKey)),
    skipped: entries.filter((entry) => entry.sourceKey !== null && !keys.has(entry.sourceKey)),
    updated: rows.filter((row) => !row.inserted).length,
  }
}

// The newest entries first, by when each happened.
export async function listEntries(db: Database, limit = 500): Promise<StoredEntry[]> {
  const rows = await db
    .select()
    .from(changelogEntry)
    .orderBy(desc(changelogEntry.at), desc(changelogEntry.createdAt))
    .limit(limit)
  return rows.map((row) => ({
    id: row.id,
    actor: row.actor,
    at: row.at.toISOString(),
    createdAt: row.createdAt.toISOString(),
    detail: row.detail,
    images: row.images,
    kind: row.kind as ChangelogKind,
    link: row.link,
    sourceKey: row.sourceKey,
    text: row.text,
  }))
}

// Which of these source keys the changelog holds already, so sync reads only the versions it lacks.
export async function knownKeys(db: Database, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set()
  const rows = await db
    .select({ sourceKey: changelogEntry.sourceKey })
    .from(changelogEntry)
    .where(inArray(changelogEntry.sourceKey, keys))
  return new Set(rows.flatMap((row) => (row.sourceKey ? [row.sourceKey] : [])))
}

// Which of these source keys hold a row with screenshots, so the seed copies them only where they are missing.
export async function keysWithImages(db: Database, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set()
  const rows = await db
    .select({ sourceKey: changelogEntry.sourceKey })
    .from(changelogEntry)
    .where(
      and(inArray(changelogEntry.sourceKey, keys), sql`${changelogEntry.images} <> '[]'::jsonb`),
    )
  return new Set(rows.flatMap((row) => (row.sourceKey ? [row.sourceKey] : [])))
}

// When this viewer last looked at the Changelog, or null before their first look.
export async function seenAt(db: Database, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ seenAt: changelogSeen.seenAt })
    .from(changelogSeen)
    .where(eq(changelogSeen.userId, userId))
  return row?.seenAt ?? null
}

// How many entries reached the changelog since this viewer last looked: every entry before their first look. It counts by when an entry arrived, not when it happened, so a backfilled old merge still counts as new.
export async function unreadCount(db: Database, userId: string): Promise<number> {
  const seen = await seenAt(db, userId)
  const [row] = await db
    .select({ unread: count() })
    .from(changelogEntry)
    // to the millisecond, as the API hands createdAt to the page that marks it read
    .where(
      seen
        ? sql`date_trunc('milliseconds', ${changelogEntry.createdAt}) > ${seen.toISOString()}::timestamptz`
        : undefined,
    )
  return row?.unread ?? 0
}

// Records that this viewer has read up to `at` (the newest arrival the page showed them), never moving their mark back and never past now, so an entry that arrives while the page is open stays unread. Now is the database's clock, which stamps createdAt: Docker's VM clock can run ms ahead of the host's.
export async function markSeen(db: Database, userId: string, at: Date): Promise<Date> {
  const mark = sql`least(${at.toISOString()}::timestamptz, now())`
  const [row] = await db
    .insert(changelogSeen)
    .values({ seenAt: mark, userId })
    .onConflictDoUpdate({
      target: changelogSeen.userId,
      set: { seenAt: sql`greatest(${changelogSeen.seenAt}, excluded.seen_at)` },
    })
    .returning({ seenAt: changelogSeen.seenAt })
  if (!row) throw new Error("changelog: the read mark was not written")
  return row.seenAt
}

// Every merge's source key the changelog holds, for a refresh to find the ones the sync no longer keeps.
export async function pullKeys(db: Database): Promise<string[]> {
  const rows = await db
    .select({ sourceKey: changelogEntry.sourceKey })
    .from(changelogEntry)
    .where(sql`${changelogEntry.sourceKey} like 'pr:%'`)
  return rows.flatMap((row) => (row.sourceKey ? [row.sourceKey] : []))
}

// Removes the rows of these source keys, returning how many went.
export async function dropKeys(db: Database, keys: string[]): Promise<number> {
  if (!keys.length) return 0
  const rows = await db
    .delete(changelogEntry)
    .where(inArray(changelogEntry.sourceKey, keys))
    .returning({ id: changelogEntry.id })
  return rows.length
}

// Clears the fixture's made-up rows, so `bun run changelog fixture` writes them afresh at the current time.
export async function dropFixtureRows(db: Database): Promise<void> {
  await db.delete(changelogEntry).where(sql`${changelogEntry.sourceKey} like 'fixture:%'`)
}
