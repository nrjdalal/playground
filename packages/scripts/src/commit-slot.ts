import { accessSync, constants } from "node:fs"
import { homedir } from "node:os"

// Runs the pre-commit build through the machine's run slot, `~/.playground/ops/run-slot.sh commit-<worktree> -- <step>`, when the commit is in a worktree under `.claude/worktrees/`, that script is executable and turbo's dry run finds a build task with work to do, so a real build waits its turn beside every other heavy run; it runs the step bare anywhere else, in a commit already running under run-slot (whose child carries the `RUN_SLOT_NICE` it exports), so a commit never waits on a slot it holds, and when turbo can replay every build task from its cache, since a replay ran 2 s or less after waits of up to 1,297 s (2 Nov, run-slot.runs.log).

const WORKTREE = /\/\.claude\/worktrees\/([^/]+)/

const DRY_RUN = ["bun", "run", "turbo", "run", "build", "--dry=json"]

export const replays = (dry: string): boolean => {
  try {
    const tasks = (
      JSON.parse(dry).tasks as { cache?: { status?: string }; command?: string }[]
    ).filter((task) => task.command !== "<NONEXISTENT>")
    return tasks.length > 0 && tasks.every((task) => task.cache?.status === "HIT")
  } catch {
    return false
  }
}

export const slotted = ({
  argv,
  cached,
  cwd,
  env,
  executable,
  home,
}: {
  argv: string[]
  cached: () => boolean
  cwd: string
  env: Record<string, string | undefined>
  executable: (path: string) => boolean
  home: string
}): string[] => {
  const folder = WORKTREE.exec(cwd)?.[1]
  const runSlot = `${home}/.playground/ops/run-slot.sh`
  if (!folder || env.RUN_SLOT_NICE !== undefined || !executable(runSlot) || cached()) return argv
  return [runSlot, `commit-${folder.replace(/[^A-Za-z0-9._#-]/g, "-")}`, "--", ...argv]
}

if (import.meta.main) {
  const argv = slotted({
    argv: process.argv.slice(2),
    cached: () => {
      const dry = Bun.spawnSync(DRY_RUN, { stderr: "ignore", stdout: "pipe", timeout: 10_000 })
      return dry.exitCode === 0 && replays(dry.stdout.toString())
    },
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
