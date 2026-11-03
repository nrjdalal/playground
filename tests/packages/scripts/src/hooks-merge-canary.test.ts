import { describe, expect, test } from "bun:test"
import {
  copyFileSync,
  existsSync,
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
const SRC = join("packages", "scripts", "src")
const SOURCES = [
  "hooks-bundle.ts",
  "hooks-merge-canary.ts",
  "ops-tick/guard-probe.ts",
  "write-atomic.ts",
]
const guard = (one: string, two: string) =>
  `const one = "${one}"\n${"// a line between\n".repeat(8)}const two = "${two}"\nconsole.log(one, two)\n`
const settings = (guards: string[]) =>
  `${JSON.stringify({ hooks: { PreToolUse: guards.map((g) => ({ hooks: [{ command: `bun scripts/hooks/bundled/${g}.js` }] })) } })}\n`

// An origin whose canary holds hooks-bundle's and hooks-merge-canary's own source and two guards with their committed bundles, b-guard importing shared.ts, and a clone of it on a PR branch; each script runs in a checkout as it does in the repo, its ROOT that checkout.
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
    const proc = Bun.spawnSync(["bun", "--no-env-file", join(repo, SRC, name), ...args], {
      cwd: repo,
      env,
    })
    return { code: proc.exitCode, stderr: proc.stderr.toString(), stdout: proc.stdout.toString() }
  }
  const write = (repo: string, path: string, text: string) => writeFileSync(join(repo, path), text)
  // A change committed with the bundles hooks:bundle rebuilds from it, as a hook PR and canary each hold one.
  const commit = (repo: string, message: string) => {
    expect(script(repo, "hooks-bundle.ts").code).toBe(0)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "--no-verify", "-m", message)
  }
  mkdirSync(join(origin, HOOKS), { recursive: true })
  for (const file of SOURCES) {
    mkdirSync(join(origin, SRC, file, ".."), { recursive: true })
    copyFileSync(join(ROOT, SRC, file), join(origin, SRC, file))
  }
  write(origin, join("scripts", "factory-settings.json"), settings(["a-guard", "b-guard"]))
  write(origin, join(HOOKS, "a-guard.ts"), guard("base", "base"))
  write(origin, join(HOOKS, "b-guard.ts"), 'import { word } from "./shared"\nconsole.log(word)\n')
  write(origin, join(HOOKS, "shared.ts"), 'export const word = "base"\n')
  write(origin, join(HOOKS, "no-extensions-write-worker.ts"), "export {}\n")
  write(origin, "bun.lock", "{}\n")
  write(origin, "README.md", "readme\n")
  git(origin, "init", "-q", "-b", "canary")
  commit(origin, "start")
  Bun.spawnSync(["git", "clone", "-q", origin, work], { env })
  git(work, "checkout", "-q", "-b", "PG-1-hook")
  const run: Run = async (args) => {
    const proc = Bun.spawnSync(["git", "-C", work, ...args], { env })
    return { code: proc.exitCode, stderr: proc.stderr.toString(), stdout: proc.stdout.toString() }
  }
  const mergeCanary = () => script(work, "hooks-merge-canary.ts")
  const added = (before: string) =>
    Number(git(work, "rev-list", "--count", `${before}..HEAD`, "^origin/canary"))
  const parents = (rev: string) =>
    git(work, "rev-list", "--parents", "-n1", rev).split(" ").length - 1
  return { added, commit, git, mergeCanary, origin, parents, run, script, work, write }
}

