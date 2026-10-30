import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const SCHEMA = join(import.meta.dir, "../../../../packages/db/src/schema")

// drizzle-orm's own json and jsonb store every object or array as one JSON string over Bun's SQL client, so a schema file takes the jsonb in packages/db/src/columns.ts.
describe("jsonb columns", () => {
  test("no schema file takes json or jsonb from drizzle-orm", () => {
    const offenders = readdirSync(SCHEMA)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) =>
        /import\s*{[^}]*\bjsonb?\b[^}]*}\s*from\s*["']drizzle-orm\/pg-core["']/.test(
          readFileSync(join(SCHEMA, name), "utf8"),
        ),
      )
    expect(offenders).toEqual([])
  })
})
