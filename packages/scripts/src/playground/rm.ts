import { homedir } from "node:os"
import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import {
  listTrash,
  quarantine,
  type Refusal,
  restore,
  type Roots,
  worktreeRefusal,
} from "@packages/safe-delete"

import { registryName } from "../../../../scripts/hooks/role"
import STATUSES from "../../../../scripts/roster-statuses.json"
import { mainCheckout } from "../main-checkout"

export const RM_USAGE =
  'usage: playground rm <path> [--reason "<why>"] | --worktree <path> [--reason "<why>"] | --list | --restore <id>'

export type RmArgs =
  | { list: true }
  | { restore: string }
  | { path: string; reason: string; worktree: boolean }

// playground rm's words: one path, or --worktree's, with an optional --reason; --list or --restore <id> alone.
export const rmArgs = (words: string[]): RmArgs | { error: string } => {
  if (words.length === 1 && words[0] === "--list") return { list: true }
  if (words.length === 2 && words[0] === "--restore") return { restore: words[1]! }
  let path: string | undefined
  let reason = "playground rm"
  let worktree = false
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    if (word === "--reason" && words[i + 1] !== undefined) reason = words[++i]!
    else if (word === "--worktree" && words[i + 1] !== undefined && path === undefined) {
      worktree = true
      path = words[++i]!
    } else if (!word.startsWith("--") && path === undefined) path = word
    else return { error: RM_USAGE }
  }
  return path === undefined ? { error: RM_USAGE } : { path, reason, worktree }
}

// Every process's working folder, as lsof lists them, or null when it lists none.
const processFolders = (): string[] | null => {
  const run = Bun.spawnSync(["lsof", "-d", "cwd", "-Fn"], { stderr: "ignore", stdout: "pipe" })
  const dirs = run.stdout
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("n/"))
    .map((line) => line.slice(1))
  return dirs.length ? dirs : null
}

// The ops notify line to the dispatcher, for a refusal that says something tried to delete what it must not.
const notify = (repo: string, session: string, refusal: Refusal) => {
  Bun.spawnSync(
    [
      "bash",
      join(repo, "scripts", "ops", "notify.sh"),
      "safe-delete",
      `${session}: ${refusal.refused}`,
    ],
    { env: { ...process.env, NOTIFY_TO: "dispatcher" }, stderr: "ignore", stdout: "ignore" },
  )
}

// playground rm: one quarantine, list or restore against this machine's HOME, main checkout and trash; exit 0 done, 1 refused, 2 a usage error.
export async function runRm(words: string[], repo: string): Promise<number> {
  const args = rmArgs(words)
  if ("error" in args) {
    console.error(`playground: ${args.error}`)
    return 2
  }
  const trash = join(dataDir(), "trash")
  if ("list" in args) {
    for (const entry of listTrash(trash))
      console.log(
        `${entry.id}  ${entry.path}  ${entry.files} files, ${entry.size} bytes, by ${entry.session}: ${entry.reason}`,
      )
    return 0
  }
  if ("restore" in args) {
    const back = restore(args.restore, trash)
    if ("refused" in back) {
      console.error(`playground: ${back.refused}`)
      return 1
    }
    console.log(`Restored ${back.path}`)
    return 0
  }
  const main = mainCheckout(repo)
  const roots: Roots = { home: homedir(), main, trash }
  const session =
    (process.env.CLAUDE_CODE_SESSION_ID &&
      (await registryName(process.env.CLAUDE_CODE_SESSION_ID))) ||
    "shell"
  if (args.worktree) {
    const why = worktreeRefusal(args.path, roots, {
      cwds: processFolders(),
      live: STATUSES.live,
      roster: join(dataDir(), "roster.json"),
    })
    if (why) {
      console.error(`playground: ${why}`)
      return 1
    }
  }
  const moved = quarantine(
    args.path,
    { reason: args.reason, session, worktree: args.worktree },
    roots,
  )
  if ("refused" in moved) {
    if (moved.kind !== "refused") notify(repo, session, moved)
    console.error(`playground: ${moved.refused}`)
    return 1
  }
  if (args.worktree) Bun.spawnSync(["git", "-C", main, "worktree", "prune"])
  console.log(
    `Moved to the trash as ${moved.id} (${moved.files} files); playground rm --restore ${moved.id} brings it back`,
  )
  return 0
}
