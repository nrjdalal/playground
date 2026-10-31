import { describe, expect, test } from "bun:test"

import { is } from "../../../../packages/db/node_modules/drizzle-orm"
import {
  getTableConfig,
  index,
  pgTable,
  PgTable,
  text,
} from "../../../../packages/db/node_modules/drizzle-orm/pg-core"
import * as schema from "../../../../packages/db/src/schema"

// db-migration's Conventions: every foreign key takes onDelete "cascade", and an index leads with every foreign-key column; each exception is one of that skill's two bends, keyed `table.column`, and lands in the same PR as its column.
const NOT_CASCADE: Record<string, string> = {
  "activity.actor_id":
    "provenance: the row outlives the account, and actor keeps the readable name",
  "allowlist.actor_id":
    "provenance: the rule outlives its author, and actor keeps the readable name",
  "claude_entry.thread_id": "a transcript line outlives the thread it was routed to",
  "claude_session.parent_id": "provenance: a session outlives its parent",
  "inbox_item.thread_id": "an Inbox item outlives its thread",
}
const UNINDEXED: Record<string, string> = {
  "activity.actor_id":
    "every console list drives off user's primary key, never this column (the skill's worked example)",
  "allowlist.actor_id":
    "every console list drives off user's primary key, never this column (the skill's worked example)",
  "inbox_item.thread_id":
    "nothing reads items by thread, and the table is small enough for a thread delete to scan",
  "invitation.inviter_id":
    "Better Auth writes it and never queries by it, and the table holds one row per invitation",
}

const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
  is(value, PgTable),
)

const foreignKeys = (table: PgTable) => {
  const config = getTableConfig(table)
  // Postgres backs a primary key and a unique constraint with an index, so their leading columns count beside the declared indexes'.
  const leading = new Set([
    ...config.indexes.map((i) => (i.config.columns[0] as { name?: string }).name),
    ...config.primaryKeys.map((key) => key.columns[0]?.name),
    ...config.uniqueConstraints.map((unique) => unique.columns[0]?.name),
    ...config.columns
      .filter((column) => column.primary || column.isUnique)
      .map((column) => column.name),
  ])
  return config.foreignKeys.map((key) => {
    const first = key.reference().columns[0]!.name
    return {
      column: `${config.name}.${first}`,
      indexed: leading.has(first),
      onDelete: key.onDelete,
    }
  })
}

const breaks = (from: PgTable[]) => {
  const keys = from.flatMap(foreignKeys)
  return {
    notCascade: keys
      .filter((key) => key.onDelete !== "cascade" && !(key.column in NOT_CASCADE))
      .map((key) => `${key.column} (${key.onDelete})`),
    unindexed: keys
      .filter((key) => !key.indexed && !(key.column in UNINDEXED))
      .map((key) => key.column),
  }
}

describe("db-migration's foreign-key conventions", () => {
  test("every foreign key cascades and leads an index, or is a listed exception", () => {
    expect(tables.length).toBeGreaterThan(0)
    expect(breaks(tables)).toEqual({ notCascade: [], unindexed: [] })
  })

  test("each exception names a foreign key that still bends its rule", () => {
    const keys = tables.flatMap(foreignKeys)
    const bent = (column: string, rule: (key: (typeof keys)[number]) => boolean) =>
      keys.some((key) => key.column === column && rule(key))
    expect(
      Object.keys(NOT_CASCADE).filter(
        (column) => !bent(column, (key) => key.onDelete !== "cascade"),
      ),
    ).toEqual([])
    expect(Object.keys(UNINDEXED).filter((column) => !bent(column, (key) => !key.indexed))).toEqual(
      [],
    )
  })

  test("a new foreign key with no onDelete, or with restrict, is flagged", () => {
    const parent = pgTable("probe_parent", { id: text("id").primaryKey() })
    const child = pgTable(
      "probe_child",
      {
        bareId: text("bare_id").references(() => parent.id),
        id: text("id").primaryKey(),
        keptId: text("kept_id").references(() => parent.id, { onDelete: "restrict" }),
        ownedId: text("owned_id").references(() => parent.id, { onDelete: "cascade" }),
      },
      (table) => [
        index("probe_child_bare_id_idx").on(table.bareId),
        index("probe_child_kept_id_idx").on(table.keptId),
        index("probe_child_owned_id_idx").on(table.ownedId),
      ],
    )
    expect(breaks([child]).notCascade).toEqual([
      "probe_child.bare_id (no action)",
      "probe_child.kept_id (restrict)",
    ])
  })

  test("a new foreign-key column with no index is flagged", () => {
    const parent = pgTable("probe_parent", { id: text("id").primaryKey() })
    const child = pgTable("probe_child", {
      id: text("id").primaryKey(),
      parentId: text("parent_id").references(() => parent.id, { onDelete: "cascade" }),
    })
    expect(breaks([child]).unindexed).toEqual(["probe_child.parent_id"])
  })
})
