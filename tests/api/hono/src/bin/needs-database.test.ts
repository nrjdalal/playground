import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Each bin starts as its own process, which a loaded runner takes seconds over.
setDefaultTimeout(30_000)

const BIN = join(import.meta.dir, "../../../../../api/hono/src/bin")
// a folder outside any checkout, with no .env for bun or load-dotenv to find, as a fresh machine's first run has
const away = mkdtempSync(join(tmpdir(), "needs-database-"))
afterAll(() => rmSync(away, { force: true, recursive: true }))

// #2318: first run's setup has no database yet, so the bins say so in one line rather than the env check's schema dump.
test.each([
  ["ask", "dashboard-ask.ts", ["open"]],
  ["thread", "dashboard-thread.ts", ["list"]],
])("%s with an empty POSTGRES_URL says there is no database yet, in one line", (_, bin, args) => {
  const run = Bun.spawnSync(["bun", "--no-env-file", join(BIN, bin), ...args], {
    cwd: away,
    env: { HOME: away, PATH: process.env.PATH, POSTGRES_URL: "" },
  })
  expect(run.exitCode).toBe(1)
  expect(run.stderr.toString()).toBe(
    "there is no database yet: finish first-run setup on the Dashboard, then run this again\n",
  )
  expect(run.stdout.toString()).toBe("")
})
