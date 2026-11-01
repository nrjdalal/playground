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
  knownVariables,
  lex,
  marked,
  parse,
  type Parsed,
  pathOf,
  PRINTERS,
  program,
  run,
  slotWords,
  stdinOf,
  tick,
  type Visit,
  withDeadline,
  UNKNOWN,
  type Word,
} from "./shell"

type Environment = Record<string, string | undefined>

const ROUTE =
  "every guard reads its list and policy.json from there, so a session's write would change what a guard allows. A guard's list or setting changes only by the owner typing the playground command in Ops' pane as a ! command, which runs without hooks; ask Ops, who asks the owner. A session writes nothing there by hand."

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
const GLOB = /[*?[{(]/
// Variables that make git or a pager run a program, so a reader with one set is judged as any other program.
const RUNS = /^(?:EDITOR|GIT_[A-Z_]+|LESSOPEN|PAGER|VISUAL)$/
const CLI = join("packages", "scripts", "src", "playground", "cli.ts")

// Whether a command only reads what it names: a reader with no option or variable that makes it run a program.
function reads(parsed: Parsed, env: Env): boolean {
  const { args, local, name } = parsed
  if ([...local.keys(), ...env.vars.keys()].some((key) => RUNS.test(key))) return false
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

// Programs that run a word as a shell line: arch's, concurrently's, find's -exec, flock's, npx's package, rsync's -e, screen's, script's -c, ssh's remote command and ProxyCommand, tmux's command and watch's; git runs its -c values (an alias, core.sshCommand, core.pager) and more, so all its words but a message are read too.
const RUNNERS = new Set([
  "arch",
  "concurrently",
  "find",
  "flock",
  "git",
  "npx",
  "rsync",
  "screen",
  "script",
  "ssh",
  "tmux",
  "watch",
])
// git's commit and tag keep a message as text, and no alias can take their names; an alias runs every word it gets, and a call that sets config may define one, so its message is read
const KEEPS_MESSAGE = new Set(["commit", "tag"])
const keepsMessage = (args: Word[], env: Env): boolean =>
  KEEPS_MESSAGE.has(gitCall(args, env).sub ?? "") &&
  !args.some(({ value }) => /^(?:-c|--config-env(?:=|$))/.test(value))
// git's commit or tag message at a word: the word after -m or --message, or one with the message attached
const messageAt = (words: Word[], at: number): string | undefined =>
  /^(?:-m|--message)$/.test(words[at - 1]?.value ?? "")
    ? words[at].value
    : /^(?:-m|--message=)./.test(words[at].value)
      ? words[at].value.replace(/^(?:-m|--message=)/, "")
      : undefined

// Every text of a variable the call sets or exports, or of a runner's word, that holds a space, a leading ! dropped, read as a command line of its own (a pager, GIT_SSH_COMMAND, a git alias, watch's line); any other program's quoted argument (awk's program) stays one word.
function runsOf(parsed: Parsed, env: Env): string[] {
  const { args, first, local, name } = parsed
  const values = [...local, ...env.vars].flatMap(([, text]) => (text.unknown ? [] : [text.value]))
  const words = !RUNNERS.has(name) ? [] : first ? [first, ...args] : args
  const keeps = name === "git" && keepsMessage(args, env)
  for (const [at, word] of words.entries()) {
    if (keeps && messageAt(words, at) !== undefined) continue
    for (const text of texts(word)) values.push(text.value.replace(/^!/, ""))
  }
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
  const names = (word: Word, env: Env, remover: boolean): string | undefined => {
    const key = `${remover}\0${env.cwd}\0${word.value}`
    if (!judged.has(key)) judged.set(key, judge(word, env, remover))
    return judged.get(key)
  }
  const judge = (word: Word, env: Env, remover: boolean): string | undefined => {
    tick()
    for (const text of texts(word)) {
      if (holds(text.value, env)) return `${root} in its text`
      const path = pathOf(text, env)
      if (inRoot(path)) return path
      if (above(path, remover)) return `${path}, which holds ${root}`
      const glob = GLOB.exec(text.value)
      if (glob && !marked(text.value)) {
        const dir = pathOf({ value: `${text.value.slice(0, glob.index)}x` }, env)
        const folder = dir && dirname(dir)
        if (folder && (inRoot(folder) || above(folder, true)))
          return `${text.value}, a glob in ${folder}`
      }
    }
  }
  const seen = new Set<string>()
  const visit: Visit = async (cmd: Command, parsed, env) => {
    const slot = slotWords(parsed)
    if (slot)
      return slot.length === 0 ? undefined : examine({ ...cmd, words: slot }, env, visit, false)
    const { args, first, name, xargs } = parsed
    const into = cmd.redirects.find(
      (r) =>
        r.target &&
        ([">", ">>", ">|", "<>"].includes(r.op) ||
          (r.op === ">&" && !DUPLICATE.test(r.target.value))) &&
        (inRoot(pathOf(r.target, env)) ||
          (GLOB.test(r.target.value) && !!names(r.target, env, true))),
    )
    if (into?.target) return refuse(`a write to ${pathOf(into.target, env)}`)
    const reader = !!first && reads(parsed, env)
    const fed = xargs ? await stdinOf(cmd, env) : undefined
    const stdinWords: Word[] = !fed
      ? []
      : fed.unknown
        ? [{ quoted: false, value: UNKNOWN }]
        : fed.value
            .split(/\s+/)
            .filter(Boolean)
            .map((value) => ({ quoted: false, value }))
    const write = reader
      ? undefined
      : cliCalls(parsed, env)
          .map((words) => cliWrite(xargs?.replace ? words : [...words, ...stdinWords]))
          .find(Boolean)
    if (write) return refuse(write)
    for (const raw of reader ? [] : runsOf(parsed, env)) {
      const line =
        xargs?.replace && fed
          ? raw.replaceAll(xargs.replace, fed.unknown ? UNKNOWN : fed.value)
          : raw
      if (seen.has(line)) continue
      seen.add(line)
      const verdict = await run(lex(line, env.known), { ...env, vars: new Map() }, visit, true)
      if (verdict) return verdict
    }
    // a git message is text, no line git runs, but one naming a gated call is refused all the same
    for (const message of name === "git" && !reader && keepsMessage(args, env)
      ? args.flatMap((_, at) => messageAt(args, at) ?? [])
      : []) {
      const write = lex(message, env.known)
        .commands.flatMap((cmd) => cliCalls(parse(cmd), env))
        .map((words) => cliWrite(words))
        .find(Boolean)
      if (write) return refuse(write)
    }
    // a bare assignment or export with no command, or a reader: only its redirect writes, and a variable it sets is read where a command runs with it
    if (!first || EXPORTS.has(name) || reader) return
    // a program word the hook cannot read is named as such, so a refusal always names what runs
    const verb = name && !marked(name) ? name : "a program it cannot read"
    if (inRoot(env.cwd)) return refuse(`${verb} run inside ${root}`)
    if (name === "git" && inRoot(gitCall(args, env).cwd)) return refuse(`git on a clone in ${root}`)
    const remover = REMOVERS.has(name)
    for (const value of [...parsed.local.values(), ...env.vars.values()]) {
      const named = names({ ...value, quoted: false }, env, remover)
      if (named) return refuse(`${verb} with a variable on ${named}`)
    }
    for (const word of [first, ...args]) {
      const named = names(word, env, remover)
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
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known: knownVariables(command, environment, directory),
    process: environment,
    vars: new Map(),
  }
  return run(lex(command, env.known), env, visit, true)
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

// The check run in a Worker and refused when it has not answered by the main thread's timer, so no synchronous step (a regex, a copy) can hold the hook past its timeout.
export async function guarded(
  raw: string,
  environment: Environment = process.env,
  wait = 12_000,
  url = new URL("./no-extensions-write-worker.ts", import.meta.url).href,
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
