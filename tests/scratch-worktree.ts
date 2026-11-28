import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(
    ["git", "-c", "user.name=Made Up", "-c", "user.email=made-up@example.invalid", ...args],
    { cwd, stderr: "pipe", stdin: "ignore" },
  )
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`)
}

// A scratch repo on main with one commit, and a linked worktree beside it on a made-up branch, as a Playground checkout and one of its .claude/worktrees; root is the folder holding both, for the test's own cleanup
export const scratchWorktree = (branch = "PG-1-made-up-hosts") => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "scratch-worktree-")))
  const main = join(root, "main")
  const linked = join(root, "linked")
  mkdirSync(main)
  git(main, "init", "-q", "-b", "main")
  git(main, "commit", "-q", "--allow-empty", "-m", "init")
  git(main, "worktree", "add", "-q", "-b", branch, linked)
  return { linked, main, root }
}
