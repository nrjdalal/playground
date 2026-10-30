import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const script = join(import.meta.dir, "..", "..", "..", ".github/scripts/ensure-remote-branches.ts")
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ensure-remote-branches-")))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// git with no user or system config and no GIT_* from the parent, so a developer's git setup changes nothing here
const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].startsWith("GIT_"),
    ),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
}

const git = (cwd: string, ...args: string[]) =>
  Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    env: ENV,
    stderr: "pipe",
    stdout: "pipe",
  })
    .stdout.toString()
    .trim()

const work = join(scratch, "work")

// A bare repo under a github.com path, so the hook's slug reads it as a GitHub remote, holding work's canary when asked.
const bare = (slug: string, withCanary: boolean) => {
  const dir = join(scratch, "github.com", `${slug}.git`)
  mkdirSync(dir, { recursive: true })
  git(dir, "init", "-q", "--bare")
  if (withCanary) git(work, "push", "-q", dir, "HEAD:refs/heads/canary")
  return dir
}

// A repo on main with one empty commit, the checkout the hook runs in.
const checkout = (dir: string) => {
  mkdirSync(dir)
  git(dir, "init", "-q", "-b", "main")
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "c0")
}

checkout(work)
const app = bare("acme/app", true)
git(work, "remote", "add", "origin", app)
const other = bare("acme/other", true)
git(work, "remote", "add", "second", other)
// fetches from origin's repo and pushes to another
git(work, "remote", "add", "third", app)
git(work, "remote", "set-url", "--push", "third", other)
// fetches from origin's repo and pushes to it and to another, as git push does with two pushurls
git(work, "remote", "add", "fourth", app)
git(work, "remote", "set-url", "--add", "--push", "fourth", app)
git(work, "remote", "set-url", "--add", "--push", "fourth", other)

const hook = (remote: string, cwd = work) => {
  const proc = Bun.spawnSync(["bun", script, remote], {
    cwd,
    env: ENV,
    stderr: "pipe",
    stdout: "pipe",
  })
  return { code: proc.exitCode, err: proc.stderr.toString() }
}

describe("the pre-push hook's release-branch seeding", () => {
  test("leaves main off a second GitHub remote that has canary, and says so", () => {
    const { code, err } = hook("second")
    expect(code).toBe(0)
    expect(git(work, "ls-remote", "--heads", "second", "main")).toBe("")
    expect(err.trim().split("\n")).toEqual([
      "zerostarter: second is not origin's repo (acme/app), so its branches stay as they are",
    ])
  })

  test("leaves main off a remote that fetches from origin's repo but pushes to another", () => {
    const { code, err } = hook("third")
    expect(code).toBe(0)
    expect(git(work, "ls-remote", "--heads", other, "main")).toBe("")
    expect(err.trim().split("\n")).toEqual([
      "zerostarter: third is not origin's repo (acme/app), so its branches stay as they are",
    ])
  })

  test("leaves main off a remote with two push URLs, one of them another repo", () => {
    const { code, err } = hook("fourth")
    expect(code).toBe(0)
    expect(git(work, "ls-remote", "--heads", other, "main")).toBe("")
    expect(err.trim().split("\n")).toEqual([
      "zerostarter: fourth is not origin's repo (acme/app), so its branches stay as they are",
    ])
  })

  test("on a fork's first push, with no canary on origin yet, says so and how to let Actions write", () => {
    const fresh = join(scratch, "fresh")
    checkout(fresh)
    git(fresh, "remote", "add", "origin", bare("acme/fresh", false))
    const { code, err } = hook("origin", fresh)
    expect(code).toBe(0)
    expect(err).toContain("zerostarter: publishing canary")
    expect(err).toContain("https://github.com/acme/fresh/settings/actions")
  })

  test("seeds main on origin once origin has canary", () => {
    expect(hook("origin").code).toBe(0)
    expect(git(work, "ls-remote", "--heads", "origin", "main")).not.toBe("")
  })
})
