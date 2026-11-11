import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const scratch = mkdtempSync(join(tmpdir(), "check-types-env-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// A copy of the committed tree with no .env, which is the state a fresh worktree with no stack starts in: git archive holds exactly the committed files, the installed dependencies and the worktree's cache are linked in, so the run replays what is warm and builds the rest.
const copy = (): string => {
  const at = join(scratch, "repo")
  mkdirSync(at)
  const tar = join(scratch, "head.tar")
  const archived = Bun.spawnSync(["git", "-C", root, "archive", "-o", tar, "HEAD"])
  if (archived.exitCode !== 0) throw new Error(archived.stderr.toString())
  const untarred = Bun.spawnSync(["tar", "-xf", tar, "-C", at])
  if (untarred.exitCode !== 0) throw new Error(untarred.stderr.toString())
  symlinkSync(join(root, "node_modules"), join(at, "node_modules"))
  if (existsSync(join(root, ".turbo"))) symlinkSync(join(root, ".turbo"), join(at, ".turbo"))
  return at
}

test("bun run check-types runs in a copy with no .env", () => {
  const at = copy()
  // the copy holds no .env, and the run carries no flag or NODE_ENV of its own: the script must set what it needs
  const env = { ...process.env }
  delete env.SKIP_ENV_VALIDATION
  delete env.SKIP_ENV_VALIDATION_SERVER
  delete env.NODE_ENV
  const run = Bun.spawnSync(["bun", "run", "check-types"], {
    cwd: at,
    env,
    stdout: "pipe",
    stderr: "pipe",
  })
  if (run.exitCode !== 0) console.error(run.stderr.toString().slice(-4000))
  expect(run.exitCode).toBe(0)
})
