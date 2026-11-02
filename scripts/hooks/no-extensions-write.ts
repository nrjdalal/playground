// PreToolUse hook: refuses a factory session's write into the extensions root, where every guard's list, policy.json and each scope's sources live, and its playground CLI call that changes what a guard reads to allow or deny a call, so no session edits a list in one call and makes the guarded call in the next.
import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"

import { dataDir } from "../../packages/env/src/data-dir"
import { extensionsDir } from "../../packages/settings/src/rendered"
import { bunCall, FILE_TOOLS, gitCall, real } from "./no-main-checkout"
import { fromFactory } from "./role"
import {
  type Command,
  type Env,
  examine,
  filled,
  knownVariables,
  lex,
  marked,
  onlyReserved,
  ownFirst,
  parse,
  type Parsed,
  pathOf,
  PRINTERS,
  program,
  run,
  slotWords,
  stdinOf,
  stdinShell,
  type Text,
  tick,
  UNKNOWN,
  varsSince,
  type Visit,
  withDeadline,
  type Word,
} from "./shell"

type Environment = Record<string, string | undefined>

const ROUTE =
  "every guard reads its list and policy.json from there, so a session's write would change what a guard allows. A guard's list or setting changes only by the owner typing the playground command as a ! command in the dispatcher's terminal window, which runs without hooks: tell your lead, and the dispatcher hands the owner the command. A session writes nothing there by hand."

const refuse = (what: string) => `no-extensions-write hook refuses ${what}: ${ROUTE}`

const TOO_LONG =
  "a command too long or nested too deep to read inside the hook's time: split it into shorter calls"

// Programs that only read what they name; rg, find and git read only without the options below that run a program.
const READERS = new Set([
  "[",
  "cat",
  "cmp",
  "diff",
  "grep",
  "head",
  "jq",
  "ls",
  "readlink",
  "realpath",
  "shasum",
  "stat",
  "tail",
  "test",
  "wc",
])
// find's actions that write, remove or run
const FIND_ACTS = /^-(?:delete|exec|execdir|fls|fprint|fprint0|fprintf|ok|okdir)$/
const GIT_READS = new Set([
  "blame",
  "cat-file",
  "diff",
  "grep",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status",
])
// The builtins run() hands visit with no command of their own.
const EXPORTS = new Set(["declare", "export", "local", "readonly", "typeset"])
// Programs that remove or move what they name, so naming a folder above the root takes the root with it, and the guards fall back to core's smaller lists.
const REMOVERS = new Set(["find", "mv", "rm", "rmdir", "rsync", "unlink"])
const DUPLICATE = /^(?:\d+|-)$/
// Whether a redirect writes a file: >, >>, >|, <> or >& to a name, not an fd
const writer = ({ op, target }: { op: string; target?: Word }): boolean =>
  [">", ">>", ">|", "<>"].includes(op) || (op === ">&" && !DUPLICATE.test(target?.value ?? ""))
