import { type Database, inboxItem } from "@packages/db"
import { inArray } from "drizzle-orm"

export type { Result, Who } from "@packages/settings"

// Which of these inbox refs name an item this machine holds.
export const knownInboxRefs = async (db: Database, refs: number[]): Promise<Set<number>> =>
  new Set(
    refs.length
      ? (
          await db
            .select({ ref: inboxItem.ref })
            .from(inboxItem)
            .where(inArray(inboxItem.ref, [...new Set(refs)]))
        ).map((row) => row.ref)
      : [],
  )
