import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { dataDir } from "@packages/env/data-dir"
import {
  type Clone,
  isAgentBrowser,
  linkPlaces,
  listTrash,
  type Proc,
  quarantine,
  restore,
  type Roots,
  type WorktreeGit,
  worktreeRepo,
} from "@packages/safe-delete"

import STATUSES from "../../../../scripts/roster-statuses.json"
import { mainCheckout } from "../main-checkout"
import { sessionName } from "../trash"

export const RM_USAGE =
  'usage: playground rm <path> [--reason "<why>"] | --worktree <path> [--discard] [--pr <url>] [--reason "<why>"] | --list | --restore <id>'

export type RmArgs =
  | { list: true }
  | { restore: string }
  | {
      discard: boolean
      path: string
      pr?: string
      reason: string
      worktree: boolean
    }

// playground rm's words: one path, or --worktree's with an optional --discard and an optional --pr, with an optional --reason; --list or --restore <id> alone.
export const rmArgs = (words: string[]): RmArgs | { error: string } => {
  if (words.length === 1 && words[0] === "--list") return { list: true }
  if (words.length === 2 && words[0] === "--restore") return { restore: words[1]! }
  let path: string | undefined
  let reason = "playground rm"
  let worktree = false
  let discard = false
  let pr: string | undefined
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    if (word === "--reason" && words[i + 1] !== undefined) reason = words[++i]!
    else if (word === "--discard" && !discard) discard = true
    else if (word === "--pr" && words[i + 1] !== undefined && pr === undefined) pr = words[++i]!
    else if (word === "--worktree" && words[i + 1] !== undefined && path === undefined) {
      worktree = true
      path = words[++i]!
    } else if (!word.startsWith("--") && path === undefined) path = word
    else return { error: RM_USAGE }
  }
  return path === undefined || (discard && !worktree) || (pr !== undefined && !worktree)
    ? { error: RM_USAGE }
    : {
        discard,
        path,
        ...(pr === undefined ? {} : { pr }),
        reason,
        worktree,
      }
}

export type PrState = "CLOSED" | "MERGED" | "OPEN"
export type Pr = { head: string; number: number; state: PrState }
// A worktree's PR once it reads MERGED or CLOSED, as the hold check's freed: its head beside its number and state, or undefined while it reads OPEN or GitHub cannot read it. The hold check frees a row naming the worktree by its branch or by this PR's number only when the PR's head is the worktree's HEAD; commits past it keep the hold, named with them.
export const freedOf = (
  pr: Pr | "none" | null,
): { head: string; number: number; state: "CLOSED" | "MERGED" } | undefined =>
  pr && pr !== "none" && pr.state !== "OPEN"
    ? { head: pr.head, number: pr.number, state: pr.state }
    : undefined

