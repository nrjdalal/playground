import { describe, expect, test } from "bun:test"
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BUNDLED, HOOKS, ROOT } from "../../../../packages/scripts/src/hooks-bundle"
import { lostLines } from "../../../../packages/scripts/src/pr-merge/lost"
import type { Run } from "../../../../packages/scripts/src/pr-merge/merge"

const env = {
  ...process.env,
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_AUTHOR_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
}
const SOURCES = [
  "hooks-bundle.ts",
  "hooks-merge-canary.ts",
  "ops-tick/guard-probe.ts",
  "write-atomic.ts",
]
const guard = (one: string, two: string) =>
  `const one = "${one}"\n${"// a line between\n".repeat(8)}const two = "${two}"\nconsole.log(one, two)\n`

// An origin whose canary holds hooks-bundle's and hooks-merge-canary's own source, one guard and its committed bundle, and a clone of it on a PR branch; each script runs in a checkout as it does in the repo, its ROOT that checkout.
function world() {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "hooks-merge-canary-")))
  const origin = join(scratch, "origin")
  const work = join(scratch, "work")
  const git = (repo: string, ...args: string[]) => {
    const proc = Bun.spawnSync(["git", "-C", repo, ...args], { env })
    if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr}`)
    return proc.stdout.toString().trim()
  }
  const script = (repo: string, name: string, ...args: string[]) => {
    const proc = Bun.spawnSync(
      ["bun", "--no-env-file", join(repo, "packages", "scripts", "src", name), ...args],
      { cwd: repo, env },
    )
    return { code: proc.exitCode, stderr: proc.stderr.toString(), stdout: proc.stdout.toString() }
  }
  // Each side's change to the guard, committed with its rebuilt bundle, as a hook PR and canary each hold one.
  const change = (repo: string, one: string, two: string, message: string) => {
    writeFileSync(join(repo, HOOKS, "a-guard.ts"), guard(one, two))
    expect(script(repo, "hooks-bundle.ts").code).toBe(0)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "--no-verify", "-m", message)
  }
  mkdirSync(join(origin, HOOKS), { recursive: true })
  for (const file of SOURCES) {
    const to = join(origin, "packages", "scripts", "src", file)
    mkdirSync(join(to, ".."), { recursive: true })
    copyFileSync(join(ROOT, "packages", "scripts", "src", file), to)
  }
  writeFileSync(
    join(origin, "scripts", "factory-settings.json"),
    `${JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: "bun scripts/hooks/bundled/a-guard.js" }] }] } })}\n`,
  )
  writeFileSync(join(origin, HOOKS, "no-extensions-write-worker.ts"), "export {}\n")
  writeFileSync(join(origin, "bun.lock"), "{}\n")
  git(origin, "init", "-q", "-b", "canary")
  change(origin, "base", "base", "start")
  Bun.spawnSync(["git", "clone", "-q", origin, work], { env })
  git(work, "checkout", "-q", "-b", "PG-1-hook")
  const run: Run = async (args) => {
    const proc = Bun.spawnSync(["git", "-C", work, ...args], { env })
    return { code: proc.exitCode, stderr: proc.stderr.toString(), stdout: proc.stdout.toString() }
  }
  return { change, git, origin, run, script, work }
}

describe("hooks:merge-canary (#694)", () => {
  test("a conflict only in the bundles ends in two commits, the merge and the rebuild, with fresh bundles and nothing keeps-canary reads as lost", async () => {
    const { change, git, origin, run, script, work } = world()
    change(origin, "canary", "base", "canary's change")
    change(work, "base", "branch", "the PR's change")
    const before = git(work, "rev-parse", "HEAD")
    const merged = script(work, "hooks-merge-canary.ts")
    expect(merged.code).toBe(0)
    expect(merged.stdout).toContain("committed the rebuilt bundles")
    expect(git(work, "rev-list", "--count", `${before}..HEAD`, "^origin/canary")).toBe("2")
    expect(git(work, "rev-list", "--parents", "-n1", "HEAD^").split(" ")).toHaveLength(3)
    expect(git(work, "rev-list", "--parents", "-n1", "HEAD").split(" ")).toHaveLength(2)
    expect(git(work, "show", "-s", "--format=%s", "HEAD")).toBe(
      "chore(hooks): rebuild the bundles on the merged canary",
    )
    expect(git(work, "status", "--porcelain")).toBe("")
    expect(script(work, "hooks-bundle.ts", "--check")).toMatchObject({ code: 0, stderr: "" })
    const bundled = readFileSync(join(work, BUNDLED, "a-guard.js"), "utf8")
    expect(bundled).toContain("canary")
    expect(bundled).toContain("branch")
    const tree = git(work, "merge-tree", "--write-tree", "origin/canary", "HEAD").split("\n")[0]!
    expect(await lostLines(run, "origin/canary", "HEAD", tree)).toEqual([])
  })

  test("a conflict in a guard's source aborts the merge, commits nothing and names the path", () => {
    const { change, git, origin, script, work } = world()
    change(origin, "canary", "base", "canary's change")
    change(work, "branch", "base", "the PR's change")
    const before = git(work, "rev-parse", "HEAD")
    const merged = script(work, "hooks-merge-canary.ts")
    expect(merged.code).toBe(1)
    expect(merged.stderr).toContain(`conflicts outside ${BUNDLED}`)
    expect(merged.stderr).toContain(join(HOOKS, "a-guard.ts"))
    expect(git(work, "rev-parse", "HEAD")).toBe(before)
    expect(
      Bun.spawnSync(["git", "-C", work, "rev-parse", "-q", "--verify", "MERGE_HEAD"]).exitCode,
    ).toBe(1)
    expect(git(work, "status", "--porcelain")).toBe("")
  })

  test("a merge that changes bun.lock is committed, and the rebuild waits for an install", () => {
    const { change, git, origin, script, work } = world()
    change(work, "base", "branch", "the PR's change")
    writeFileSync(join(origin, "bun.lock"), '{"zod":"4"}\n')
    git(origin, "commit", "-q", "-am", "canary's lockfile")
    const merged = script(work, "hooks-merge-canary.ts")
    expect(merged.code).toBe(1)
    expect(merged.stderr).toContain(
      "changed bun.lock: run `bun install`, then `bun run hooks:bundle`",
    )
    expect(git(work, "rev-list", "--parents", "-n1", "HEAD").split(" ")).toHaveLength(3)
    expect(git(work, "status", "--porcelain")).toBe("")
  })

  test("uncommitted changes stop it before it fetches", () => {
    const { git, script, work } = world()
    writeFileSync(join(work, HOOKS, "a-guard.ts"), guard("edited", "base"))
    const before = git(work, "rev-parse", "HEAD")
    const merged = script(work, "hooks-merge-canary.ts")
    expect(merged.code).toBe(1)
    expect(merged.stderr).toContain("commit or set aside your changes first")
    expect(git(work, "rev-parse", "HEAD")).toBe(before)
  })
})
