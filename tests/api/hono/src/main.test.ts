import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { importGraph, SRC } from "./import-graph"

const MAIN = join(SRC, "main.ts")
const DATABASE_OR_AUTH_PACKAGES = ["@packages/auth", "@packages/db", "better-auth"]
const DATABASE_OR_AUTH_FILES = /^packages\/(auth|db)\/src\/|^packages\/env\/src\/(auth|db)\.ts$/

// With POSTGRES_URL empty, one static import of the db env stops the API before first run can serve, so only the dynamic import behind normal() may reach it.
describe("main.ts's first-run import graph", () => {
  const graph = importGraph(MAIN, { dynamic: false })

  test("loads no database or auth code, nor the db env", () => {
    expect(graph.packages.filter((name) => DATABASE_OR_AUTH_PACKAGES.includes(name))).toEqual([])
    expect(graph.files.filter((file) => DATABASE_OR_AUTH_FILES.test(file))).toEqual([])
  })

  test("reaches first run's routes through the walk", () => {
    expect(graph.files).toContain("lib/setup/app.ts")
    expect(graph.files).toContain("lib/onboard/checks.ts")
    expect(graph.files).toContain("packages/env/src/api-hono.ts")
  })

  test("the normal app's dynamic import holds them, so the walk sees what it checks", () => {
    const whole = importGraph(MAIN)
    expect(whole.packages).toContain("@packages/db")
    expect(whole.files).toContain("packages/env/src/db.ts")
  })
})
