// PreToolUse hook: puts a reviewer or tester session (role.ts), its sub-agents included, in read mode while its roster row serves an outside author's PR or names none, and in read mode refuses a Bash or Monitor line unless every command on it is one the allowlist below names, since running the PR's tests, scripts or installs runs its author's code on this machine.
import "../../packages/env/src/aliases"
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

import { dataDirOf } from "../../packages/env/src/data-dir"
import { mainCheckout } from "./no-main-checkout"
import { readsWords } from "./read-only"
import { registryName, sessionRole } from "./role"
import {
  type Command,
  type Env,
  examine,
  knownVariables,
  lex,
  marked,
  type Parsed,
  pathOf,
  run,
  SHELLS,
  shellOperand,
  type Visit,
} from "./shell"

type Environment = Record<string, string | undefined>
type Pr = { author: string; owner: string; ownerType: string }

// What the hook reads off the machine and GitHub, a seam its tests fill with made-up sessions and PRs.
export type Lookup = {
  author: (repo: string, pr: number) => Promise<Pr | undefined>
  holds: (
    folder: string,
    entry: ".git" | "bunfig.toml" | "HEAD" | "node_modules" | "objects" | "refs",
  ) => boolean
  main: string
  prsOf: (sessionId: unknown) => Promise<string[]>
  // the program a script's first line runs it with (runnerOf): `env`'s program for an env line, "" for one it cannot read or a script it cannot open, undefined with no shebang
  runner: (script: string) => string | undefined
}

const CHECKERS = new Set(["reviewer", "tester"])
const TOOLS = new Set(["Bash", "Monitor"])
const PULL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/
// Programs and shell words that run no file they are given, by bare name, A to Z.
const UTILITIES = new Set([
  "[",
  "basename",
  "break",
  "case",
  "cat",
  "cd",
  "comm",
  "continue",
  "cut",
  "date",
  "diff",
  "dirname",
  "echo",
  "exit",
  "false",
  "grep",
  "head",
  "jq",
  "ls",
  "mkdir",
  "printf",
  "pwd",
  "realpath",
  "sleep",
  "tail",
  "test",
  "tr",
  "true",
  "uniq",
  "wc",
])
// Interpreters that read no config from the folder they run in, so an installed skill's script runs as its author wrote it; bun is left out, since it reads the folder's bunfig.toml, whose preload runs first, and the shells are judged as shells.
const INTERPRETERS = new Set(["node", "python", "python3"])
// gh's command groups a checker posts and reads with, A to Z; a checkout (`pr checkout` or `pr co`, wherever the verb sits among gh's flags, and `issue develop`) is left out, since it runs the git hooks of the folder it lands in, and so is any `--`, which hands gh's clone git's own options.
const GH = new Set(["api", "issue", "label", "pr", "repo", "run", "search"])
// git's subcommands that read the repo and run nothing it holds, A to Z, with any option but the ones that start a program or write a file.
const GIT_READS = new Set([
  "blame",
  "branch",
  "cat-file",
  "describe",
  "diff",
  "for-each-ref",
  "grep",
  "log",
  "ls-files",
  "ls-tree",
  "merge-base",
  "merge-tree",
  "name-rev",
  "remote",
  "rev-list",
  "rev-parse",
  "shortlog",
  "show",
  "status",
])
// git's options that start a program or write a file, by their full names, since git takes any unambiguous start of one (`--open=`, `--out=`); `--text` is git's own option, not a start of `--textconv`.
const GIT_RUN_NAMES = ["ext-diff", "open-files-in-pager", "output", "textconv"]
// git grep's short options that take the rest of their word as a value, so an O after one is that value's, not the pager
const GREP_VALUED = "ABCefm"
const gitRuns = (w: string, sub: string) => {
  if (sub === "grep" && /^-[^-]/.test(w))
    for (const c of w.slice(1)) {
      if (c === "O") return true
      if (GREP_VALUED.includes(c)) break
    }
  const long = /^--([^=]+)/.exec(w)?.[1]
  return long !== undefined && long !== "text" && GIT_RUN_NAMES.some((n) => n.startsWith(long))
}
// A remote's name, which a fetch takes from the clone's own config, so git reads only the clone's repository; a path names a repository the PR can ship.
const REMOTE = /^[A-Za-z0-9_][\w.-]*$/
// fetch's options that name no program and no source, A to Z
const FETCH_OPTIONS = new Set([
  "--all",
  "--force",
  "--no-tags",
  "--prune",
  "--tags",
  "--unshallow",
  "-f",
  "-p",
  "-t",
])
const QUIET = new Set(["-q", "--quiet"])
// sed's scripts that run and write nothing: `-n` printing a range of lines or patterns, or one substitution whose flags write no file
const SED_ADDRESS = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/)`
const SED_PRINT = new RegExp(`^${SED_ADDRESS}(?:,${SED_ADDRESS})?p$`)
const SED_SUBSTITUTE = /^s\/(?:[^/\\]|\\.)*\/(?:[^/\\]|\\.)*\/[gIp\d]*$/
// The playground command's verbs a checker reads with, A to Z; `add` and the manager verbs start a session that no read mode holds.
const PLAYGROUND_READS = new Set(["ext search", "ext which", "rules"])
const GITHUB_URL = /^(?:https:\/\/github\.com\/|git@github\.com:)[\w.-]+\/[\w.-]+?(?:\.git)?$/

// Read mode's reason, by why the session is in it; a PR GitHub did not answer for names its kept answer, which a read retries an hour after the failure.
const unread = (repo: string, n: number) =>
  `GitHub did not answer for ${repo}#${n}, so the hook counts it as an outside author's PR until a read of it succeeds. It reads again an hour after the failed read, or at once after its worker or lead removes hook-outside-pr/${repo.replace("/", "__")}__${n}.json in the data folder with playground rm.`
