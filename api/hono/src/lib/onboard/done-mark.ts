import { appState, type Database, db } from "@packages/db"
import { eq } from "drizzle-orm"

import { currentSource } from "@/lib/dashboard/fixture"
import type { DoneMark } from "@/lib/onboard/checks"

export const DONE_KEY = "first_run_checks"

// A stack that does not read this Mac keeps its mark in this process alone, so a restart shows the checks again and its database never holds one.
let fixtureDone = false

// The first run's done mark in app_state: read by every checks read, and written once, the first time every check passes; a second write leaves the first doneAt in place.
export const doneMark = (
  database: Database = db,
  readsThisMac = () => currentSource().kind === "live",
): DoneMark => ({
  read: async () =>
    readsThisMac()
      ? (
          await database
            .select({ key: appState.key })
            .from(appState)
            .where(eq(appState.key, DONE_KEY))
            .limit(1)
        ).length > 0
      : fixtureDone,
  write: async () => {
    if (!readsThisMac()) {
      fixtureDone = true
      return
    }
    await database
      .insert(appState)
      .values({ key: DONE_KEY, value: { doneAt: new Date().toISOString() } })
      .onConflictDoNothing()
  },
})
