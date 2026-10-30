import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// A user install's clone root, with the Dashboard's checkout under it holding the .env, and a stand-in ask there that prints what it reached, so no database is touched.
const CLI = join(import.meta.dir, "../../../../../api/hono/src/bin/dashboard-ask.ts")
const URL = "postgresql://postgres:stub@127.0.0.1:1/dashboard"
const root = mkdtempSync(join(tmpdir(), "playground-ask-root-"))
const desk = join(root, ".claude", "worktrees", "desk")
mkdirSync(desk, { recursive: true })
writeFileSync(join(desk, ".env"), `POSTGRES_URL=${URL}\n`)
writeFileSync(
  join(desk, "package.json"),
  JSON.stringify({ scripts: { ask: `${process.execPath} reached.ts` } }),
)
writeFileSync(
  join(desk, "reached.ts"),
  'console.log(`reached ${process.env.POSTGRES_URL} ${process.argv.slice(2).join(" ")}`)\n',
)
afterAll(() => rmSync(root, { force: true, recursive: true }))

const ask = (env: Record<string, string | undefined>, ...args: string[]) => {
  const { POSTGRES_URL: _, ...rest } = process.env
  return Bun.spawnSync([process.execPath, CLI, ...args], {
    cwd: root,
    env: { ...rest, ...env },
    stderr: "pipe",
    stdout: "pipe",
  })
}

test("from the clone root with no POSTGRES_URL, ask runs as the Dashboard's checkout's, on its .env", () => {
  const run = ask({}, "get", "#i1")
  expect(run.stdout.toString()).toBe(`reached ${URL} get #i1\n`)
  expect(run.exitCode).toBe(0)
})

test("a POSTGRES_URL already set keeps ask in the checkout it runs from", () => {
  const run = ask({ POSTGRES_URL: "postgresql://postgres:own@127.0.0.1:2/own" })
  expect(run.stdout.toString()).not.toContain("reached")
  expect(run.stderr.toString()).toContain("usage: bun run ask")
  expect(run.exitCode).toBe(2)
})
