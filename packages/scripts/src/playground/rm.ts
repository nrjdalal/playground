import { readFileSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

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

import { parentPid, sessionAbove } from "../../../../scripts/hooks/session-state"
import STATUSES from "../../../../scripts/roster-statuses.json"
import { mainCheckout } from "../main-checkout"
import { sessionName } from "../trash"

export const RM_USAGE =
  'usage: playground rm <path> [--reason "<why>"] | --worktree <path> [--discard [--decision <id>]] [--reason "<why>"] | --list | --restore <id>'

export type RmArgs =
  | { list: true }
  | { restore: string }
  | { decision?: string; discard: boolean; path: string; reason: string; worktree: boolean }

// playground rm's words: one path, or --worktree's with an optional --discard and its --decision, with an optional --reason; --list or --restore <id> alone.
export const rmArgs = (words: string[]): RmArgs | { error: string } => {
  if (words.length === 1 && words[0] === "--list") return { list: true }
  if (words.length === 2 && words[0] === "--restore") return { restore: words[1]! }
  let path: string | undefined
  let reason = "playground rm"
  let worktree = false
  let discard = false
  let decision: string | undefined
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    if (word === "--reason" && words[i + 1] !== undefined) reason = words[++i]!
    else if (word === "--discard" && !discard) discard = true
    else if (word === "--decision" && words[i + 1] !== undefined && decision === undefined)
      decision = words[++i]!
    else if (word === "--worktree" && words[i + 1] !== undefined && path === undefined) {
      worktree = true
      path = words[++i]!
    } else if (!word.startsWith("--") && path === undefined) path = word
    else return { error: RM_USAGE }
  }
  return path === undefined || (discard && !worktree) || (decision !== undefined && !discard)
    ? { error: RM_USAGE }
    : { ...(decision === undefined ? {} : { decision }), discard, path, reason, worktree }
}

// An Inbox item as bun run ask get prints it, read for a delete decision's status and what.
export type Decision = {
  kind?: string
  preview?: { type?: string; what?: string }
  status?: string
}

// What playground rm reads and calls beyond its words, so a test hands it a mkdtemp machine: the running clones, the folders it starts from, an Inbox item by its id, whether a merged PR holds a commit, every process with a working folder, the ops notify line to the dispatcher, the session the caller is (callerOf), and the session's name.
export type RmDeps = {
  caller: () => Promise<string | undefined>
  clones: () => Clone[]
  data: string
  decision: (id: string) => Promise<Decision | null>
  home: string
  main: string
  merged: (sha: string, at: string) => boolean | null
  notify: (text: string) => void
  procs: () => Proc[] | null
  session: () => Promise<string>
}

// Who a caller that may be a session is, or undefined for a terminal no Claude Code session runs in: its PLAYGROUND_ROLE, a call detached from its parent or whose parent ps cannot read, since no terminal's own call is, else the session the shell-pane caller check (sessionAbove) finds above it in Claude Code's registry, which no prefix that drops the role reaches.
export const callerOf = async (
  environment: Record<string, string | undefined>,
  pid: number,
  parentOf: (pid: number) => number = parentPid,
): Promise<string | undefined> => {
  if (environment.PLAYGROUND_ROLE) return `a session (role ${environment.PLAYGROUND_ROLE})`
  if (pid <= 1) return "a detached call (its parent is pid 1)"
  if (!parentOf(pid)) return `a call whose parent ps cannot read (pid ${pid})`
  const id = await sessionAbove(environment, pid, parentOf)
  return id && `a session (session ${id})`
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

// An Inbox item from bun run ask get in the Dashboard's checkout, which holds the Inbox's database, or null when none reads.
const decisionOf =
  (repo: string) =>
  async (id: string): Promise<Decision | null> => {
    try {
      const { dashboardCheckout } = await import("./probe")
      const checkout = dashboardCheckout(repo)
      if (!checkout) return null
      const run = Bun.spawnSync(["bun", "run", "--cwd", checkout, "ask", "get", id], {
        stderr: "ignore",
        stdout: "pipe",
      })
      const out = run.stdout.toString()
      return run.exitCode === 0 ? (JSON.parse(out.slice(out.indexOf("{"))) as Decision) : null
    } catch {
      return null
    }
  }

// This machine's: the caller above this process, run-slot's running clone, HOME, the data folder, the Inbox through the Dashboard's checkout, the main checkout, gh for a merged PR, notify.sh to the dispatcher, lsof and ps, and the Claude Code registry's name for this session, else "shell".
export const rmDeps = (repo: string): RmDeps => ({
  caller: () => callerOf(process.env, process.ppid),
  clones: clones(dataDir()),
  data: dataDir(),
  decision: decisionOf(repo),
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
  session: sessionName,
})

// Why a caller callerOf names may not pass --discard here, or null: it names with --decision an approved Inbox delete decision whose what names this path, so the owner's Approve is the authority and the session runs it.
export const discardRefusal = async (
  path: string,
  id: string | undefined,
  caller: string,
  deps: Pick<RmDeps, "decision">,
): Promise<string | null> => {
  const route = `post an Inbox delete decision with bun run ask new naming ${resolve(path)} and why, then run playground rm --worktree ${path} --discard --decision <id> once it is approved`
  if (id === undefined) return `${caller} passes --discard only with --decision <id>: ${route}`
  const item = await deps.decision(id)
  if (!item)
    return `--decision ${id} names no Inbox item the Dashboard's checkout can read: ${route}`
  if (item.kind !== "decision" || item.preview?.type !== "delete")
    return `--decision ${id} is not a delete decision: ${route}`
  if (item.status !== "approved")
    return `--decision ${id} is ${item.status ?? "of no status"}, not approved: ${route}`
  const paths = new Set([resolve(path)])
  try {
    paths.add(realpathSync(path))
  } catch {}
  const named = (item.preview.what ?? "")
    .split(/\s+/)
    .map((word) => word.replace(/^[`'"(]+|[`'",.;:)]+$/g, "").replace(/(.)\/$/, "$1"))
  if (!named.some((word) => paths.has(word)))
    return `--decision ${id}'s delete names another path, not ${resolve(path)}: ${route}`
  return null
}

// playground rm: one quarantine, list or restore against the deps' HOME, main checkout and trash; a protected or tripwire refusal goes to the dispatcher; exit 0 done, 1 refused, 2 a usage error.
export async function runRm(words: string[], deps: RmDeps): Promise<number> {
  const args = rmArgs(words)
  if ("error" in args) {
    console.error(`playground: ${args.error}`)
    return 2
  }
  if ("discard" in args && args.discard) {
    const caller = await deps.caller()
    const refusal = caller ? await discardRefusal(args.path, args.decision, caller, deps) : null
    if (refusal) {
      console.error(`playground: ${refusal}`)
      return 1
    }
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