// What playground rm reads and calls beyond its words, so a test hands it a mkdtemp machine: the running clones, the folders it starts from, whether a merged PR holds a commit, every process with a working folder, the ops notify line to the dispatcher, the folders read for links into a worktree, a worktree's PR state by its --pr or else its branch ("none" when gh answers with no PR, null when no PR of its own reads), and the session's name.
export type RmDeps = {
  clones: () => Clone[]
  data: string
  home: string
  main: string
  merged: (sha: string, at: string) => boolean | null
  notify: (text: string) => void
  places: () => string[]
  prState: (path: string, pr?: string) => Promise<Pr | "none" | null>
  procs: () => Proc[] | null
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

// Pure: a worktree's PR state, counted only when exactly one PR answers, since a branch name used twice can find another's, that PR is this worktree's own (its branch is the worktree's, or its head is HEAD, so a stacked child does not pass under its parent's PR), and its head is HEAD or an ancestor of it; "none" when gh's list is empty; else null.
export const prStateOf = (
  prs: { headRefName: string; headRefOid: string; number: number; state: PrState }[] | null,
  at: { branch: string | null; head: string },
  holds: (sha: string) => boolean,
): Pr | "none" | null => {
  if (prs?.length === 0) return "none"
  const only = prs?.length === 1 ? prs[0]! : null
  if (!only || (only.headRefName !== at.branch && only.headRefOid !== at.head)) return null
  return only.headRefOid === at.head || holds(only.headRefOid)
    ? { head: only.headRefOid, number: only.number, state: only.state }
    : null
}

// A worktree's PR state from gh in it, the --pr URL's else its branch's, by prStateOf, or null when gh or git cannot answer.
const prState = async (path: string, pr?: string): Promise<Pr | "none" | null> => {
  const gh = (args: string[]) => {
    try {
      const run = Bun.spawnSync(["gh", ...args], { cwd: path, stderr: "ignore", stdout: "pipe" })
      return run.exitCode === 0 ? JSON.parse(run.stdout.toString()) : null
    } catch {
      return null
    }
  }
  const head = gitIn(path, "rev-parse", "HEAD")
  if (!head.ok) return null
  const named = gitIn(path, "symbolic-ref", "--quiet", "--short", "HEAD")
  const branch = named.ok ? named.out : null
  if (!pr && !branch) return null
  const fields = ["--json", "headRefName,headRefOid,number,state"]
  const list = pr
    ? gh(["pr", "view", pr, ...fields, "--jq", "[.]"])
    : gh(["pr", "list", "--head", branch!, "--state", "all", "--limit", "2", ...fields])
  const states = new Set(["CLOSED", "MERGED", "OPEN"])
  const prs =
    Array.isArray(list) && list.every((p) => states.has(p?.state) && Number.isInteger(p?.number))
      ? list
      : null
  return prStateOf(
    prs,
    { branch, head: head.out },
    (sha) => gitIn(path, "merge-base", "--is-ancestor", sha, "HEAD").ok,
  )
}

// This machine's: run-slot's running clone, HOME, the data folder, the main checkout, gh for a merged PR, notify.sh to the dispatcher, linkPlaces' temp and scratchpad folders, lsof and ps, and the Claude Code registry's name for this session, else "shell".
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
  places: linkPlaces,
  prState,
  procs: processes,
  session: sessionName,
})

const gitIn = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", "-C", cwd, ...args], { stderr: "pipe", stdout: "pipe" })
  return {
    err: run.stderr.toString().trim(),
    ok: run.exitCode === 0,
    out: run.stdout.toString().trim(),
  }
}

// A worktree's git record, read before its move, or undefined when git cannot read it.
export const worktreeGit = (path: string): WorktreeGit | undefined => {
  const sha = gitIn(path, "rev-parse", "HEAD")
  const gitdir = gitIn(path, "rev-parse", "--absolute-git-dir")
  if (!sha.ok || !gitdir.ok) return undefined
  const branch = gitIn(path, "symbolic-ref", "--quiet", "--short", "HEAD")
  return { branch: branch.ok ? branch.out : null, gitdir: gitdir.out, sha: sha.out }
}

// A worktree's own repo, the main checkout or another, whose .git/worktrees/<name> its record folder is.
const repoOf = (git: WorktreeGit): string => dirname(dirname(dirname(git.gitdir)))

// Why a worktree's restore would leave it on another commit or unreadable, or null; a record folder still there is kept as it is.
const relinkRefusal = (main: string, git: WorktreeGit, bundle?: string): string | null => {
  if (existsSync(git.gitdir)) return null
  const at = git.branch
    ? gitIn(main, "rev-parse", "--verify", "--quiet", `refs/heads/${git.branch}`)
    : null
  if (at?.ok && at.out !== git.sha)
    return `the branch ${git.branch} now points at ${at.out}, not ${git.sha}, the commit the worktree held, so the restore leaves both as they are`
  if (at?.ok || gitIn(main, "cat-file", "-e", `${git.sha}^{commit}`).ok) return null
  return `the commit ${git.sha} the worktree held is gone from ${main}, so its restore would leave a folder git cannot read: ${bundle ? `git -C ${main} fetch ${bundle} HEAD brings it back from the bundle --discard kept; ` : ""}${git.branch ? `fetch that commit, run git -C ${main} branch ${git.branch} ${git.sha}, then restore it again` : "fetch that commit, then restore it again"}`
}

