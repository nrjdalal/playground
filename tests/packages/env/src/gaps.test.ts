import { afterAll, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { GapsRead } from "../../../../packages/env/src/gaps"

const ROOT = join(import.meta.dir, "../../../..")
const { readEnvGaps } = (await import(join(ROOT, "packages/env/dist/gaps.mjs"))) as {
  readEnvGaps: (cwd: string, env: Record<string, string>) => GapsRead
}
const dir = mkdtempSync(join(tmpdir(), "env-gaps-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

// A checkout of its own holding the repo's .env.example and, when given, a .env, read from api/hono as env-keys reads it.
const read = (name: string, env?: string) => {
  const root = join(dir, name)
  mkdirSync(join(root, "api/hono"), { recursive: true })
  copyFileSync(join(ROOT, ".env.example"), join(root, ".env.example"))
  if (env !== undefined) writeFileSync(join(root, ".env"), env)
  const gaps = readEnvGaps(join(root, "api/hono"), { PATH: process.env.PATH ?? "" })
  if (!gaps.ok) throw new Error(gaps.error)
  return gaps
}

test("a checkout with no .env is told to copy .env.example, its keys named after", () => {
  const { refusal } = read("none")
  expect(refusal).toStartWith(
    "no .env in this checkout: copy .env.example to .env, then fill the keys still empty: ",
  )
  expect(refusal).toContain("BETTER_AUTH_SECRET")
  expect(refusal).not.toContain("HONO_APP_URL")
  expect(refusal).not.toContain("\n")
})

test("with no .env, the keys named are the ones a copy of .env.example leaves to fill", async () => {
  const { absent, refusal } = read("bare")
  const copied = read("copied", await Bun.file(join(ROOT, ".env.example")).text())
  const left = [...copied.missing, ...copied.empty].sort()
  expect(left.length).toBeGreaterThan(0)
  expect(absent?.fill.toSorted()).toEqual(left)
  expect(refusal).toEndWith(`: ${absent!.fill.join(", ")}`)
})

test("a .env that lacks keys keeps the refusal that names them", () => {
  const { empty, missing, refusal } = read("short", "NODE_ENV=development\nBETTER_AUTH_SECRET=\n")
  expect(missing.length).toBeGreaterThan(0)
  expect(empty.map((key) => key.split(" ")[0])).toEqual(["BETTER_AUTH_SECRET"])
  expect(refusal).toBe(
    `the .env lacks keys the apps require: ${missing.join(", ")}; left empty: ${empty.join(", ")}; fill each from .env.example`,
  )
})
