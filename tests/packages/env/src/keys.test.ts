import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const DIST = join(import.meta.dir, "../../../../packages/env/dist")
// A folder whose ../../.env does not exist, so the env modules' dotenv load finds no URL.
const dir = mkdtempSync(join(tmpdir(), "env-keys-"))
const cwd = join(dir, "a", "b")
mkdirSync(cwd, { recursive: true })
afterAll(() => rmSync(dir, { force: true, recursive: true }))

test("the db schema reads a POSTGRES_URL set after the API's env loaded, as first run's setup sets it in process", () => {
  const url = "postgres://postgres:pw@127.0.0.1:5999/postgres"
  const script = [
    `await import(${JSON.stringify(join(DIST, "api-hono.mjs"))})`,
    `process.env.POSTGRES_URL = ${JSON.stringify(url)}`,
    `const { env } = await import(${JSON.stringify(join(DIST, "db.mjs"))})`,
    `process.stdout.write(env.POSTGRES_URL)`,
  ].join("; ")
  const run = Bun.spawnSync([process.execPath, "--no-env-file", "-e", script], {
    cwd,
    env: {
      HOME: process.env.HOME ?? "",
      HONO_APP_URL: "http://127.0.0.1:4000",
      HONO_TRUSTED_ORIGINS: "http://127.0.0.1:3000",
      NODE_ENV: "local",
      PATH: process.env.PATH ?? "",
    },
  })
  expect(run.stderr.toString()).toBe("")
  expect(run.stdout.toString()).toBe(url)
})
