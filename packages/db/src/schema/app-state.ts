import { pgTable, text, timestamp } from "drizzle-orm/pg-core"

import { jsonValue } from "@/columns"

// The app's own facts about this install, one row per key: first_run_checks holds { doneAt } once the first run's checks have all passed.
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
  value: jsonValue("value").notNull(),
})
