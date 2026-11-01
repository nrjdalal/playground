import { db, type Database } from "@packages/db"

import { currentSource } from "@/lib/dashboard/fixture"
import { ownVibe } from "@/lib/dashboard/vibe"
import { readDispatcherSlots } from "@/lib/dashboard/workers"
import { DB_TIMEOUT_MS, healthBody } from "@/lib/db-health"

export { DB_TIMEOUT_MS, type DbCheck, probeDb } from "@/lib/db-health"

// The local dashboard's /api/health body (lib/db-health.ts), with the source this stack reads, its dispatcher rows, and the branch while this checkout runs as a Vibeground.
export const healthData = (database: Database = db, withinMs: number = DB_TIMEOUT_MS) =>
  healthBody(
    readDispatcherSlots().then((dispatcherSlots) => ({
      dashboard: currentSource().kind,
      dispatcherSlots,
      vibe: ownVibe(),
    })),
    database,
    withinMs,
  )
