import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// #1297: each session start runs spawn.sh with the API's spawn env; without it Bun's spawn hands the child the startup environment alone
const ROOT = join(import.meta.dir, "../../../../../..")

describe("the API's session starts hand their spawn env to spawn.sh", () => {
  for (const file of [
    "api/hono/src/lib/dashboard/dispatcher-start.ts",
    "api/hono/src/lib/dashboard/restart.ts",
    "api/hono/src/lib/dashboard/templates.ts",
  ])
    test(`${file} spawns with spawnEnv()`, () => {
      expect(readFileSync(join(ROOT, file), "utf8")).toContain("env: spawnEnv()")
    })
})