const GLOB = /[*?[{(]/
// Variables that make git or a pager run a program, so a reader with one set is judged as any other program.
const RUNS = /^(?:EDITOR|GIT_[A-Z_]+|LESSOPEN|PAGER|VISUAL)$/
const CLI = join("packages", "scripts", "src", "playground", "cli.ts")

// Whether a scope's variables set one that makes git or a pager run a program, each name read once.
const varsRun = new WeakMap<Map<string, Text>, [number, boolean]>()
function runsVariable(vars: Map<string, Text>): boolean {
  const [cursor, found] = varsRun.get(vars) ?? [undefined, false]
  const [keys, next] = varsSince(vars, cursor)
  const now = found || keys.some((key) => RUNS.test(key))
  varsRun.set(vars, [next, now])
  return now
}

// Whether a command only reads what it names: a reader with no option or variable that makes it run a program.
function reads(parsed: Parsed, env: Env): boolean {
  const { args, local, name } = parsed
  if ([...local.keys()].some((key) => RUNS.test(key)) || runsVariable(env.vars)) return false
  if (READERS.has(name) || PRINTERS.has(name)) return true
  if (name === "rg") return !args.some((a) => /^--(?:hostname-bin|pre)(?:=|$)/.test(a.value))
  if (name === "find") return !args.some((a) => FIND_ACTS.test(a.value))
  if (name !== "git") return false
  const { rest, sub } = gitCall(args, env)
  const before = args.slice(0, args.length - rest.length - 1).map((a) => a.value)
  return (
    !!sub &&
    GIT_READS.has(sub) &&
    !before.some((w) => w === "-c" || /^--(?:config-env|exec-path)/.test(w)) &&
    !rest.some((w) => /^(?:--output|-O|--open-files-in-pager|--ext-diff|--textconv)/.test(w))
  )
}

// The settings keys a guard reads to allow or deny a call, A to Z: the hooks' (no-chat-question, no-glm-heavy-path, no-headless-login, no-playground-leak, no-public-leak, and role.ts, which places a session in the factory), spawn.sh's code root, and ext.repos, which names the repository each scope syncs from.
export const GUARD_KEYS = new Set([
  "ext.links",
  "ext.order",
  "ext.repos",
  "factory.archiveRepo",
  "factory.publicRepo",
  "glm.readOnlyLoad5",
  "live.branch",
  "owner.names",
  "paths.codeRoot",
  "sessions.aliases",
  "sessions.names",
  "usage.keychainService",
])
// ext verbs that change a scope's lists or settings, or which scopes the lists and policy.json render from
const EXT_WRITES = new Set(["add", "import", "init", "link", "order", "remove", "sync", "unlink"])
// the ext verbs whose --dry-run writes nothing
const EXT_DRY = new Set(["add", "import", "init"])
// Each command's bare switches, as its parseWords call names them; every other -- word takes the next word as its value.
const SWITCHES: Record<string, string[]> = {
  ext: ["--dry-run", "--yes"],
  settings: ["--dry-run"],
}

// Whether a word is the playground CLI: the command by name in any case, as macOS's filesystem reads it, or by a path that is no folder, or the checkout's cli.ts, with or without its extension, links followed.
function isCli(word: Word, dirs: (string | undefined)[]): boolean {
  tick()
  if (marked(word.value) || word.value.startsWith("-")) return false
  const paths = dirs.map((dir) => pathOf(word, { cwd: dir } as Env))
  if (program(word.value).toLowerCase() === "playground")
    return (
      !word.value.includes("/") ||
      !paths.some((path) => !!path && existsSync(path) && statSync(path).isDirectory())
    )
  const cli = (sep + CLI).toLowerCase()
  return paths.some(
    (path) => !!path && [path, `${path}.ts`].some((at) => real(at).toLowerCase().endsWith(cli)),
  )
}

// The words after each word of a command that is the playground CLI, so the CLI behind any wrapper (bun, npx, find -exec, arch, watch) is read as typed bare.
function cliCalls(parsed: Parsed, env: Env): Word[][] {
  const { args, first, name } = parsed
  if (!first) return []
  const words = [first, ...args]
  const dirs = [env.cwd, name === "bun" ? bunCall(args, env).cwd : undefined]
  return words.flatMap((word, at) => (isCli(word, dirs) ? [words.slice(at + 1)] : []))
}

// The variables a score's author is read from (store.ts, terminalIo); an ext score whose line clears or sets one reads as another author.
const IDENTITY = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CONFIG_DIR", "PLAYGROUND_ROLE"]
const SETS = /^(?:CLAUDE_CODE_SESSION_ID|CLAUDE_CONFIG_DIR|PLAYGROUND_ROLE)\+?=/
// env's options that clear the whole environment: -i alone or in any cluster of short options, --ignore-environment, or a bare -
const CLEARS = /^(?:-[^-\s]*i|--ignore-environment$|-$)/
const SCORE = /\bext\s+score\b/
// the line's text as a shell it runs reads it: backslash-newlines, a $ before a quote, and every quote and backslash removed
const unquoted = (text: string) => text.replace(/\\\n|\$(?=["'])|["'\\]/g, "")
const SCORE_AS_OTHER = `playground ext score on a line that clears or sets ${IDENTITY.join(", ")}, which reads as another author than the calling session`

// Whether words clear or set an identity variable: an assignment or += to one, or env beside -u or --unset naming one or an option that clears the environment.
const changes = (words: Word[]): boolean =>
  words.some((w) => SETS.test(w.value)) ||
  (words.some((w) => program(w.value) === "env") &&
    words.some((w) => CLEARS.test(w.value) || IDENTITY.some((k) => w.value.includes(k))))

// Whether any command on a line, inside its groups and substitutions included, clears or sets an identity variable.
function changesIdentity(commands: Command[]): boolean {
  return commands.some(
    (cmd) =>
      changes(cmd.words) ||
      (!!cmd.inner && changesIdentity(cmd.inner())) ||
      [...cmd.words, ...cmd.redirects.flatMap((r) => (r.target ? [r.target] : []))].some(
        (word) => !!word.procs && changesIdentity(word.procs),
      ),
  )
}

// Whether a playground call, its words after the CLI word, is an ext score whose own command clears or sets an identity variable, or runs after the scope set or exported one, as a line a shell reads on its own does.
function scoreAsOther(words: Word[], cmd: Command, parsed: Parsed, env: Env): boolean {
  if (words[0]?.value !== "ext" || words[1]?.value !== "score") return false
  if (IDENTITY.some((k) => parsed.local.has(k) || env.vars.has(k))) return true
  const all = parsed.first ? [parsed.first, ...parsed.args] : parsed.args
  const at = cmd.words.indexOf(all[all.length - words.length - 1])
  return changes(at === -1 ? cmd.words : cmd.words.slice(0, at))
}

const AWKS = new Set(["awk", "gawk", "mawk", "nawk"])
// what lets an awk program run a command or write a file: system(), a | pipe, getline, a > redirect or an @ directive
const AWK_RUNS = /system|getline|[|>@]/

// awk's program words, or undefined when a program comes from a file or an option the hook does not know: -F and -v take a value, gawk's -e and --source a program, and the first other word is the program
function awkPrograms(words: Word[]): Word[] | undefined {
  const programs: Word[] = []
  for (let k = 0; k < words.length; k++) {
    const { value } = words[k]
    if (value === "--") return programs.length ? programs : words.slice(k + 1, k + 2)
    if (/^-[Fv]$/.test(value)) k++
    else if (/^-[Fv]./.test(value)) continue
    else if (value === "-e" || value === "--source") programs.push(words[++k] ?? { value: "" })
    else if (value.startsWith("--source=")) programs.push({ ...words[k], value: value.slice(9) })
    else if (value.startsWith("-")) return undefined
    else return programs.length ? programs : [words[k]]
  }
  return programs.length ? programs : undefined
}

// The lines an awk program runs, read whatever the line: each string literal of a program that can run a command or write a file
function programLines({ args, first }: Parsed, rooted: boolean): string[] {
  if (!AWKS.has(program(first?.value ?? "").toLowerCase())) return []
  return (awkPrograms(args) ?? [])
    .filter(({ value }) => rooted || AWK_RUNS.test(value))
    .flatMap(({ value }) => [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]))
}

// Whether a call is a closed-list reader whose quoted words are never a command line: awk, cat, cut, grep, head, sort, tail, uniq or wc, as its command's own first word, bare or by a system path, with no variable set in the call
function narrow(cmd: Command, env: Env): boolean {
  const parsed = parse(cmd)
  const { args, first, name } = parsed
  // a command of reserved words alone (`fi`, `done`) runs nothing; any other with no program read (`sudo -s`, a group) has its line read whole
  if (!first) {
    return (
      onlyReserved(cmd) &&
      cmd.redirects.length === 0 &&
      !cmd.inner &&
      !cmd.group &&
      parsed.local.size === 0
    )
  }
  if (!ownFirst(cmd, first) || marked(name)) return false
  if (!/^(?:\/(?:bin|opt\/homebrew\/bin|usr\/bin|usr\/local\/bin)\/)?[^/]+$/.test(first.value))
    return false
  const base = program(first.value).toLowerCase()
  if (AWKS.has(base)) {
    const programs = awkPrograms(args)
    return !!programs && programs.every(({ value }) => !marked(value) && !AWK_RUNS.test(value))
  }
  if (["cat", "grep", "head", "tail", "wc"].includes(base)) return reads(parsed, env)
  if (base === "cut") return true
  if (base === "sort") return !args.some(({ value }) => /^-[a-zA-Z]*o|^--./.test(value))
  if (base === "uniq")
    return args.filter(({ value }) => value === "-" || !value.startsWith("-")).length <= 1
  return false
}

// Whether a line holds a shell reading its script from stdin (`sudo -s`, `sh`) anywhere, its groups' and substitutions' included, which runs whatever a reader prints into it
function rooted(commands: Command[]): boolean {
  return commands.some(
    (cmd) =>
      !!stdinShell(cmd) ||
      (!!cmd.inner && rooted(cmd.inner())) ||
      [...cmd.words, ...cmd.redirects.flatMap((r) => (r.target ? [r.target] : []))].some(
        (word) => !!word.procs && rooted(word.procs),
      ),
  )
}

// Whether a line is read whole, as canary read it, every spaced text of every program but a reader a command line; a line is read call by call only when every command, its substitutions' included, is narrow and no redirect writes a file
function wholeLine(commands: Command[], env: Env): boolean {
  return commands.some((cmd) => {
    const words = [...cmd.words, ...cmd.redirects.flatMap((r) => (r.target ? [r.target] : []))]
    if (words.some((word) => word.procs && wholeLine(word.procs, env))) return true
    const writes = cmd.redirects.some((r) => writer(r) && r.target?.value !== "/dev/null")
    return writes || !narrow(cmd, env)
  })
}

// Every text of a variable the call sets or exports, and on a line read whole of every word, that holds a space, a leading ! dropped, each read as a command line of its own; `vars` is the scope's variables set since their lines were last read.
function runsOf(parsed: Parsed, vars: Text[], whole: boolean, rootLine: boolean): string[] {
  const { args, first, local } = parsed
  const values = [...local.values(), ...vars].flatMap((text) => (text.unknown ? [] : [text.value]))
  for (const word of whole ? (first ? [first, ...args] : args) : [])
    for (const text of texts(word)) {
      values.push(text.value.replace(/^!/, ""))
      // printf and echo -e print a \n as a line break, which a root shell runs as one
      if (rootLine) values.push(...text.value.split("\\n"))
    }
  values.push(...programLines(parsed, rootLine))
  return [...new Set(values)].filter((value) => /\s/.test(value) && !marked(value))
}

// What of a playground call changes what a guard reads, or undefined; its words split as that command's parseWords splits them, and a word the hook cannot read taken as the worst.
function cliWrite(words: Word[]): string | undefined {
  const [command, verb, ...rest] = words.map((w) => (marked(w.value) ? undefined : w.value))
  if (command === undefined)
    return words.length ? "playground with a command word it cannot read" : undefined
  if (command === "migrate") return "playground migrate, which seeds the lists and settings"
  if (command === "uninstall")
    return words.some((w) => w.value === "--purge")
      ? "playground uninstall --purge, which removes the data folder"
      : undefined
  const switches = SWITCHES[command]
  if (!switches) return
  if (verb === undefined) return `playground ${command} with a verb it cannot read`
  const unread = rest.includes(undefined)
  const positional: (string | undefined)[] = []
  let dry = false
  for (let k = 0; k < rest.length; k++) {
    const word = rest[k]
    if (word !== undefined && switches.includes(word)) dry ||= word === "--dry-run"
    else if (word?.startsWith("--")) k++
    else positional.push(word)
  }
  if (command === "settings") {
    if (verb !== "set" && verb !== "reset") return
    const key = positional[0]
    if (unread || key === undefined) return `playground settings ${verb} with a word it cannot read`
    return GUARD_KEYS.has(key)
      ? `playground settings ${verb} of ${key}, a key a guard reads`
      : undefined
  }
  if (verb === "accept")
    return "playground ext accept, the owner's own call, which the owner runs as `! env -u PLAYGROUND_ROLE playground ext accept …` in the dispatcher's terminal window, since the CLI refuses an accept with PLAYGROUND_ROLE set and that window carries one"
  if (verb === "put")
    return unread || positional[1] === "list"
      ? "playground ext put of a list, or with a word it cannot read, which may render into a guard's list"
      : undefined
  if (EXT_WRITES.has(verb) && !(dry && EXT_DRY.has(verb)))
    return `playground ext ${verb}, which changes what the guards' lists and policy.json render from`
}

// The texts a word may name a path by: the word, the value after an =, and the rest after a one-letter option (-o<path>, -C<dir>).
const texts = (word: Word): Word[] => {
  const v = word.value
  const out = [word]
  const eq = v.indexOf("=")
  if (eq > 0) out.push({ ...word, value: v.slice(eq + 1) })
  if (/^-[A-Za-z]./.test(v)) out.push({ ...word, value: v.slice(2) })
  return out
}

function inspect(raw: string, environment: Environment) {
  const { cwd, tool_input: toolInput, tool_name: tool } = JSON.parse(raw) as Record<string, unknown>
  const input = (toolInput ?? {}) as Record<string, unknown>
  const directory = typeof cwd === "string" ? cwd : undefined
  const root = real(extensionsDir(dataDir(environment)))
  const home = environment.HOME || homedir()
  const needle = root.startsWith(real(home) + sep) ? root.slice(real(home).length) : root
  const inRoot = (path: string | undefined) => {
    if (path === undefined) return false
    const at = real(path)
    return at === root || at.startsWith(root + sep)
  }
  // a folder that holds the root, but the filesystem's own root, which only a remover names to harm
  const above = (path: string | undefined, remover: boolean) => {
    if (path === undefined) return false
    const at = real(path)
    return at === sep ? remover : root.startsWith(at + sep)
  }
  const file = typeof tool === "string" ? input[FILE_TOOLS[tool]] : undefined
  if (typeof file === "string") {
    const expanded = /^~(?:\/|$)/.test(file) ? join(home, file.slice(1)) : file
    return inRoot(resolve(directory ?? "", expanded)) ? refuse(`a write to ${file}`) : undefined
  }
  if (tool !== "Bash") return
  const { command } = input
  if (typeof command !== "string") return
  // nesting makes the lexer's time grow with the square of the length, so a longer command could outlast the hook's timeout
  if (command.length > 131_072) return refuse(TOO_LONG)
  // the root's path from a cwd above it, which a script may name it by
  const relative = (env: Env) =>
    env.cwd && above(env.cwd, false) ? root.slice(real(env.cwd).length + 1) : undefined
  const holds = (value: string, env: Env) => {
    const near = relative(env)
    return value.includes(needle) || (!!near && value.includes(near))
  }
  // What a word of a program that is no reader names: a path in the root, a folder above it, a glob there, or the root's path in its text.
  const judged = new Map<string, string | undefined>()
  // literal: a closed-list reader's word on a line read call by call, whose quoted glob character is text the reader never expands
  const names = (word: Word, env: Env, remover: boolean, literal = false): string | undefined => {
    const quotedGlob = literal && !word.glob
    const key = `${remover}\0${quotedGlob}\0${env.cwd}\0${word.value}`
    if (!judged.has(key)) judged.set(key, judge(word, env, remover, quotedGlob))
    return judged.get(key)
  }
  const judge = (
    word: Word,
    env: Env,
    remover: boolean,
    quotedGlob: boolean,
  ): string | undefined => {
    tick()
    for (const text of texts(word)) {
      if (holds(text.value, env)) return `${root} in its text`
      const path = pathOf(text, env)
      if (inRoot(path)) return path
      if (above(path, remover)) return `${path}, which holds ${root}`
      const glob = GLOB.exec(text.value)
      if (glob && !quotedGlob && !marked(text.value)) {
        const dir = pathOf({ value: `${text.value.slice(0, glob.index)}x` }, env)
        const folder = dir && dirname(dir)
        if (folder && (inRoot(folder) || above(folder, true)))
          return `${text.value}, a glob in ${folder}`
      }
    }
  }
  const seen = new Set<string>()
  let whole = false
  let rootLine = false
  // where each scope's variables were read to for their lines, and judged to for each cwd and remover, so each variable is read once rather than once a command
  type Cursors = WeakMap<Map<string, Text>, Map<string, number>>
  const varsRead: Cursors = new WeakMap()
  const varsJudged: Cursors = new WeakMap()
  const since = (store: Cursors, vars: Map<string, Text>, key: string): Text[] => {
    const cursors = store.get(vars) ?? new Map<string, number>()
    store.set(vars, cursors)
    const [keys, next] = varsSince(vars, cursors.get(key))
    cursors.set(key, next)
    return keys.flatMap((k) => vars.get(k) ?? [])
  }
  const visit: Visit = async (cmd: Command, parsed, env) => {
    const slot = slotWords(parsed)
    if (slot)
      return slot.length === 0 ? undefined : examine({ ...cmd, words: slot }, env, visit, false)
    const { args, first, name, xargs } = parsed
    const into = cmd.redirects.find(
      (r) =>
        r.target &&
        writer(r) &&
        (inRoot(pathOf(r.target, env)) ||
          (GLOB.test(r.target.value) && !!names(r.target, env, true))),
    )
    if (into?.target) return refuse(`a write to ${pathOf(into.target, env)}`)
    // a reader is its command's own first word, so a wrapper's option value parse misread never stands in for one
    const reader = !rootLine && ownFirst(cmd, first) && reads(parsed, env)
    const fed = xargs ? await stdinOf(cmd, env) : undefined
    const stdinWords: Word[] = !fed
      ? []
      : fed.unknown
        ? [{ quoted: false, value: UNKNOWN }]
        : fed.value
            .split(/\s+/)
            .filter(Boolean)
            .map((value) => ({ quoted: false, value }))
    const calls = reader ? [] : cliCalls(parsed, env)
    const write =
      calls
        .map((words) => cliWrite(xargs?.replace ? words : [...words, ...stdinWords]))
        .find(Boolean) ??
      (calls.some((words) => scoreAsOther(words, cmd, parsed, env)) ? SCORE_AS_OTHER : undefined)
    if (write) return refuse(write)
    // a command with no program runs nothing that reads the environment, so only its own assignments count
    const vars = !reader && first ? since(varsRead, env.vars, "") : []
    // a root shell's stdin is its script, so one the hook cannot read is refused
    const script: string[] = []
    if (stdinShell(cmd) === "root") {
      const text = await stdinOf(cmd, env)
      if (text.unknown || marked(text.value))
        return refuse(
          `a root shell whose script (${text.unknown ?? "a value it cannot read"}) the hook cannot read; run its commands as calls of their own, with no root shell`,
        )
      script.push(text.value)
    }
    for (const raw of reader ? [] : [...script, ...runsOf(parsed, vars, whole, rootLine)]) {
      const line =
        xargs?.replace && fed ? filled(raw, xargs.replace, fed.unknown ? UNKNOWN : fed.value) : raw
      if (seen.has(line)) continue
      seen.add(line)
      const verdict = await run(lex(line, env.known), { ...env, vars: new Map() }, visit, true)
      if (verdict) return verdict
    }
    // a bare assignment or export with no command, or a reader: only its redirect writes, and a variable it sets is read where a command runs with it
    if (!first || EXPORTS.has(name) || reader) return
    // a program word the hook cannot read is named as such, so a refusal always names what runs
    const verb = name && !marked(name) ? name : "a program it cannot read"
    if (inRoot(env.cwd)) return refuse(`${verb} run inside ${root}`)
    if (name === "git" && inRoot(gitCall(args, env).cwd)) return refuse(`git on a clone in ${root}`)
    const remover = REMOVERS.has(name)
    const scope = since(varsJudged, env.vars, `${env.cwd}\0${remover}`)
    for (const value of [...parsed.local.values(), ...scope]) {
      const named = names({ ...value, quoted: false }, env, remover)
      if (named) return refuse(`${verb} with a variable on ${named}`)
    }
    const literal = !whole && narrow(cmd, env)
    for (const word of [first, ...args]) {
      const named = names(word, env, remover, literal)
      if (named) return refuse(`${verb} on ${named}`)
    }
    if (cmd.redirects.some((r) => r.body && holds(r.body.value, env)))
      return refuse(`${verb} with a script that names ${root}`)
    if (fed) {
      const named =
        !fed.unknown &&
        fed.value
          .split(/\s+/)
          .filter(Boolean)
          .map((value) => names({ quoted: false, value }, env, remover))
          .find(Boolean)
      if (named) return refuse(`${verb} under xargs on ${named}`)
    }
  }
  const known = knownVariables(command, environment, directory)
  const lexed = lex(command, known)
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known,
    process: environment,
    vars: new Map(),
  }
  // a line with a root shell is read whole with no reader spared, an awk program's strings its lines, since what a reader prints into the shell runs
  rootLine = rooted(lexed.commands)
  whole = rootLine || wholeLine(lexed.commands, env)
  // a line holding an ext score is refused whole once any command on it changes who the session reads as, so a shell it runs or pipes into carries the change
  if (SCORE.test(unquoted(command)) && changesIdentity(lexed.commands))
    return refuse(SCORE_AS_OTHER)
  return run(lexed, env, visit, true)
}

// Fails open: an error on any call lets it run, so a reader bug cannot block every Bash command or write; a RangeError, a stack overflow or the walk past its time, refuses.
export async function check(
  raw: string,
  environment: Environment = process.env,
  budget = 10_000,
): Promise<string | undefined> {
  try {
    return await withDeadline(budget, async () => inspect(raw, environment))
  } catch (error) {
    if (error instanceof RangeError) return refuse(TOO_LONG)
  }
}

// The check run in a Worker and refused when it has not answered by the main thread's timer, so no synchronous step (a regex, a copy) can hold the hook past its timeout; the bundle in bundled/ starts the worker's bundle beside it.
export async function guarded(
  raw: string,
  environment: Environment = process.env,
  wait = 12_000,
  url = new URL(
    `./no-extensions-write-worker.${import.meta.path.endsWith(".js") ? "js" : "ts"}`,
    import.meta.url,
  ).href,
): Promise<string | undefined> {
  const worker = new Worker(url)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Promise<string | undefined>((done) => {
        worker.onmessage = (event) => done(event.data)
        worker.onerror = () => done(undefined)
        worker.postMessage({ environment, raw })
      }),
      new Promise<string>((done) => {
        timer = setTimeout(() => done(refuse(TOO_LONG)), wait)
      }),
    ])
  } finally {
    clearTimeout(timer)
    worker.terminate()
  }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text()
  const reason = (await fromFactory(raw)) ? await guarded(raw) : undefined
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
