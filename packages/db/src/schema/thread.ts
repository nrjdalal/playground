import { pgTable, text, timestamp } from "drizzle-orm/pg-core"

// A thread: one thing the owner asked about, followed up until it is done. It is the owner's, not a session's, so it lives in the dashboard's local Postgres beside the transcripts it collects (claude_entry.thread_id). Its shapes on the wire are in @packages/config/threads.
export const thread = pgTable("thread", {
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // 4 characters of ID_ALPHABET, at least one a letter (THREAD_ID), made by whoever opens the thread.
  id: text("id").primaryKey(),
  // A message stamped after it is unread; null means every message is.
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  title: text("title").notNull(),
  // The newest routed message's time, bumped by each route rather than read from claude_entry, so the sidebar's order reads this table alone.
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
})
