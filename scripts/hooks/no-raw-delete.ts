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
  parse,
  type Parsed,
  pathOf,
  PRINTERS,
  program,
  readPath,
  run,
  slotWords,
  stdinOf,
  unreadable,
  visible,
  type Visit,
  withDeadline,
  type Word,
} from "./shell"

const INSTEAD =
  "Move it to the 7-day trash with playground rm <path> (a worktree: playground rm --worktree <path>), which takes up to 5,000 files or 2 GB; leave a bigger tree or a scratch folder in place for your lead's cleanup, and let bun install rebuild a node_modules in place. A plain rm of a file inside your own worktree or scratchpad, with no -r, still runs."

const WORKTREE =
  "Remove a worktree with playground rm --worktree <path>, which moves it to the 7-day trash once no live session holds it and its commit is on a remote branch."

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
// rm under its own name and GNU rm's Homebrew name.
const RM = new Set(["grm", "rm"])
// The programs the hook judges, read wherever another program names one among its words (`arch -arm64 rm -rf`, `busybox rm`), since any program may run its arguments.
const JUDGED = new Set([...RM, "chflags", "chmod", "fd", "find", "gfind", "git", "rimraf", "rsync"])
// Programs that print or search their words, so a judged name among them is text.
const READERS = new Set([...PRINTERS, "egrep", "fgrep", "grep", "rg"])
// Runners that add arguments the hook cannot see, as xargs does.
const APPENDS = new Set(["gxargs", "parallel"])
// The options of find and fd that run a program on every path they reach.
const RUNS: Record<string, Set<string>> = {
  fd: new Set(["--exec", "--exec-batch", "-X", "-x"]),
  find: new Set(["-exec", "-execdir", "-ok", "-okdir"]),
  gfind: new Set(["-exec", "-execdir", "-ok", "-okdir"]),
}
// at and batch read the script they queue from stdin or -f.
const QUEUES = new Set(["at", "batch"])

// rm's recursive option: -r or -R in a cluster, or --recursive by any prefix GNU rm takes (`--rec`).
const recursive = (v: string): boolean =>
  v.startsWith("--") ? v.length >= 3 && "--recursive".startsWith(v) : /^-[A-Za-z]*[rR]/.test(v)

// A recursive option anywhere in a text, as a brace's members spell one (`{rm,-rf,x}`).
const spellsRecursive = (v: string): boolean =>
  v.split(/[\s,{}]+/).some((part) => part.startsWith("-") && recursive(part))

