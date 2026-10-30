import { type SQL, sql } from "drizzle-orm"
import { customType } from "drizzle-orm/pg-core"

// drizzle's own json and jsonb hand Bun's SQL client a JSON string, which Bun binds as json, so every object or array lands as one JSON string; casting through text stores the value itself. A row written before this fix still reads back as its value, as drizzle's own did, so until a repair lets that parse go, a stored string that is itself JSON text (`"5"`, `'{"a":1}'`) reads back parsed: keep this column to objects and arrays.
export const jsonb = customType<{ data: unknown; driverData: SQL }>({
  dataType: () => "jsonb",
  fromDriver: (value) => {
    if (typeof value !== "string") return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  },
  toDriver: (value) => sql`${JSON.stringify(value)}::text::jsonb`,
})

// A jsonb for a table that never held drizzle's stringified rows, so a value reads back as it was written, a string that is itself JSON text ("5") included.
export const jsonValue = customType<{ data: unknown; driverData: SQL }>({
  dataType: () => "jsonb",
  toDriver: (value) => sql`${JSON.stringify(value)}::text::jsonb`,
})
