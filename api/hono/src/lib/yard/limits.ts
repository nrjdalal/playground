import { type Database, yardMessage, yardRate } from "@packages/db"
import { and, isNull, lt, sql } from "drizzle-orm"

import { ApiError } from "@/lib/error"

const WINDOW_MS = { day: 86_400_000, hour: 3_600_000, second: 1000 } as const

export type Window = keyof typeof WINDOW_MS

// How long a message is kept before the daily sweep deletes it (the owner's #i6).
export const RETENTION_DAYS = 90

// Counts one more under key in the fixed window holding now, and refuses past max with 429; the counter lives in yard_rate, so every instance counts the same.
export const take = async (
  db: Database,
  key: string,
  window: Window,
  max: number,
  now = Date.now(),
): Promise<number> => {
  const windowStart = new Date(now - (now % WINDOW_MS[window]))
  const [row] = await db
    .insert(yardRate)
    .values({ count: 1, key, windowStart })
    .onConflictDoUpdate({
      set: { count: sql`${yardRate.count} + 1` },
      target: [yardRate.key, yardRate.windowStart],
    })
    .returning({ count: yardRate.count })
  if (row!.count > max)
    throw new ApiError(429, "TOO_MANY_REQUESTS", `At most ${max} a ${window}; try again later`)
  return row!.count
}

// The oldest a thread's newest message may be for the thread to live: a thread (a first message and its replies) is kept until its newest message is past retention, so a reply never goes before the thread it answers.
export const cutoff = (now = Date.now()): Date => new Date(now - RETENTION_DAYS * WINDOW_MS.day)

// True for a message whose thread still lives, the row named by alias (yard_message itself by default); every read filters by it, so a message past retention is gone whether or not a sweep has run.
export const live = (alias = `"yard_message"`, now = Date.now()) => {
  const root = sql.raw(`coalesce(${alias}.parent_id, ${alias}.id)`)
  return sql`exists (select 1 from yard_message t where (t.id = ${root} or t.parent_id = ${root}) and t.at > ${cutoff(now)})`
}

// The UTC day this instance last swept, so only its first request of a day reaches the database for it.
let sweptDay = 0

// Deletes threads past retention, and counters from windows already over, once a UTC day across every instance: the day's first request of any kind runs it, read, sign-in or post alike, so a quiet Yard still forgets on time.
export const sweepOnceADay = async (db: Database, now = Date.now()): Promise<boolean> => {
  const day = now - (now % WINDOW_MS.day)
  if (sweptDay === day) return false
  const [first] = await db
    .insert(yardRate)
    .values({ count: 1, key: "sweep", windowStart: new Date(day) })
    .onConflictDoNothing()
    .returning({ count: yardRate.count })
  sweptDay = day
  if (!first) return false
  await db
    .delete(yardMessage)
    .where(and(isNull(yardMessage.parentId), sql`not ${live(undefined, now)}`))
  await db.delete(yardRate).where(lt(yardRate.windowStart, new Date(day)))
  return true
}