// Writes a gone git record back, recreates a gone branch at its commit and rebuilds the index from HEAD, keeping the files: null when done, else the step that failed.
const relink = (path: string, main: string, git: WorktreeGit): string | null => {
  if (existsSync(git.gitdir)) return null
  mkdirSync(git.gitdir, { recursive: true })
  writeFileSync(
    join(git.gitdir, "HEAD"),
    git.branch ? `ref: refs/heads/${git.branch}\n` : `${git.sha}\n`,
  )
  writeFileSync(join(git.gitdir, "commondir"), "../..\n")
  writeFileSync(join(git.gitdir, "gitdir"), `${join(path, ".git")}\n`)
  if (
    git.branch &&
    !gitIn(main, "show-ref", "--verify", "--quiet", `refs/heads/${git.branch}`).ok
  ) {
    const made = gitIn(main, "branch", git.branch, git.sha)
    if (!made.ok) return `git branch ${git.branch} ${git.sha} failed: ${made.err}`
  }
  const reset = gitIn(path, "reset", "-q")
  return reset.ok ? null : `git reset -q failed: ${reset.err}`
}

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
  const kept =
    "restore" in args
      ? listTrash(roots.trash).find((entry) => entry.id === args.restore)
      : undefined
  const keptGit = kept?.git
  const relinkRefused = keptGit && relinkRefusal(repoOf(keptGit), keptGit, kept?.bundle)
  if (relinkRefused) {
    console.error(`playground: ${relinkRefused}`)
    return 1
  }
  const session = "restore" in args ? "" : await deps.session()
  const git = "worktree" in args && args.worktree ? worktreeGit(args.path) : undefined
  const repo = "worktree" in args && args.worktree ? worktreeRepo(args.path, roots) : null
  // a MERGED or CLOSED PR frees its worktree from a roster row naming its branch; an unreadable one keeps the row's hold; on gh's clean answer of no PR alone, another repo's worktree may go once archiveUnlanded archives its commits no remote holds
  const own =
    "worktree" in args && args.worktree ? await deps.prState(args.path, args.pr) : undefined
  const freed = own === undefined ? undefined : freedOf(own)
  const done =
    "restore" in args
      ? restore(args.restore, roots)
      : quarantine(
          args.path,
          {
            ...(git ? { git } : {}),
            ended: { live: STATUSES.live, roster: join(deps.data, "roster.json") },
            reason: args.reason,
            session,
            worktree: args.worktree
              ? {
                  ...(own === "none" ? { archive: join(deps.data, "scratchpad", "archive") } : {}),
                  clones: deps.clones,
                  discard: args.discard,
                  ...(freed ? { freed } : {}),
                  live: STATUSES.live,
                  merged: deps.merged,
                  note: (line: string) => console.log(`playground: ${line}`),
                  places: deps.places,
                  ...(args.pr ? { pr: args.pr } : {}),
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
    const relinked = keptGit ? relink(done.path, repoOf(keptGit), keptGit) : null
    if (relinked) {
      console.error(`playground: restored ${done.path}, but git cannot read it yet: ${relinked}`)
      return 1
    }
    console.log(
      `Restored ${done.path}${kept?.stripped ? ", and a bun install in it rebuilds what the strip removed" : ""}`,
    )
    return 0
  }
  if (repo) Bun.spawnSync(["git", "-C", repo, "worktree", "prune"])
  console.log(
    `Moved to the trash as ${done.id} (${done.files} files); playground rm --restore ${done.id} brings it back${done.stripped ? ", and a bun install in it rebuilds what the strip removed" : ""}${done.stripFailed ? ` (the strip stopped partway: ${done.stripFailed}; the hourly strip takes the rest)` : ""}${done.bundle ? `; its commits no remote holds are kept in ${done.bundle}, which git -C ${repo ?? deps.main} fetch ${done.bundle} HEAD brings back` : ""}`,
  )
  return 0
}