// A word the shell may turn into other words: a variable, a substitution or a brace, or an unquoted glob.
const hidden = (word: Word): boolean =>
  unreadable(word) || (!word.quoted && /[*?[]/.test(word.value))

// A long option by any prefix git takes (`--forc`), its shortest unique one given.
const prefixOf = (v: string, option: string, shortest: number) =>
  v.length >= shortest && option.startsWith(v)

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

// How a command was reached: on its own, or as words another program runs (`nested`), whose plain rm the hook cannot place and so judges for recursion alone; `appends` when that program adds arguments.
type Reach = { appends: boolean; nested: boolean }
const OWN: Reach = { appends: false, nested: false }

function judgeRm(
  args: Word[],
  xargs: boolean,
  env: Env,
  roots: Roots,
  { nested }: Reach,
): string | undefined {
  if (xargs) return refuse("rm under xargs", "the hook cannot read the paths xargs hands it")
  let options = true
  const targets: Word[] = []
  for (const a of args) {
    if (options && a.value === "--") {
      options = false
      continue
    }
    const option = options && a.value.startsWith("-") && a.value !== "-"
    if (option && recursive(a.value)) return refuse(`a recursive rm (${a.value})`)
    // a variable may split into -r and any path, but a quoted one among another program's words stays one word (`docker rm "$ID"`); a brace may spell -r, and a glob in an option any option
    const spread = marked(a.value) && (!nested || !a.quoted)
    if (spread || (options && spellsRecursive(a.value)) || (option && hidden(a)))
      return refuse(
        `an rm with a word the hook cannot read (${shown(a)})`,
        "it may be -r or any path",
      )
    if (!option) targets.push(a)
  }
  if (nested) return
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
  const force = cluster("f") || words.some((v) => prefixOf(v, "--force", 3))
  // with or without force, since `-c clean.requireForce=false` or the repo's own config lets -d and -x delete without one
  if (sub?.value === "clean") {
    if (cluster("n") || words.some((v) => prefixOf(v, "--dry-run", 3))) return
    if (cluster("d") || cluster("x") || cluster("X"))
      return refuse(
        "git clean with -d or -x",
        "it deletes untracked folders or ignored files for good",
      )
  }
  if (sub?.value === "worktree" && words[0] === "remove" && force)
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
  const visitAs =
    (reach: Reach): Visit =>
    async (cmd, parsed, at) => {
      const { args, name } = parsed
      const verdict = await judge(cmd, parsed, at, reach)
      if (verdict) return verdict
      // a judged program named among another's words runs as that program, behind any runner
      if (!READERS.has(name) && !JUDGED.has(name))
        for (const [k, a] of args.entries()) {
          if (!JUDGED.has(program(a.value)) || hidden(a)) continue
          const found = await examine(
            { ...cmd, words: args.slice(k) },
            at,
            visitAs({ appends: APPENDS.has(name), nested: true }),
            false,
          )
          if (found) return found
        }
      if (isData(name)) return
      // a spaced word is read as a command line of its own, the text after an = and a leading ! too (`sh -c '…'` behind any wrapper); git's only command lines are its -c aliases' `!` values, so its messages and patterns stay text; a part it cannot read stays unread in the words it lands in
      const words =
        name === "git"
          ? gitCommand(args).aliases.flatMap((w) => /^alias\.[^=]*=!(.*)$/s.exec(w)?.[1] ?? [])
          : args.flatMap(({ value }) => [value, value.slice(value.indexOf("=") + 1)])
      for (const text of new Set(words.map((w) => w.replace(/^!/, "")))) {
        if (!/\s/.test(text)) continue
        const found = await line(text, at)
        if (found) return found
      }
    }
  const visit = visitAs(OWN)
  const judge = async (
    cmd: Command,
    parsed: Parsed,
    at: Env,
    reach: Reach,
  ): Promise<string | undefined> => {
    const { args, first, name, xargs } = parsed
    // a program word the hook cannot read (a variable, a brace, a glob) given -r, or given a word it cannot read either, may be a recursive rm
    if (
      first &&
      hidden(first) &&
      (spellsRecursive(first.value) ||
        args.some((a) => spellsRecursive(a.value) || (hidden(a) && !a.quoted)))
    )
      return refuse(`a program the hook cannot read (${shown(first)}) given -r`, "it may be rm")
    const slot = slotWords(parsed)
    if (slot) return examine({ ...cmd, words: slot }, at, visitAs(reach), false)
    if (RM.has(name)) return judgeRm(args, xargs !== undefined || reach.appends, at, roots, reach)
    if (name === "git") return judgeGit(args)
    if (name === "rimraf") return refuse("rimraf")
    if (name === "rsync" && args.some((a) => a.value.startsWith("--del")))
      return refuse("rsync --delete", "it deletes every file its source lacks, for good")
    if (name === "chflags")
      return refuse("chflags", "it lifts the flags that keep a file from deletion")
    if (name === "chmod" && args.some((a) => /^-[A-Za-z]*[aN]/.test(a.value)))
      return refuse("chmod -a or -N", "it strips the access entries that keep a file from deletion")
    const runs = RUNS[name]
    if (runs) {
      if (args.some((a) => a.value === "-delete")) return refuse(`${name} -delete`)
      for (const [k, a] of args.entries()) {
        if (!runs.has(a.value)) continue
        const end = args.findIndex((w, j) => j > k && (w.value === ";" || w.value === "+"))
        const words = args.slice(k + 1, end === -1 ? undefined : end)
        if (RM.has(parse({ ...cmd, words }).name))
          return refuse(`${name} ${a.value} rm`, `it deletes every path ${name} reaches`)
        const found = await examine(
          { ...cmd, words },
          at,
          visitAs({ appends: true, nested: true }),
          false,
        )
        if (found) return found
      }
    }
    if (QUEUES.has(name)) {
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

// The cheap first look: a name the hook judges, or a $, a backtick, a brace or a glob that can spell one.
const CANDIDATE =
  /rm|delete|chflags|chmod|clean|worktree|rimraf|screen|tmux|\bat\b|batch|\$|`|[{*?[]/

// A call that reads as a delete, which the hook refuses when it cannot read it.
const DELETES = /\bg?rm\b|-delete\b|\bchflags\b|\bchmod\b|\bclean\b|\bworktree\b|\brimraf\b|--del/

// The Bash command an input names, or undefined when the input does not parse as one.
function commandOf(raw: string): string | undefined {
  try {
    const command = (JSON.parse(raw) as { tool_input?: { command?: unknown } }).tool_input?.command
    return typeof command === "string" ? command : undefined
  } catch {
    return undefined
  }
}

// Fails closed only on a call that reads as a delete, a walk past its 10 s budget included, so a parser bug cannot block every Bash command.
export async function check(
  raw: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  try {
    return await withDeadline(10_000, async () => inspect(raw, environment))
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
