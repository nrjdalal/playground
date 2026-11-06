import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Run } from "../../../../../packages/scripts/src/pr-merge/merge"
import { prePushRefusal } from "../../../../../packages/scripts/src/pr-merge/prepush"

const env = {
  ...process.env,
  GIT_AUTHOR_EMAIL: "acct-t",
  GIT_AUTHOR_NAME: "t",
  GIT_COMMITTER_EMAIL: "acct-t",
  GIT_COMMITTER_NAME: "t",
}

const ZERO = "0".repeat(40)
const repos: string[] = []
afterAll(() => {
  for (const repo of repos) rmSync(repo, { force: true, recursive: true })
})

// A scratch clone: origin/canary adds a line to a.ts after the PR branched, and the PR merges it in; each git call the hook makes is recorded.
function world() {
  const repo = mkdtempSync(join(tmpdir(), "prepush-"))
  repos.push(repo)
  const git = (...args: string[]) => {
    const proc = Bun.spawnSync(["git", "-C", repo, ...args], { env })
    if (proc.exitCode !== 0) throw new Error(proc.stderr.toString())
    return proc.stdout.toString().trim()
  }
  const calls: string[][] = []
  const run: Run = async (args) => {
    calls.push(args)
    const proc = Bun.spawnSync(["git", "-C", repo, ...args], { env })
    return { code: proc.exitCode, stderr: proc.stderr.toString(), stdout: proc.stdout.toString() }
  }
  const write = (file: string, text: string) => writeFileSync(join(repo, file), text)
  const commit = (message: string) => {
    git("add", "-A")
    git("commit", "--quiet", "--no-verify", "-m", message)
    return git("rev-parse", "HEAD")
  }
  git("init", "--quiet", "--initial-branch=canary")
  write("a.ts", "export const a = 1\nexport const b = 2\n")
  commit("base")
  git("checkout", "--quiet", "-b", "pr")
  write("pr.ts", "export const pr = true\n")
  commit("pr: its own file")
  git("checkout", "--quiet", "canary")
  write("a.ts", "export const a = 1\nexport const b = 2\nexport const canaryAdded = 3\n")
  commit("canary: a new line")
  git("update-ref", "refs/remotes/origin/canary", "canary")
  git("checkout", "--quiet", "pr")
  const stdin = (local: string, remote = ZERO) => `refs/heads/pr ${local} refs/heads/pr ${remote}\n`
  return { calls, commit, git, run, stdin, write }
}

describe("prePushRefusal", () => {
  test("a push whose canary merge dropped a line git merged clean is refused, naming the file and the merge", async () => {
    const w = world()
    w.git("merge", "--quiet", "--no-commit", "origin/canary")
    w.write("a.ts", "export const a = 1\nexport const b = 2\n")
    const merge = w.commit("Merge canary, dropping its line")
    const refusal = await prePushRefusal(w.run, w.stdin(merge))
    expect(refusal).toContain(`a.ts (dropped in ${merge.slice(0, 7)})`)
    expect(refusal).toContain("redo that merge plainly")
  })

  test("a plain merge of canary passes, its tree git's own merge of its parents", async () => {
    const w = world()
    w.git("merge", "--quiet", "--no-edit", "origin/canary")
    const merge = w.git("rev-parse", "HEAD")
    expect(w.git("rev-parse", `${merge}^{tree}`)).toBe(
      w.git("merge-tree", "--write-tree", `${merge}^1`, `${merge}^2`),
    )
    expect(await prePushRefusal(w.run, w.stdin(merge))).toBeNull()
  })

  test("a push with no canary merge in its range reads nothing past the range", async () => {
    const w = world()
    const head = w.git("rev-parse", "HEAD")
    expect(await prePushRefusal(w.run, w.stdin(head))).toBeNull()
    expect(w.calls.map((args) => args[0])).toEqual(["rev-parse", "rev-list"])
  })

  test("a merge the remote already holds is not read again", async () => {
    const w = world()
    w.git("merge", "--quiet", "--no-commit", "origin/canary")
    w.write("a.ts", "export const a = 1\nexport const b = 2\n")
    const merge = w.commit("Merge canary, dropping its line")
    w.write("pr.ts", "export const pr = 2\n")
    const after = w.commit("pr: a commit after the merge")
    expect(await prePushRefusal(w.run, w.stdin(after, merge))).toBeNull()
    expect(w.calls.some((args) => args[0] === "merge-tree")).toBe(false)
  })

  test("a head that conflicts with canary passes, since the merge gate reports the conflict", async () => {
    const w = world()
    w.git("merge", "--quiet", "--no-commit", "origin/canary")
    w.write("a.ts", "export const a = 1\nexport const b = 2\n")
    const merge = w.commit("Merge canary, dropping its line")
    w.git("checkout", "--quiet", "canary")
    w.write("pr.ts", "export const pr = false\n")
    w.commit("canary: a pr.ts of its own")
    w.git("update-ref", "refs/remotes/origin/canary", "canary")
    expect(await prePushRefusal(w.run, w.stdin(merge))).toBeNull()
  })

  test("a branch delete and a clone with no origin/canary pass", async () => {
    const w = world()
    expect(await prePushRefusal(w.run, `(delete) ${ZERO} refs/heads/pr ${ZERO}\n`)).toBeNull()
    w.git("update-ref", "-d", "refs/remotes/origin/canary")
    const head = w.git("rev-parse", "HEAD")
    expect(await prePushRefusal(w.run, w.stdin(head))).toBeNull()
  })
})
