import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// A user install's clone root, a git repo whose Dashboard's checkout is the worktree on live.branch, holding the .env, and a stand-in ask there that prints what it reached, so no database is touched.
const CLI = join(import.meta.dir, "../../../../../api/hono/src/bin/dashboard-ask.ts")
const URL = "postgresql://postgres:stub@127.0.0.1:1/dashboard"
const scratch = mkdtempSync(join(tmpdir(), "playground-ask-root-"))
const data = join(scratch, "data")
mkdirSync(data)
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(
    ["git", "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { cwd, stderr: "pipe", stdout: "pipe" },
  )
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
}

const clone = (name: string) => {
  const root = join(scratch, name)
  mkdirSync(root)
  git(root, "init", "-q", "-b", "canary")
  git(root, "commit", "-q", "--allow-empty", "-m", "init")
  return root
}

const checkout = (root: string, path: string, branch: string) => {
  git(root, "worktree", "add", "-q", "-b", branch, path)
  writeFileSync(join(path, ".env"), `POSTGRES_URL=${URL}\n`)
  writeFileSync(
    join(path, "package.json"),
    JSON.stringify({ scripts: { ask: `${process.execPath} reached.ts` } }),
  )
  writeFileSync(
    join(path, "reached.ts"),
    'console.log(`reached ${process.env.POSTGRES_URL} ${process.argv.slice(2).join(" ")}`)\n',
  )
  return path
}

// The live checkout sits outside .claude/worktrees/desk, where a fresh install would first cut it.
const live = clone("live")
checkout(live, join(scratch, "dashboard-elsewhere"), "live/dashboard")
const worker = join(live, ".claude", "worktrees", "worker")
git(live, "worktree", "add", "-q", "-b", "worker", worker)

// A desk folder on another branch, so no worktree is on live.branch.
const unset = clone("unset")
checkout(unset, join(unset, ".claude", "worktrees", "desk"), "not-live")

const ask = (cwd: string, env: Record<string, string | undefined>, ...args: string[]) => {
  const { POSTGRES_URL: _, ...rest } = process.env
  return Bun.spawnSync([process.execPath, CLI, ...args], {
    cwd,
    env: { ...rest, PLAYGROUND_DATA_DIR: data, ...env },
    stderr: "pipe",
    stdout: "pipe",
  })
}

const stays = (run: ReturnType<typeof ask>) => {
  expect(run.stdout.toString()).not.toContain("reached")
  expect(run.stderr.toString()).toContain("usage: bun run ask")
  expect(run.exitCode).toBe(2)
}

test("from the clone root with no POSTGRES_URL, ask runs as the checkout on live.branch's, on its .env, wherever it sits", () => {
  const run = ask(live, {}, "get", "#i1")
  expect(run.stdout.toString()).toBe(`reached ${URL} get #i1\n`)
  expect(run.exitCode).toBe(0)
})

test("with no worktree on live.branch, ask stays in the clone root, a desk folder on another branch included", () => {
  stays(ask(unset, {}))
})

test("from a worktree other than the clone root, ask stays in it", () => {
  stays(ask(worker, {}))
})

test("a POSTGRES_URL already set keeps ask in the checkout it runs from", () => {
  stays(ask(live, { POSTGRES_URL: "postgresql://postgres:own@127.0.0.1:2/own" }))
})