const REASONS = {
  none: "its roster row names no PR, so the hook cannot rule out an outside author's code. A row written before spawn.sh required a checker's --pr <pull url> has none; its worker or lead names the PR it serves from the main checkout: bun scripts/roster.ts set <this session's name> pr=<pull url>.",
  outside:
    "it serves an outside author's PR, whose tests, scripts and installs run that author's code on this machine. Read the PR instead: the Read, Grep and Glob tools, gh pr diff, git diff and git show <rev> in the clone, and move a clone with no node_modules (a fresh one, never an installed one, whose git hooks would run) with git fetch and git checkout --detach. Score on the PR's own GitHub checks, and say in the verdict that its code was read, not run.",
}

// A path with its symlinks and .. steps resolved in order, as the system resolves them, so a climb out of a folder is judged where it lands; the native call, since node's own resolves .. before it follows a link.
function real(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

// Whether git, run in a folder, would take a bare repository for its own: the first folder up from it that holds .git, or holds HEAD, objects and refs, decides, as git's discovery does, and a PR can ship the second as plain files whose config names the programs git runs.
function bareAt(folder: string, lookup: Lookup): boolean {
  for (let at = folder; ; at = dirname(at)) {
    if (basename(at) === ".git" || lookup.holds(at, ".git")) return false
    if (lookup.holds(at, "HEAD") && lookup.holds(at, "objects") && lookup.holds(at, "refs"))
      return true
    if (dirname(at) === at) return false
  }
}

// Whether a folder, or one above it up to its work tree's root, holds node_modules, from which a git hook's lefthook runs at that root.
function installedAt(folder: string, lookup: Lookup): boolean {
  for (let at = folder; ; at = dirname(at)) {
    if (lookup.holds(at, "node_modules")) return true
    if (lookup.holds(at, ".git") || dirname(at) === at) return false
  }
}

// Whether a path, case ignored as this Mac's file system ignores it, sits under a folder.
const under = (path: string, folder: string) =>
  (path + "/").toLowerCase().startsWith(folder.toLowerCase().replace(/\/?$/, "/"))

// git's reads, and the literal forms that fetch or place a PR's code without running a file it holds: a fetch, a fresh clone of a GitHub repo, a worktree add or list, and a detached checkout or switch in a folder with no node_modules for a git hook's lefthook to load.
function gitAllows(
  words: string[],
  folder: string | undefined,
  lookup: Lookup,
  environment: Environment,
): boolean {
  // a repository the session names by its environment is one the walk below would not find
  if ("GIT_DIR" in environment || "GIT_WORK_TREE" in environment) return false
  const dashC = words[1] === "-C"
  const [sub, ...all] = words.slice(dashC ? 3 : 1)
  // the folder git really uses, its symlinks followed as git follows them
  const written =
    dashC && folder ? (isAbsolute(words[2]) ? words[2] : `${folder}/${words[2]}`) : folder
  const at = written === undefined ? undefined : real(written)
  if (at === undefined || bareAt(at, lookup) || all.some((w) => gitRuns(w, sub))) return false
  const rest = all.filter((w) => !QUIET.has(w))
  const plain = (w: string) => !w.startsWith("-") && !w.includes("::")
  // a remote takes no verb but the two that read it, since `remote add` names a source a fetch then reads
  const verb = all.find(plain)
  if (sub === "remote" && verb !== undefined && verb !== "get-url" && verb !== "show") return false
  if (readsWords(words) || GIT_READS.has(sub)) return true
  if (sub === "fetch") {
    const options = rest.filter((w) => w.startsWith("-"))
    const [source, ...refs] = rest.filter((w) => !w.startsWith("-"))
    return (
      options.every((w) => FETCH_OPTIONS.has(w) || /^--depth=\d+$/.test(w)) &&
      (source === undefined || REMOTE.test(source) || GITHUB_URL.test(source)) &&
      refs.every(plain)
    )
  }
  if (sub === "clone") return rest.length === 2 && GITHUB_URL.test(rest[0]) && plain(rest[1])
  if (sub === "checkout" || sub === "switch")
    return rest.length === 2 && rest[0] === "--detach" && plain(rest[1]) && !installedAt(at, lookup)
  if (sub !== "worktree") return false
  if (rest[0] === "list") return true
  if (rest[0] !== "add") return false
  const operands = rest[1] === "--detach" ? rest.slice(2) : rest.slice(1)
  return operands.length === 2 && operands.every(plain)
}

export async function inspect(
  command: string,
  directory: string | undefined,
  environment: Environment,
  lookup: Lookup,
): Promise<boolean> {
  const data = dataDirOf(environment)
  const skills = [join(data, "orgs"), join(lookup.main, "extensions")]
  const slot = join(data, "ops", "run-slot.sh")
  let allowed = true
  // A script of a skill installed in the data folder or kept in the main checkout's extensions, run as a program or by an interpreter with no option of its own.
  const skillScript = (written: string | undefined) => {
    if (written === undefined) return false
    const path = real(written)
    return skills.some(
      (root) => under(path, root) && path.slice(root.length).toLowerCase().includes("/skills/"),
    )
  }
  // Whether a folder sits in the main checkout's own work tree: the first folder up from it that holds .git is the main checkout, so another clone or worktree inside it, a folder outside any, and an unknown one are not.
  const inMain = (folder: string | undefined): boolean => {
    if (folder === undefined) return false
    const main = real(lookup.main)
    for (let at = real(folder); ; at = dirname(at)) {
      if (lookup.holds(at, ".git")) return at === main
      if (dirname(at) === at) return false
    }
  }
  const permitted = (cmd: Command, parsed: Parsed, here: Env): boolean => {
    const { args, first, local, name } = parsed
    // a bare assignment reaches a later program only through a variable the session already exports (PATH, BASH_ENV), and one on a command reaches it always
    if (name === "")
      return args.length === 0 && [...local.keys()].every((key) => !(key in environment))
    if (marked(name) || local.size > 0) return false
    const program = first ? pathOf(first, here) : undefined
    if (first && first.value.includes("/")) {
      if (program && under(program, slot) && program.length === slot.length) return true
      // bun reads files from the folder it runs in before a script (bunfig.toml's preload, .env's variables, and whatever a later bun adds), so a skill script whose shebang runs any program but one that reads no folder's files runs only from the main checkout's own tree
      if (!skillScript(program)) return false
      const runner = lookup.runner(real(program!))
      return runner === undefined || FOLDERLESS.has(runner) || inMain(here.cwd)
    }
    const words = [name, ...args.map((a) => a.value)]
    // git first, since read-only.ts's git reads say nothing of the folder git takes its repository from
    if (name === "git") return gitAllows(words, here.cwd, lookup, environment)
    if (UTILITIES.has(name) || readsWords(words)) return true
    // a loop's or a read's variable reaches a later program only when the session exports it, as a bare assignment's does
    if (name === "for") return !(words[1] in environment)
    if (name === "read")
      return words.slice(1).every((w) => w.startsWith("-") || !(w in environment))
    if (name === "sed")
      return words[1] === "-n"
        ? SED_PRINT.test(words[2] ?? "")
        : SED_SUBSTITUTE.test(words[1] ?? "")
    // a shell's -c script is walked on its own, and a script file only an installed skill's runs
    if (SHELLS.has(name)) {
      const { inline, operand } = shellOperand(args, name)
      return inline || (operand !== undefined && skillScript(pathOf(operand, here)))
    }
    // the playground command runs under bun, which reads the folder's bunfig.toml first
    if (name === "playground")
      return (
        (PLAYGROUND_READS.has(words[1]) || PLAYGROUND_READS.has(words.slice(1, 3).join(" "))) &&
        here.cwd !== undefined &&
        !lookup.holds(here.cwd, "bunfig.toml")
      )
    if (name === "gh") {
      const [group, ...rest] = words.slice(1)
      const checkout =
        (group === "pr" && rest.some((w) => w === "checkout" || w === "co")) ||
        (group === "issue" && rest.includes("develop"))
      return GH.has(group) && !checkout && !words.includes("--")
    }
    if (INTERPRETERS.has(name) && args[0] && !args[0].value.startsWith("-"))
      return skillScript(pathOf(args[0], here))
    return false
  }
  const visit: Visit = async (cmd, parsed, env) => {
    // the factory's run-slot runs its command after `--`, which is judged in its place
    if (parsed.name === "run-slot.sh" && parsed.first && permitted(cmd, parsed, env)) {
      const at = parsed.args.findIndex((a) => a.value === "--")
      return at === -1
        ? undefined
        : examine({ ...cmd, words: parsed.args.slice(at + 1) }, env, visit, false)
    }
    for (const reading of [parsed, ...parsed.also])
      if (!permitted(cmd, reading, env)) allowed = false
  }
  const variables = knownVariables(command, environment, directory)
  const env: Env = {
    cwd: directory,
    cwdSure: directory,
    files: new Map(),
    known: variables,
    old: { dir: directory },
    process: environment,
    vars: new Map(),
    visitShells: true,
  }
  await run(lex(command, variables), env, visit, true)
  return allowed
}

// Why the session is in read mode, or undefined when it serves the owner's own PRs alone: an outside PR's author is not the repo's owner, on a repo a user owns (an org repo's PRs are its colleagues'), and a PR the hook cannot read counts as outside.
export async function readMode(sessionId: unknown, lookup: Lookup): Promise<string | undefined> {
  const prs = (await lookup.prsOf(sessionId)).flatMap((url) => {
    const m = PULL.exec(url)
    return m ? [{ number: Number(m[2]), repo: m[1] }] : []
  })
  if (prs.length === 0) return REASONS.none
  for (const { number, repo } of prs) {
    const pr = await lookup.author(repo, number)
    if (!pr) return unread(repo, number)
    if (pr.ownerType === "User" && pr.author.toLowerCase() !== pr.owner.toLowerCase())
      return REASONS.outside
  }
}

export async function check(
  raw: string,
  environment: Environment = process.env,
  lookup: Lookup = live(environment),
): Promise<string | undefined> {
  let input: Record<string, unknown>
  try {
    input = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  const { cwd, session_id: sessionId, tool_input: toolInput, tool_name: tool } = input
  if (typeof tool !== "string" || !TOOLS.has(tool)) return
  const command = (toolInput as { command?: unknown } | undefined)?.command
  if (typeof command !== "string") return
  if (!CHECKERS.has(await sessionRole(environment, sessionId))) return
  const why = await readMode(sessionId, lookup)
  if (!why) return
  const directory = typeof cwd === "string" && isAbsolute(cwd) ? cwd : undefined
  let allowed = false
  try {
    allowed = await inspect(command, directory, environment, lookup)
  } catch {}
  if (allowed) return
  return `no-outside-pr-code hook keeps this reviewer or tester in read mode, which runs only reads, git's fetch, clone and detached checkout, gh, and an installed skill's scripts: ${why}`
}

async function output(argv: string[]): Promise<string | undefined> {
  const child = Bun.spawn(argv, { stderr: "ignore", stdout: "pipe" })
  const timer = setTimeout(() => child.kill(), 5000)
  try {
    const text = await new Response(child.stdout).text()
    return (await child.exited) === 0 ? text.trim() : undefined
  } finally {
    clearTimeout(timer)
  }
}

const isPr = (read: unknown): read is Pr =>
  typeof read === "object" &&
  read !== null &&
  ["author", "owner", "ownerType"].every(
    (key) => typeof (read as Record<string, unknown>)[key] === "string",
  )

// A script's first line, or undefined when it cannot be read.
const firstLine = (script: string): string | undefined => {
  try {
    return readFileSync(script, "utf8").split("\n", 1)[0]
  } catch {
    return undefined
  }
}

// The runners that read no file from the folder they run in; every other runner (bun, bun-canary, deno, an env line read as a word it is not) is held to the main checkout's tree, so a shape runnerOf misreads fails closed.
const FOLDERLESS = new Set(["bash", "node", "python", "python3", "sh", "zsh"])
// env's options that take the next word as their value (an unset name, a folder, a search path)
const ENV_VALUED = new Set(["--chdir", "--unset", "-C", "-P", "-u"])

// Pure: the program a shebang line runs, by its name: the interpreter's own, or the word env runs after its options, assignments and -S's split (`#!/usr/bin/env -S bun --flag`, `env -u NAME bun`); undefined with no shebang, and "" for an env line it cannot read (an unknown option, a program built from a variable, no program at all).
export const runnerOf = (line: string | undefined): string | undefined => {
  if (!line?.startsWith("#!")) return undefined
  const [interpreter, ...rest] = line.slice(2).trim().split(/\s+/)
  if (!interpreter) return undefined
  if (basename(interpreter) !== "env") return basename(interpreter)
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!
    if (ENV_VALUED.has(word)) i++
    else if (word === "-S" || word === "--split-string" || /^-[iv0]+$/.test(word)) continue
    else if (/^(?:--(?:chdir|unset)=|-[CPu].)/.test(word) || word === "--ignore-environment")
      continue
    else if (word.startsWith("-S")) return /[$\\]/.test(word) ? "" : basename(word.slice(2))
    else if (word.startsWith("-")) return ""
    else if (!word.includes("=")) return /[$\\]/.test(word) ? "" : basename(word)
  }
  return ""
}

// The machine's own lookup: the session's roster row by its registry name, and a PR's author by gh, kept in the data folder since it never changes; a read that fails is kept for an hour, so a PR GitHub cannot answer costs one call an hour.
export function live(environment: Environment): Lookup {
  const data = dataDirOf(environment)
  const cache = join(data, "hook-outside-pr")
  const HOUR = 3600 * 1000
  return {
    author: async (repo, pr) => {
      const file = join(cache, `${repo.replace("/", "__")}__${pr}.json`)
      try {
        const kept = (await Bun.file(file).json()) as { failedAt?: number } | Pr
        if (isPr(kept)) return kept
        if (typeof kept.failedAt === "number" && Date.now() - kept.failedAt < HOUR) return
      } catch {}
      const jq =
        "{author: .user.login, owner: .base.repo.owner.login, ownerType: .base.repo.owner.type}"
      const text = await output(["gh", "api", `repos/${repo}/pulls/${pr}`, "--jq", jq])
      let read: unknown
      try {
        read = text ? JSON.parse(text) : undefined
      } catch {}
      try {
        mkdirSync(cache, { recursive: true })
        await Bun.write(file, JSON.stringify(isPr(read) ? read : { failedAt: Date.now() }))
      } catch {}
      return isPr(read) ? read : undefined
    },
    holds: (folder, entry) => existsSync(join(folder, entry)),
    // a guard runs from the main checkout (the settings' command cds there), so its folder is the checkout whose extensions hold the factory's own skills
    main: mainCheckout(process.cwd()),
    prsOf: async (sessionId) => {
      if (typeof sessionId !== "string") return []
      try {
        const name = await registryName(sessionId, environment)
        if (!name) return []
        const roster = (await Bun.file(join(data, "roster.json")).json()) as {
          agents?: { name?: unknown; pr?: unknown; prs?: unknown }[]
        }
        const row = roster.agents?.find((agent) => agent?.name === name)
        const listed = Array.isArray(row?.prs) ? row.prs : []
        return [...new Set([row?.pr, ...listed])].filter(
          (url): url is string => typeof url === "string",
        )
      } catch {
        return []
      }
    },
    runner: (script) => {
      const line = firstLine(script)
      return line === undefined ? "" : runnerOf(line)
    },
  }
}

if (import.meta.main) {
  const reason = await check(await Bun.stdin.text())
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
