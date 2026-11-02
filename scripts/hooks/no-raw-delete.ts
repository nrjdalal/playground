// PreToolUse hook, acting for every session and sub-agent: refuses a recursive delete and the calls that strip a file's delete protection, since a recursive delete is final and a prompt line against one does not hold (2 Nov: two code-review sub-agents each deleted recursively in their own scratch folders), and names playground rm, which moves a path into a 7-day trash. A speed bump: a script file a session writes and runs passes it.

import { realpathSync } from "node:fs"
import { basename, dirname, resolve, sep } from "node:path"

import { gitCommand } from "./no-stash"
import {
  type Command,
  type Env,
  examine,
  knownVariables,
  lex,
  marked,
  pathOf,
  PRINTERS,
  program,
  readPath,
  run,
  stdinOf,
  visible,
  type Visit,
  type Word,
} from "./shell"

const INSTEAD =
  "Move it to the 7-day trash with playground rm <path> (a worktree: playground rm --worktree <path>), or leave a scratch folder in place for your lead's cleanup. A plain rm of a file inside your own worktree or scratchpad, with no -r, still runs."

const WORKTREE =
  "Remove a worktree with playground rm --worktree <path>, which moves it to the 7-day trash once no live session holds it."

const refuse = (
  what: string,
  why = "a recursive delete is final, and one aimed wrong takes a whole tree",
  instead = INSTEAD,
) => `no-raw-delete hook refuses ${what}: ${why}. ${instead}`

// A word the hook cannot read, named by the variable it expands when it has one.
const shown = (word: Word) => (word.variable ? `$${word.variable}` : visible(word.value))

// Programs whose arguments are text they print, search or edit, or code in their own language, so a spaced argument is never a shell command line (an interpreter's own delete call is the speed bump's stated gap).
const DATA = new Set([
  ...PRINTERS,
  "awk",
  "bun",
  "cat",
  "deno",
  "egrep",
  "fgrep",
  "gawk",
  "gh",
  "grep",
  "jq",
  "node",
  "perl",
  "rg",
  "ruby",
  "sed",
])
const isData = (name: string) => DATA.has(name) || /^python[\d.]*$/.test(name)
// Programs that run the command their arguments name, read here at each word that does not start with a dash.
const STARTERS = new Set(["screen", "tmux"])
const FIND_RUNS = new Set(["-exec", "-execdir", "-ok", "-okdir"])

// rm's recursive option: -r or -R in a cluster, or --recursive by any prefix GNU rm takes (`--rec`).
const recursive = (v: string): boolean =>
  v.startsWith("--") ? v.length >= 3 && "--recursive".startsWith(v) : /^-[A-Za-z]*[rR]/.test(v)

// A path with every folder that exists resolved through its links, so /tmp reads as /private/tmp and a link cannot carry a delete out of a root.
function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : resolve(real(parent), basename(path))
  }
}

// The folders a plain rm may delete files in: the worktree the session works in, and its own scratchpad.
type Roots = { scratch?: RegExp; worktree?: string }

function rootsOf(cwd: string | undefined, session: unknown): Roots {
  const at = cwd ? real(cwd) : ""
  const worktree = /^(.*\/\.claude\/worktrees\/[^/]+)(?:\/|$)/.exec(at)?.[1]
  const id = typeof session === "string" && /^[\w-]+$/.test(session) ? session : undefined
  const scratch = id
    ? new RegExp(`^(?:/private)?/tmp/claude-\\d+/[^/]+/${id}/scratchpad/`)
    : undefined
  return { scratch, worktree }
}

const inside = (path: string, { scratch, worktree }: Roots): boolean => {
  const at = real(path)
  return (!!worktree && at.startsWith(worktree + sep)) || (!!scratch && scratch.test(at))
}

function judgeRm(args: Word[], xargs: boolean, env: Env, roots: Roots): string | undefined {
  if (xargs) return refuse("rm under xargs", "the hook cannot read the paths xargs hands it")
  let options = true
  const targets: Word[] = []
  for (const a of args) {
    if (marked(a.value))
      return refuse(
        `an rm with a word the hook cannot read (${shown(a)})`,
        "it may be -r or any path",
      )
    if (options && a.value === "--") options = false
    else if (options && a.value.startsWith("-") && a.value !== "-") {
      if (recursive(a.value)) return refuse(`a recursive rm (${a.value})`)
    } else targets.push(a)
  }
  const outside = targets.find((t) => {
    const path = pathOf(t, env)
    return !path || !inside(path, roots)
  })
  if (outside)
    return refuse(
      `an rm of ${visible(outside.value)}`,
      "it is outside your own worktree and scratchpad, where a plain rm runs",
    )
}

function judgeGit(args: Word[]): string | undefined {
  const { rest, sub } = gitCommand(args)
  const words = rest.map((w) => w.value)
  const cluster = (letter: string) => words.some((v) => new RegExp(`^-[A-Za-z]*${letter}`).test(v))
  if (sub?.value === "clean") {
    if (cluster("n") || words.includes("--dry-run")) return
    const force = cluster("f") || words.includes("--force")
    if (force && (cluster("d") || cluster("x") || cluster("X")))
      return refuse(
        "git clean -f with -d or -x",
        "it deletes untracked folders or ignored files for good",
      )
  }
  if (
    sub?.value === "worktree" &&
    words[0] === "remove" &&
    (cluster("f") || words.includes("--force"))
  )
    return refuse(
      "git worktree remove --force",
      "it deletes a worktree's uncommitted work for good",
      WORKTREE,
    )
}

