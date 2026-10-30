import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CONFIG = join(import.meta.dir, "../../../packages/db/tsdown.config.ts")
// A folder whose ../../.env does not exist, so the config's dotenv load finds no URL.
const dir = mkdtempSync(join(tmpdir(), "db-config-"))
const cwd = join(dir, "a", "b")
mkdirSync(cwd, { recursive: true })
afterAll(() => rmSync(dir, { force: true, recursive: true }))

const load = (env: Record<string, string>) =>
  Bun.spawnSync([process.execPath, "-e", `await import(${JSON.stringify(CONFIG)})`], {
    cwd,
    env: { HOME: process.env.HOME ?? "", NODE_ENV: "local", PATH: process.env.PATH ?? "", ...env },
  })

test("the build loads with no POSTGRES_URL, as first run's setup mode builds before a database exists", () => {
  for (const url of [{}, { POSTGRES_URL: "" }] as Record<string, string>[]) {
    const run = load(url)
    expect(run.stderr.toString()).toBe("")
    expect(run.exitCode).toBe(0)
  }
})

test("the build still refuses a POSTGRES_URL that is not a URL", () => {
  expect(load({ POSTGRES_URL: "not a url" }).exitCode).not.toBe(0)
})
