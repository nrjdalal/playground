import { homedir } from "node:os"
import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import { listTrash, quarantine, restore, type Roots } from "@packages/safe-delete"

import STATUSES from "../../../../scripts/roster-statuses.json"
import { mainCheckout } from "../main-checkout"
import { sessionName } from "../trash"

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

// What playground rm reads and calls beyond its words, so a test hands it a mkdtemp machine: the folders it starts from, every process's working folder, the ops notify line to the dispatcher, and the session's name.
export type RmDeps = {
  cwds: () => string[] | null
  data: string
  home: string
  main: string
  notify: (text: string) => void
  session: () => Promise<string>
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

// This machine's: HOME, the data folder, the main checkout, lsof, notify.sh to the dispatcher, and the Claude Code registry's name for this session, else "shell".
export const rmDeps = (repo: string): RmDeps => ({
  cwds: processFolders,
  data: dataDir(),
  home: homedir(),
  main: mainCheckout(repo),
  notify: (text) =>
    void Bun.spawnSync(["bash", join(repo, "scripts", "ops", "notify.sh"), "safe-delete", text], {
      env: { ...process.env, NOTIFY_TO: "dispatcher" },
      stderr: "ignore",
      stdout: "ignore",
    }),
  session: sessionName,
})

// playground rm: one quarantine, list or restore against the deps' HOME, main checkout and trash; a protected or tripwire refusal goes to the dispatcher; exit 0 done, 1 refused, 2 a usage error.
export async function runRm(words: string[], deps: RmDeps): Promise<number> {
  const args = rmArgs(words)
  if ("error" in args) {
    console.error(`playground: ${args.error}`)
    return 2
  }
  const roots: Roots = { home: deps.home, main: deps.main, trash: join(deps.data, "trash") }
  if ("list" in args) {
    for (const entry of listTrash(roots.trash))
      console.log(
        `${entry.id}  ${entry.path}  ${entry.files} files, ${entry.size} bytes, by ${entry.session}: ${entry.reason}`,
      )
    return 0
  }
  const session = "restore" in args ? "" : await deps.session()
  const done =
    "restore" in args
      ? restore(args.restore, roots)
      : quarantine(
          args.path,
          {
            reason: args.reason,
            session,
            worktree: args.worktree
              ? { cwds: deps.cwds(), live: STATUSES.live, roster: join(deps.data, "roster.json") }
              : undefined,
          },
          roots,
        )
  if ("refused" in done) {
    if (done.kind !== "refused") deps.notify(`${session || "restore"}: ${done.refused}`)
    console.error(`playground: ${done.refused}`)
    return 1
  }
  if ("path" in done) {
    console.log(`Restored ${done.path}`)
    return 0
  }
  if ("worktree" in args && args.worktree)
    Bun.spawnSync(["git", "-C", roots.main, "worktree", "prune"])
  console.log(
    `Moved to the trash as ${done.id} (${done.files} files); playground rm --restore ${done.id} brings it back`,
  )
  return 0
}