async function inspect(raw: string, environment: Record<string, string | undefined>) {
  const payload = JSON.parse(raw) as Record<string, unknown>
  const { cwd, session_id: session, tool_input: input, tool_name: tool } = payload
  if (tool !== "Bash") return
  const command = (input as { command?: unknown } | null)?.command
  if (typeof command !== "string" || !CANDIDATE.test(bare(command))) return
  const directory = typeof cwd === "string" ? cwd : undefined
  const roots = rootsOf(directory, session)
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known: knownVariables(command, environment, directory),
    process: environment,
    vars: new Map(),
  }
  const line = (text: string, at: Env) =>
    run(lex(text, at.known), { ...at, vars: new Map(at.vars) }, visit)
  const visit: Visit = async (cmd, { args, first, name, xargs }, at) => {
    const verdict = await judge(cmd, args, first, name, xargs !== undefined, at)
    if (verdict || isData(name)) return verdict
    // a spaced word is read as a command line of its own, the text after an = and a leading ! too (`sh -c '…'` behind any wrapper); git's only command lines are its -c aliases' `!` values, so its messages and patterns stay text; a part it cannot read stays unread in the words it lands in
    const words =
      name === "git"
        ? gitCommand(args).aliases.flatMap((a) => /^alias\.[^=]*=!(.*)$/s.exec(a)?.[1] ?? [])
        : args.flatMap(({ value }) => [value, value.slice(value.indexOf("=") + 1)])
    for (const text of new Set(words.map((w) => w.replace(/^!/, "")))) {
      if (!/\s/.test(text)) continue
      const found = await line(text, at)
      if (found) return found
    }
  }
  const judge = async (
    cmd: Command,
    args: Word[],
    first: Word | undefined,
    name: string,
    xargs: boolean,
    at: Env,
  ): Promise<string | undefined> => {
    if (first && marked(first.value) && args.some((a) => /^-[A-Za-z]*[rR]/.test(a.value)))
      return refuse(`a program the hook cannot read (${shown(first)}) given -r`, "it may be rm")
    if (name === "rm") return judgeRm(args, xargs, at, roots)
    if (name === "git") return judgeGit(args)
    if (name === "chflags")
      return refuse("chflags", "it lifts the flags that keep a file from deletion")
    if (name === "chmod" && args.some((a) => /^-[A-Za-z]*[aN]/.test(a.value)))
      return refuse("chmod -a or -N", "it strips the access entries that keep a file from deletion")
    if (name === "find") {
      if (args.some((a) => a.value === "-delete")) return refuse("find -delete")
      for (const [k, a] of args.entries()) {
        if (!FIND_RUNS.has(a.value)) continue
        const end = args.findIndex((w, j) => j > k && (w.value === ";" || w.value === "+"))
        const words = args.slice(k + 1, end === -1 ? undefined : end)
        if (program(words[0]?.value ?? "") === "rm")
          return refuse(`find ${a.value} rm`, "it deletes every path find reaches")
        const found = await examine({ ...cmd, words }, at, visit, false)
        if (found) return found
      }
    }
    if (name === "at") {
      const file = args.findIndex((a) => a.value === "-f")
      const script =
        file === -1 ? await stdinOf(cmd, at) : await readPath(args[file + 1] ?? { value: "" }, at)
      if (!script.unknown) return line(script.value, at)
    }
    if (STARTERS.has(name))
      for (const [k, a] of args.entries()) {
        if (a.value.startsWith("-") || marked(a.value)) continue
        const found = await examine(
          { ...cmd, redirects: [], words: args.slice(k) },
          at,
          visit,
          false,
        )
        if (found) return found
      }
  }
  return run(lex(command, env.known), env, visit)
}

const bare = (command: string) => command.replace(/[\\'"]/g, "")

// The cheap first look: a name the hook judges, or a $ or backtick that can spell one.
const CANDIDATE = /rm|delete|chflags|chmod|clean|worktree|screen|tmux|\bat\b|\$|`/

// A call that reads as a delete, which the hook refuses when it cannot read it.
const DELETES = /\brm\b|-delete\b|\bchflags\b|\bchmod\b|\bclean\b|\bworktree\b/

// The Bash command an input names, or undefined when the input does not parse as one.
function commandOf(raw: string): string | undefined {
  try {
    const command = (JSON.parse(raw) as { tool_input?: { command?: unknown } }).tool_input?.command
    return typeof command === "string" ? command : undefined
  } catch {
    return undefined
  }
}

// Fails closed only on a call that reads as a delete, so a parser bug cannot block every Bash command.
export async function check(
  raw: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  try {
    return await inspect(raw, environment)
  } catch (error) {
    if (!DELETES.test(bare(commandOf(raw) ?? raw))) return
    return refuse(`a call it could not read (${error})`, "it reads as a delete").concat(
      " Split it into plain commands and run them again.",
    )
  }
}

if (import.meta.main) {
  const reason = await check(await Bun.stdin.text())
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
