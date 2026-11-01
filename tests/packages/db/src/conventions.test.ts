import { describe, expect, test } from "bun:test"

import { is, sql } from "../../../../packages/db/node_modules/drizzle-orm"
import {
  getTableConfig,
  index,
  pgTable,
  PgTable,
  text,
  type UpdateDeleteAction,
} from "../../../../packages/db/node_modules/drizzle-orm/pg-core"
import * as schema from "../../../../packages/db/src/schema"

// db-migration's Conventions: every foreign key takes onDelete "cascade", and a full index (no WHERE) leads with every foreign-key column; each exception is one of that skill's two bends, keyed `table.column`, and lands in the same PR as its column.
const NOT_CASCADE: Record<string, { action: UpdateDeleteAction; reason: string }> = {
  "activity.actor_id": {
    action: "set null",
    reason: "provenance: the row outlives the account, and actor keeps the readable name",
  },
  "allowlist.actor_id": {
    action: "set null",
    reason: "provenance: the rule outlives its author, and actor keeps the readable name",
  },
  "claude_entry.thread_id": {
    action: "set null",
    reason: "a transcript line outlives the thread it was routed to",
  },
  "claude_session.parent_id": {
    action: "set null",
    reason: "provenance: a session outlives its parent",
  },
  "inbox_item.thread_id": { action: "set null", reason: "an Inbox item outlives its thread" },
}
const UNINDEXED: Record<string, string> = {
  "activity.actor_id":
    "every console list drives off user's primary key, never this column (the skill's worked example)",
  "allowlist.actor_id":
    "every console list drives off user's primary key, never this column (the skill's worked example)",
  "inbox_item.thread_id":
    "nothing reads items by thread, and the table is small enough for a thread delete to scan",
  "invitation.inviter_id":
    "Better Auth writes it and never queries by it, and no Playground code sends an invitation, so the table stays small",
}
// A column whose only leading index is partial, and why its WHERE still holds every row a delete of the referenced row touches.
const PARTIAL_INDEX: Record<string, string> = {
  "claude_entry.thread_id":
    "its unique index on (thread_id, thread_seq) holds every row with a thread, and a thread delete sets null only rows whose thread_id is that thread's",
}

const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
  is(value, PgTable),
)

const foreignKeys = (table: PgTable) => {
  const config = getTableConfig(table)
  const lead = (i: (typeof config.indexes)[number]) =>
    (i.config.columns[0] as { name?: string }).name
  // Postgres backs a primary key and a unique constraint with a full index, so their leading columns count beside the declared indexes'.
  const full = new Set([
    ...config.indexes.filter((i) => !i.config.where).map(lead),
    ...config.primaryKeys.map((key) => key.columns[0]?.name),
    ...config.uniqueConstraints.map((unique) => unique.columns[0]?.name),
    ...config.columns
      .filter((column) => column.primary || column.isUnique)
      .map((column) => column.name),
  ])
  const partial = new Set(config.indexes.filter((i) => i.config.where).map(lead))
  return config.foreignKeys.map((key) => {
    const first = key.reference().columns[0]!.name
    return {
      column: `${config.name}.${first}`,
      indexed: full.has(first),
      onDelete: key.onDelete,
      partial: !full.has(first) && partial.has(first),
    }
  })
}

const breaks = (from: PgTable[]) => {
  const keys = from.flatMap(foreignKeys)
  return {
    notCascade: keys
      .filter(
        (key) => key.onDelete !== "cascade" && NOT_CASCADE[key.column]?.action !== key.onDelete,
      )
      .map((key) => `${key.column} (${key.onDelete})`),
    unindexed: keys
      .filter(
        (key) =>
          !key.indexed &&
          !(key.column in UNINDEXED) &&
          !(key.partial && key.column in PARTIAL_INDEX),
      )
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
      Object.entries(NOT_CASCADE)
        .filter(([column, { action }]) => !bent(column, (key) => key.onDelete === action))
        .map(([column]) => column),
    ).toEqual([])
    expect(Object.keys(UNINDEXED).filter((column) => !bent(column, (key) => !key.indexed))).toEqual(
      [],
    )
    expect(
      Object.keys(PARTIAL_INDEX).filter((column) => !bent(column, (key) => key.partial)),
    ).toEqual([])
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

  test("an exception's column whose action differs from the one its bend names is flagged", () => {
    const user = pgTable("probe_user", { id: text("id").primaryKey() })
    const activity = pgTable("activity", {
      actorId: text("actor_id").references(() => user.id, { onDelete: "restrict" }),
      id: text("id").primaryKey(),
    })
    const allowlist = pgTable("allowlist", {
      actorId: text("actor_id").references(() => user.id),
      id: text("id").primaryKey(),
    })
    expect(breaks([activity, allowlist]).notCascade).toEqual([
      "activity.actor_id (restrict)",
      "allowlist.actor_id (no action)",
    ])
  })

  test("a partial index does not count as the index a foreign-key column leads", () => {
    const parent = pgTable("probe_parent", { id: text("id").primaryKey() })
    const child = pgTable(
      "probe_child",
      {
        id: text("id").primaryKey(),
        parentId: text("parent_id").references(() => parent.id, { onDelete: "cascade" }),
      },
      (table) => [
        index("probe_child_parent_id_idx")
          .on(table.parentId)
          .where(sql`${table.parentId} like 'a%'`),
      ],
    )
    expect(breaks([child]).unindexed).toEqual(["probe_child.parent_id"])
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
