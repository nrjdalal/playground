// A worker's touched tests, run green, mark its head: `<session>` runs code-review-loop's touched-tests list for HEAD against origin/canary through run-slot and, only when every file passes, writes HEAD's sha to `touched-green` in this worktree's git dir; `--push`, lefthook's pre-push job, reads that mark alone and refuses a push of a PG- branch whose pushed sha it does not name.

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

export const MARK = "touched-green"
const BASE = "origin/canary"
const ZERO = /^0+$/
const PG = /^refs\/heads\/pg-\d/i
const COMMAND = "bun packages/scripts/src/touched-green.ts <your session name>"

// The refusal for git's pre-push lines (`<local ref> <local sha> <remote ref> <remote sha>`), null when every pushed PG- branch's sha is the mark's; a delete and any other branch read nothing.
export const pushRefusal = (stdin: string, mark: string | null): string | null => {
  const marked = mark?.trim()
  for (const line of stdin.split("\n")) {
    const [, local, remoteRef] = line.trim().split(/\s+/)
    if (!local || ZERO.test(local) || !remoteRef || !PG.test(remoteRef)) continue
    if (local !== marked)
      return `${remoteRef.slice("refs/heads/".length)} at ${local.slice(0, 7)} has no green run of its touched tests; run ${COMMAND} in this worktree, then push again`
  }
  return null
}

export type MarkIo = {
  dirty: () => boolean
  gitDir: () => string
  head: () => string
  tests: (files: string[]) => number
  touched: (head: string) => string[]
}

// Runs the head's touched tests and marks the head on a fully green run, its exit code; a tree with uncommitted edits runs nothing, since its run would not be the head's.
export const markGreen = (io: MarkIo): number => {
  if (io.dirty()) {
    console.error("touched-green: commit your edits first, so the run is the head's")
    return 1
  }
  const head = io.head()
  const files = io.touched(head)
  const code = files.length ? io.tests(files) : 0
  if (code !== 0) {
    console.error(`touched-green: a touched test is red at ${head.slice(0, 7)}; no mark written`)
    return code
  }
  writeFileSync(join(io.gitDir(), MARK), `${head}\n`)
  console.log(`touched-green: ${files.length} touched tests green at ${head.slice(0, 7)}; marked`)
  return 0
}

const git = (...args: string[]): string => {
  const out = Bun.spawnSync(["git", ...args], { stderr: "inherit" })
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed`)
  return out.stdout.toString().trim()
}

const gitDir = (): string => resolve(git("rev-parse", "--git-dir"))

if (import.meta.main) {
  const arg = process.argv[2]
  if (arg === "--push") {
    const stdin = await Bun.stdin.text()
    const path = join(gitDir(), MARK)
    const refusal = pushRefusal(stdin, existsSync(path) ? readFileSync(path, "utf8") : null)
    if (refusal) {
      console.error(`touched-green: ${refusal}`)
      process.exit(1)
    }
  } else if (arg && !arg.startsWith("-")) {
    const top = git("rev-parse", "--show-toplevel")
    const state = join(top, "extensions/core/skills/code-review-loop/scripts/state.ts")
    process.exitCode = markGreen({
      dirty: () => git("-C", top, "status", "--porcelain", "--untracked-files=no") !== "",
      gitDir,
      head: () => git("-C", top, "rev-parse", "HEAD"),
      tests: (files) =>
        Bun.spawnSync(
          [
            join(homedir(), ".playground/ops/run-slot.sh"),
            arg,
            "--",
            "bun",
            "run",
            "--cwd",
            top,
            "test:file",
            ...files,
          ],
          { stdout: "inherit", stderr: "inherit" },
        ).exitCode ?? 1,
      touched: (head) => {
        const out = Bun.spawnSync(["bun", state, "touched-tests", top, BASE, head], {
          stderr: "inherit",
        })
        if (out.exitCode !== 0) throw new Error("touched-tests failed, so no list to run")
        return out.stdout.toString().split("\n").filter(Boolean)
      },
    })
  } else {
    console.error(`usage: ${COMMAND}, or --push as lefthook's pre-push job`)
    process.exit(2)
  }
}
