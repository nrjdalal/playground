import { env } from "@packages/env/db"
import { SQL } from "bun"
import { drizzle } from "drizzle-orm/bun-sql"

import * as schema from "@/schema"
import type { Database } from "@/types"

declare global {
  var db: Database
}

let db: Database

if (env.NODE_ENV === "production") {
  const client = new SQL(env.POSTGRES_URL, {
    connectionTimeout: 10,
    idleTimeout: 30,
    maxLifetime: 0,
    tls: {
      rejectUnauthorized: true,
    },
  })
  db = drizzle({ client, schema })
} else {
  if (!global.db) {
    const client = new SQL(env.POSTGRES_URL, {
      connectionTimeout: 10,
      idleTimeout: 30,
      maxLifetime: 0,
    })
    global.db = drizzle({ client, schema })
  }
  db = global.db
}

// A client for one explicit URL, for a caller that may write only where it has proved it should (the session importer checks its URL is this machine's own Postgres first).
export const createDatabase = (url: string): Database =>
  drizzle({
    client: new SQL(url, { connectionTimeout: 10, idleTimeout: 30, maxLifetime: 0 }),
    schema,
  })

export { db }
export * from "@/console"
export * from "@/schema"
export type * from "@/types"
