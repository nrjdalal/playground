import { expect, test } from "bun:test"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../../..")

// A shell value forced empty stays empty over any .env, so the gap holds wherever the suite runs.
const envKeys = (extra: Record<string, string>) =>
  Bun.spawnSync(
    [process.execPath, "--no-env-file", join(ROOT, "packages/scripts/src/env-keys.ts")],
    {
      cwd: ROOT,
      env: {
        BETTER_AUTH_SECRET: "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "",
        PATH: process.env.PATH ?? "",
        ...extra,
      },
    },
  )

test("refuses a required key left empty", () => {
  const run = envKeys({})
  expect(run.stderr.toString()).toContain("BETTER_AUTH_SECRET")
  expect(run.exitCode).toBe(1)
})

test("passes under the dev skill's no-.env recipe, NODE_ENV=production SKIP_ENV_VALIDATION=true", () => {
  const run = envKeys({ NODE_ENV: "production", SKIP_ENV_VALIDATION: "true" })
  expect(run.exitCode).toBe(0)
})

test("names NODE_ENV under SKIP_ENV_VALIDATION alone, as the apps' own validation refuses it", () => {
  const run = envKeys({ SKIP_ENV_VALIDATION: "true" })
  expect(run.stderr.toString()).toContain("NODE_ENV")
  expect(run.exitCode).toBe(1)
})

test("accepts POSTGRES_URL left empty, as first run's setup serves with it empty", () => {
  const run = envKeys({
    BETTER_AUTH_SECRET: "a".repeat(64),
    NODE_ENV: "development",
    POSTGRES_URL: "",
  })
  expect(run.stderr.toString()).not.toContain("POSTGRES_URL")
  expect(run.exitCode).toBe(0)
})
