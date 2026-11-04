import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import {
  type Clone,
  isAgentBrowser,
  listTrash,
  type Proc,
  quarantine,
  restore,
  type Roots,
} from "@packages/safe-delete"

import STATUSES from "../../../../scripts/roster-statuses.json"
import { mainCheckout } from "../main-checkout"
import { sessionName } from "../trash"

export const RM_USAGE =
  'usage: playground rm <path> [--reason "<why>"] | --worktree <path> [--discard] [--reason "<why>"] | --list | --restore <id>'

export type RmArgs =
  | { list: true }
  | { restore: string }
  | { discard: boolean; path: string; reason: string; worktree: boolean }

// playground rm's words: one path, or --worktree's with an optional --discard, with an optional --reason; --list or --restore <id> alone.
export const rmArgs = (words: string[]): RmArgs | { error: string } => {
  if (words.length === 1 && words[0] === "--list") return { list: true }
  if (words.length === 2 && words[0] === "--restore") return { restore: words[1]! }
  let path: string | undefined
  let reason = "playground rm"
  let worktree = false
  let discard = false
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    if (word === "--reason" && words[i + 1] !== undefined) reason = words[++i]!
    else if (word === "--discard" && !discard) discard = true
    else if (word === "--worktree" && words[i + 1] !== undefined && path === undefined) {
      worktree = true
      path = words[++i]!
    } else if (!word.startsWith("--") && path === undefined) path = word
    else return { error: RM_USAGE }
  }
  return path === undefined || (discard && !worktree)
    ? { error: RM_USAGE }
    : { discard, path, reason, worktree }
}

// What playground rm reads and calls beyond its words, so a test hands it a mkdtemp machine: the running clones, the folders it starts from, whether a merged PR holds a commit, every process with a working folder, the ops notify line to the dispatcher, the caller's PLAYGROUND_ROLE, which a factory session sets and the owner's own terminal does not, and the session's name.
export type RmDeps = {
  clones: () => Clone[]
  data: string
  home: string
  main: string
  merged: (sha: string, at: string) => boolean | null
  notify: (text: string) => void
  procs: () => Proc[] | null
  role: string | undefined
  session: () => Promise<string>
}

// lsof -F's names for each pid: its "p<pid>" line, then each "n<name>" line under it.
const namesByPid = (out: string): Map<number, string[]> => {
  const names = new Map<number, string[]>()
  let pid = 0
  for (const line of out.split("\n"))
    if (line.startsWith("p")) names.set((pid = Number(line.slice(1))), [])
    else if (line.startsWith("n")) names.get(pid)?.push(line.slice(1))
  return names
}

// Each process lsof gives a working folder, with its command line from ps and its unix socket paths from a second lsof.
export const processesOf = (cwds: string, ps: string, sockets: string): Proc[] => {
  const commands = new Map<number, string>()
  for (const line of ps.split("\n")) {
    const row = /^\s*(\d+) (.*)$/.exec(line)
    if (row) commands.set(Number(row[1]), row[2]!)
  }
  const paths = namesByPid(sockets)
  return [...namesByPid(cwds)].flatMap(([pid, [cwd]]) =>
    cwd?.startsWith("/")
      ? [
          {
            command: commands.get(pid) ?? "",
            cwd,
            pid,
            sockets: (paths.get(pid) ?? []).filter((p) => p.startsWith("/")),
          },
        ]
      : [],
  )
}

// run-slot's clone holder line, "<who> <pid> <iso>" then a tab, the source checkout, a tab and the destination, as the clone it names while its pid lives; a line with no source names none.
export const clonesOf = (line: string, alive: (pid: number) => boolean): Clone[] => {
  const [head = "", source, destination] = line.trim().split("\t")
  const [who, pidText] = head.split(" ")
  const pid = Number(pidText)
  return who && Number.isInteger(pid) && source && destination && alive(pid)
    ? [{ destination, pid, source, who }]
    : []
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

// The clone run-slot's clone lane runs now, from its holder record in the data folder's ops folder, or none.
const clones = (data: string) => (): Clone[] => {
  try {
    return clonesOf(readFileSync(join(data, "ops", "run-slot-clone.holder"), "utf8"), alive)
  } catch {
    return []
  }
}

const output = (argv: string[]): string =>
  Bun.spawnSync(argv, { stderr: "ignore", stdout: "pipe" }).stdout.toString()

// Every process with a working folder, as lsof and ps list them, an agent-browser one with its sockets, or null when lsof lists none.
const processes = (): Proc[] | null => {
  const cwds = output(["lsof", "-d", "cwd", "-Fpn"])
  const ps = output(["ps", "-axo", "pid=,args="])
  const browsers = processesOf(cwds, ps, "").filter((p) => isAgentBrowser(p.command))
  const sockets = browsers.length
    ? output(["lsof", "-a", "-U", "-p", browsers.map((p) => p.pid).join(","), "-Fpn"])
    : ""
  const procs = processesOf(cwds, ps, sockets)
  return procs.length ? procs : null
}

// Whether a merged PR holds the commit, from GitHub's REST list of the commit's PRs in the worktree's own repository, or null when gh cannot answer.
const merged = (sha: string, at: string): boolean | null => {
  const run = Bun.spawnSync(
    [
      "gh",
      "api",
      `repos/{owner}/{repo}/commits/${sha}/pulls`,
      "--jq",
      "any(.[]; .merged_at != null)",
    ],
    { cwd: at, stderr: "ignore", stdout: "pipe" },
  )
  const out = run.stdout.toString().trim()
  return run.exitCode === 0 && (out === "true" || out === "false") ? out === "true" : null
}

// This machine's: run-slot's running clone, HOME, the data folder, the main checkout, gh for a merged PR, notify.sh to the dispatcher, lsof and ps, and the Claude Code registry's name for this session, else "shell".
export const rmDeps = (repo: string): RmDeps => ({
  clones: clones(dataDir()),
  data: dataDir(),
  home: homedir(),
  main: mainCheckout(repo),
  merged,
  notify: (text) =>
    void Bun.spawnSync(["bash", join(repo, "scripts", "ops", "notify.sh"), "safe-delete", text], {
      env: { ...process.env, NOTIFY_TO: "dispatcher" },
      stderr: "ignore",
      stdout: "ignore",
    }),
  procs: processes,
  role: process.env.PLAYGROUND_ROLE || undefined,
  session: sessionName,
})

// playground rm: one quarantine, list or restore against the deps' HOME, main checkout and trash; a protected or tripwire refusal goes to the dispatcher; exit 0 done, 1 refused, 2 a usage error.
export async function runRm(words: string[], deps: RmDeps): Promise<number> {
  const args = rmArgs(words)
  if ("error" in args) {
    console.error(`playground: ${args.error}`)
    return 2
  }
  if ("discard" in args && args.discard && deps.role) {
    console.error(
      `playground: --discard is the owner's own call, so a session with a role (${deps.role}) posts an Inbox delete decision with bun run ask new, naming ${args.path} and why, and the owner runs playground rm --worktree ${args.path} --discard in their own terminal`,
    )
    return 1
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
              ? {
                  clones: deps.clones(),
                  discard: args.discard,
                  live: STATUSES.live,
                  merged: deps.merged,
                  procs: deps.procs(),
                  roster: join(deps.data, "roster.json"),
                }
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
