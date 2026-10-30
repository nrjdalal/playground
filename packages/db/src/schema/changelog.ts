import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core"

import { jsonb } from "@/columns"
import { user } from "@/schema/auth"

// The Changelog plugin's own tables (api/hono/src/plugins/changelog/README.md says how to drop them). They live only in the dashboard's local Postgres on 127.0.0.1.

// What changed in the factory, newest first: merged PRs, releases, rules, settings and ops. One plain line each, for the owner.
export const changelogEntry = pgTable(
  "changelog_entry",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // When it happened: a PR's merge time, a release's tag time, a rule's change. The page groups and sorts by it.
    at: timestamp("at", { withTimezone: true }).notNull(),
    // feature, fix, rule, setting, ops or release. Checked by the CLI's zod schema, not by a database constraint.
    kind: text("kind").notNull(),
    // The one plain line: a PR's "Outcome:" line, else its TL;DR's first bullet, or a prose TL;DR's first sentence, else its title.
    text: text("text").notNull(),
    // What changed, as a few lines of Markdown: a lead paragraph and bullets from a PR's body, else from its squash commit's message (detailOf and commitDetail in the changelog plugin's sources.ts); null when neither gives one.
    detail: text("detail"),
    // The PR's before and after screenshots, copied into the owner-only changelog folder and served by the API; never a URL.
    images: jsonb("images").$type<{ alt: string; id: string }[]>().default([]).notNull(),
    // A PR, release or artifact URL; null for a rule with nothing to link.
    link: text("link"),
    // Where the row came from, so a re-run adds nothing: "pr:acme/app#96", "release:v0.0.4". Null for a hand-added row, which is never deduplicated.
    sourceKey: text("source_key").unique(),
    // Who wrote it: a session name, "seed", or "ops-dashboard".
    actor: text("actor").notNull(),
    // When it reached the changelog. Unread counts use this, not `at`.
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("changelog_entry_at_idx").on(table.at.desc())],
)

// Each viewer's last look at the Changelog, so the Changelog square's unread count follows the person, not the browser.
export const changelogSeen = pgTable("changelog_seen", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull(),
})
