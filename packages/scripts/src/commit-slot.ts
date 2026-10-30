import { accessSync, constants } from "node:fs"
import { homedir } from "node:os"

// Runs one pre-commit step through the machine's run slot, `~/.playground/ops/run-slot.sh commit-<worktree> -- <step>`, when the commit is in a worktree under `.claude/worktrees/` and that script is executable, so a commit's build waits its turn beside every other heavy run; anywhere else, or in a commit already running under run-slot (whose child carries the `RUN_SLOT_NICE` it exports), it runs the step bare, so a commit never waits on a slot it holds.

const WORKTREE = /\/\.claude\/worktrees\/([^/]+)/

export const slotted = ({
  argv,
  cwd,
  env,
  executable,
  home,
}: {
  argv: string[]
  cwd: string
  env: Record<string, string | undefined>
  executable: (path: string) => boolean
  home: string
}): string[] => {
  const folder = WORKTREE.exec(cwd)?.[1]
  const runSlot = `${home}/.playground/ops/run-slot.sh`
  if (!folder || env.RUN_SLOT_NICE !== undefined || !executable(runSlot)) return argv
  return [runSlot, `commit-${folder.replace(/[^A-Za-z0-9._#-]/g, "-")}`, "--", ...argv]
}

if (import.meta.main) {
  const argv = slotted({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    env: process.env,
    executable: (path) => {
      try {
        accessSync(path, constants.X_OK)
        return true
      } catch {
        return false
      }
    },
    home: process.env.HOME || homedir(),
  })
  const child = Bun.spawn(argv, { stdio: ["inherit", "inherit", "inherit"] })
  process.exit(await child.exited)
}
