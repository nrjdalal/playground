import { accessSync, constants } from "node:fs"
import { homedir } from "node:os"

import { unlinked } from "./playground/unlinked"

// Runs the pre-commit build through the machine's run slot, `~/.playground/ops/run-slot.sh commit-<worktree> -- <step>`, when the commit is in a worktree under `.claude/worktrees/`, that script is executable and turbo's dry run finds a build task with work to do, so a real build waits its turn beside every other heavy run, saying so on stderr (`queued`); it runs the step bare anywhere else, in a commit already running under run-slot (whose child carries the `RUN_SLOT_NICE` it exports), so a commit never waits on a slot it holds, and when turbo can replay every build task from its cache, since a replay ran 2 s or less after waits of up to 1,788 s (2 Nov, run-slot.runs.log).

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

// The line a build that joins run-slot's full queue prints, since that wait printed nothing (3 Nov: one plain commit waited 48 minutes before its session found the commit slot's form): the runs waiting there, `run-slot.sh room`'s last field, and that form
export const queued = (slot: string, room: string): string => {
  const waiting = /^\d+ \d+ \d+ (\d+)$/.exec(room.trim())?.[1]
  const count = waiting === undefined ? "" : `, ${waiting} run${waiting === "1" ? "" : "s"} waiting`
  return `commit-slot: this commit's build joins run-slot's full queue as ${slot}${count}; a commit through ~/.playground/ops/run-slot.sh <your name> -- git commit takes the commit slot instead, unless it stages web/next/, api/hono/ or packages/`
}

// Pure: why the step stops before it asks for a slot, or null: a workspace dependency no node_modules holds, which a canary merge that adds a package leaves until the worktree installs (PG-672: the build waited for a slot, then failed with exit 127, naming nothing).
export const unlinkedRefusal = (missing: string[], cwd: string): string | null =>
  missing.length === 0
    ? null
    : [
        "commit-slot: this checkout's install predates its workspace packages, so the build would fail; unlinked:",
        ...missing.map((line) => `  ${line}`),
        `run \`~/.playground/ops/run-slot.sh <your name> -- bun install --ignore-scripts --cwd ${cwd}\`, then commit again`,
      ].join("\n")

if (import.meta.main) {
  const refusal = unlinkedRefusal(await unlinked(process.cwd()), process.cwd())
  if (refusal) {
    console.error(refusal)
    process.exit(1)
  }
  const step = process.argv.slice(2)
  const argv = slotted({
    argv: step,
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
  if (argv !== step) {
    const room = Bun.spawnSync([argv[0]!, "room"], {
      stderr: "ignore",
      stdout: "pipe",
      timeout: 10_000,
    })
    console.error(queued(argv[1]!, room.exitCode === 0 ? room.stdout.toString() : ""))
  }
  const child = Bun.spawn(argv, { stdio: ["inherit", "inherit", "inherit"] })
  process.exit(await child.exited)
}
