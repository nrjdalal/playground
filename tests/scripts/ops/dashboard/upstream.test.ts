import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..", "..", "..")
const UPSTREAM = join(root, "scripts", "ops", "dashboard", "upstream.sh")
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "dashboard-upstream-")))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(
    ["git", "-c", "core.hooksPath=/dev/null", "-c", "user.name=t", "-c", "user.email=t@t", ...args],
    { cwd, stderr: "pipe", stdout: "pipe" },
  )

// A main checkout on the given branch, with the dashboard's checkout as its worktree on live/dashboard, as install.sh and the first start leave them; upstream.sh's answer from inside the worktree
const upstreamFrom = (branch: string) => {
  const repo = join(scratch, branch)
  git(scratch, "init", "-q", "-b", branch, repo)
  git(repo, "commit", "-q", "--allow-empty", "-m", "seed")
  const desk = join(repo, ".claude", "worktrees", "desk")
  git(repo, "worktree", "add", "-q", "-b", "live/dashboard", desk)
  const run = Bun.spawnSync(["bash", UPSTREAM], { cwd: desk, stdout: "pipe" })
  return { code: run.exitCode, out: run.stdout.toString().trim() }
}

describe("the branch the live dashboard rolls to", () => {
  test("is main for a main checkout on main, as an install leaves it", () => {
    expect(upstreamFrom("main")).toEqual({ code: 0, out: "main" })
  })

  test("is canary only where the main checkout sits on canary", () => {
    expect(upstreamFrom("canary")).toEqual({ code: 0, out: "canary" })
  })

  test("is main for a main checkout on any other branch", () => {
    expect(upstreamFrom("feature")).toEqual({ code: 0, out: "main" })
  })
})