describe("hooks:merge-canary (#694)", () => {
  test("a conflict only in the bundles ends in two commits, the merge and the rebuild, with fresh bundles and nothing keeps-canary reads as lost", async () => {
    const { added, commit, git, mergeCanary, origin, parents, run, script, work, write } = world()
    write(origin, join(HOOKS, "a-guard.ts"), guard("canary", "base"))
    // b-guard's bundle changes on canary alone, so it merges without a conflict, where keeps-canary reads a dropped line.
    write(origin, join(HOOKS, "shared.ts"), 'export const word = "canary"\n')
    commit(origin, "canary's change")
    write(work, join(HOOKS, "a-guard.ts"), guard("base", "branch"))
    commit(work, "the PR's change")
    const before = git(work, "rev-parse", "HEAD")
    const merged = mergeCanary()
    expect(merged.code).toBe(0)
    expect(merged.stdout).toContain("committed the rebuilt bundles")
    expect(added(before)).toBe(2)
    expect([parents("HEAD^"), parents("HEAD")]).toEqual([2, 1])
    expect(git(work, "show", "-s", "--format=%s", "HEAD")).toBe(
      "chore(hooks): rebuild the bundles on the merged canary",
    )
    expect(git(work, "status", "--porcelain")).toBe("")
    expect(script(work, "hooks-bundle.ts", "--check")).toMatchObject({ code: 0, stderr: "" })
    const bundled = readFileSync(join(work, BUNDLED, "a-guard.js"), "utf8")
    expect(bundled).toContain("canary")
    expect(bundled).toContain("branch")
    expect(readFileSync(join(work, BUNDLED, "b-guard.js"), "utf8")).toContain("canary")
    const tree = git(work, "merge-tree", "--write-tree", "origin/canary", "HEAD").split("\n")[0]!
    expect(await lostLines(run, "origin/canary", "HEAD", tree)).toEqual([])
  })

  test("a conflict in a guard's source aborts the merge, commits nothing and names the path", () => {
    const { commit, git, mergeCanary, origin, work, write } = world()
    write(origin, join(HOOKS, "a-guard.ts"), guard("canary", "base"))
    commit(origin, "canary's change")
    write(work, join(HOOKS, "a-guard.ts"), guard("branch", "base"))
    commit(work, "the PR's change")
    const before = git(work, "rev-parse", "HEAD")
    const merged = mergeCanary()
    expect(merged.code).toBe(1)
    expect(merged.stderr).toContain(`conflicts outside ${BUNDLED}`)
    expect(merged.stderr).toContain(join(HOOKS, "a-guard.ts"))
    expect(git(work, "rev-parse", "HEAD")).toBe(before)
    expect(
      Bun.spawnSync(["git", "-C", work, "rev-parse", "-q", "--verify", "MERGE_HEAD"]).exitCode,
    ).toBe(1)
    expect(git(work, "status", "--porcelain")).toBe("")
  })

  test("a guard the PR removes, whose bundle canary changed, is gone after the rebuild", () => {
    const { added, commit, git, mergeCanary, origin, script, work, write } = world()
    write(origin, join(HOOKS, "shared.ts"), 'export const word = "canary"\n')
    commit(origin, "canary's change to b-guard's import")
    git(work, "rm", "-q", join(HOOKS, "b-guard.ts"))
    write(work, join("scripts", "factory-settings.json"), settings(["a-guard"]))
    commit(work, "the PR removes b-guard")
    const before = git(work, "rev-parse", "HEAD")
    const merged = mergeCanary()
    expect(merged).toMatchObject({ code: 0, stderr: "" })
    expect(added(before)).toBe(2)
    expect(existsSync(join(work, BUNDLED, "b-guard.js"))).toBe(false)
    expect(git(work, "status", "--porcelain")).toBe("")
    expect(script(work, "hooks-bundle.ts", "--check")).toMatchObject({ code: 0, stderr: "" })
  })

  test("the rebuild runs the merged hooks-bundle.ts, so canary's change to it reaches the bundles", () => {
    const { commit, git, mergeCanary, origin, script, work, write } = world()
    const own = join(origin, SRC, "hooks-bundle.ts")
    writeFileSync(
      own,
      readFileSync(own, "utf8").replace("'const __CHECKOUT", "'/* v2 */ const __CHECKOUT"),
    )
    commit(origin, "canary's change to hooks-bundle.ts")
    write(work, join(HOOKS, "a-guard.ts"), guard("base", "branch"))
    commit(work, "the PR's change")
    expect(mergeCanary()).toMatchObject({ code: 0, stderr: "" })
    const bundled = readFileSync(join(work, BUNDLED, "a-guard.js"), "utf8")
    expect(bundled).toContain("/* v2 */")
    expect(bundled).toContain("branch")
    expect(git(work, "status", "--porcelain")).toBe("")
    expect(script(work, "hooks-bundle.ts", "--check")).toMatchObject({ code: 0, stderr: "" })
  })

  test("bundles that already match the merged sources make no second commit", () => {
    const { added, git, mergeCanary, origin, parents, work, write } = world()
    write(origin, "README.md", "canary's readme\n")
    git(origin, "commit", "-q", "-am", "canary's readme")
    write(work, "notes.md", "the PR's note\n")
    git(work, "add", "-A")
    git(work, "commit", "-q", "-m", "the PR's note")
    const before = git(work, "rev-parse", "HEAD")
    const merged = mergeCanary()
    expect(merged.code).toBe(0)
    expect(merged.stdout).toContain("the bundles already match its sources")
    expect(added(before)).toBe(1)
    expect(parents("HEAD")).toBe(2)
  })

  test("a merge that changes bun.lock is committed, and the rebuild waits for an install", () => {
    const { commit, git, mergeCanary, origin, parents, work, write } = world()
    write(work, join(HOOKS, "a-guard.ts"), guard("base", "branch"))
    commit(work, "the PR's change")
    write(origin, "bun.lock", '{"zod":"4"}\n')
    git(origin, "commit", "-q", "-am", "canary's lockfile")
    const merged = mergeCanary()
    expect(merged.code).toBe(1)
    expect(merged.stderr).toContain(
      "changed bun.lock: run `bun install`, then `bun run hooks:bundle`",
    )
    expect(parents("HEAD")).toBe(2)
    expect(git(work, "status", "--porcelain")).toBe("")
  })

  test("uncommitted changes stop it before it fetches", () => {
    const { git, mergeCanary, origin, work, write } = world()
    write(origin, "README.md", "canary's readme\n")
    git(origin, "commit", "-q", "-am", "canary's readme")
    const fetched = git(work, "rev-parse", "origin/canary")
    write(work, join(HOOKS, "a-guard.ts"), guard("edited", "base"))
    const before = git(work, "rev-parse", "HEAD")
    const merged = mergeCanary()
    expect(merged.code).toBe(1)
    expect(merged.stderr).toContain("commit or set aside your changes first")
    expect(git(work, "rev-parse", "HEAD")).toBe(before)
    expect(git(work, "rev-parse", "origin/canary")).toBe(fetched)
  })
})
