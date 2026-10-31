import { db, type Database } from "@packages/db"
import { getBuildVersion } from "@packages/env"
import { env } from "@packages/env/api-hono"
import { sql } from "drizzle-orm"

import type { DashboardSource } from "@/lib/dashboard/fixture"

// How long /api/health waits for its `select 1`, so a database that hung (8 Oct: Docker stopped answering for 42 minutes) degrades the route instead of leaving it saying ok. It sits under the web's 2s abort on this route (web/next/src/lib/health.ts), so the API answers before the page gives up.
export const DB_TIMEOUT_MS = 1_500

export type DbCheck = { state: "ok" } | { state: "unreachable"; error: string }

// The driver's own words for what went wrong: drizzle wraps them naming the query, so the cause carries the refusal.
const words = (error: unknown): string => {
  const cause = (error as { cause?: unknown } | null)?.cause
  if (cause instanceof Error && cause.message) return cause.message
  if (error instanceof Error) return error.message
  return String(error)
}

// One `select 1`, raced against the timeout, since the driver's own timeouts bound neither a server that accepts and never answers nor a connect to a black hole.
export const probeDb = async (
  database: Database = db,
  withinMs: number = DB_TIMEOUT_MS,
): Promise<DbCheck> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const slow = new Promise<DbCheck>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          state: "unreachable",
          error: `no answer from the database within ${withinMs}ms`,
        }),
      withinMs,
    )
  })
  try {
    return await Promise.race([
      database.execute(sql`select 1`).then(
        (): DbCheck => ({ state: "ok" }),
        (error: unknown): DbCheck => ({ state: "unreachable", error: words(error) }),
      ),
      slow,
    ])
  } finally {
    clearTimeout(timer)
  }
}

// What the body says about the machine the stack reads: its source, the sidebar's dispatcher rows, and the branch while the checkout runs as a Vibeground.
export type HealthMachine = {
  dashboard: DashboardSource["kind"]
  dispatcherSlots: number
  vibe: string | null
}

// The /api/health body: the fields it always carried, plus the database's state and an overall message that degrades when it cannot be reached, and the machine's word, which the web's server render reads with it. It reads no machine itself, so the hosted build serves it too.
export const healthBody = async (
  machine: HealthMachine | Promise<HealthMachine>,
  database: Database = db,
  withinMs: number = DB_TIMEOUT_MS,
): Promise<
  { db: DbCheck["state"]; dbError?: string } & HealthMachine & {
      environment: (typeof env)["NODE_ENV"]
      message: "ok" | "degraded"
      version: string
    }
> => {
  const [checked, { dashboard, dispatcherSlots, vibe }] = await Promise.all([
    probeDb(database, withinMs),
    machine,
  ])
  return {
    db: checked.state,
    ...(checked.state === "unreachable" ? { dbError: checked.error } : {}),
    dashboard,
    dispatcherSlots,
    environment: env.NODE_ENV,
    message: checked.state === "ok" ? "ok" : "degraded",
    version: getBuildVersion(),
    vibe,
  }
}
