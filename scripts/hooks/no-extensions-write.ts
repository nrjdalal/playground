// PreToolUse hook: refuses a factory session's write into the extensions root, where every guard's list, policy.json and each scope's sources live, and its playground CLI call that changes what a guard reads to allow or deny a call, so no session edits a list in one call and makes the guarded call in the next.
import { resolve, sep } from "node:path"

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
  pathOf,
  run,
  slotWords,
  type Visit,
  type Word,
} from "./shell"

type Environment = Record<string, string | undefined>

const ROUTE =
  "every guard reads its list and policy.json from there, so a session's write would change what a guard allows. A guard's list or setting changes only by the owner typing the playground command in Ops' pane as a ! command, which runs without hooks; ask Ops, who asks the owner. A session writes nothing there by hand."

const refuse = (what: string) => `no-extensions-write hook refuses ${what}: ${ROUTE}`

// Programs that only read what they name.
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
  "rg",
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
// Programs that remove or move what they name, so naming a folder above the root takes the root with it, and the guards fall back to core's smaller lists.
const REMOVERS = new Set(["find", "mv", "rm", "rmdir", "rsync", "unlink"])
// Programs whose script text can name the root inside one word.
const INTERPRETERS = new Set([
  "awk",
  "bun",
  "deno",
  "gawk",
  "node",
  "osascript",
  "perl",
  "php",
  "python",
  "python3",
  "ruby",
  "sed",
])
const DUPLICATE = /^(?:\d+|-)$/

function reads(name: string, args: Word[], env: Env): boolean {
  if (READERS.has(name)) return true
  if (name === "find") return !args.some((a) => FIND_ACTS.test(a.value))
  if (name !== "git") return false
  const { rest, sub } = gitCall(args, env)
  return !!sub && GIT_READS.has(sub) && !rest.some((w) => w.startsWith("--output"))
}

// The settings keys a guard reads to allow or deny a call, A to Z (no-chat-question, no-glm-heavy-path, no-headless-login, no-playground-leak, no-public-leak).
const GUARD_KEYS = new Set([
  "ext.links",
  "factory.archiveRepo",
  "factory.publicRepo",
  "glm.readOnlyLoad5",
  "owner.names",
  "usage.keychainService",
])
// ext verbs that change a scope's lists or settings, or which scopes the lists and policy.json render from
const EXT_WRITES = new Set(["add", "import", "init", "link", "order", "remove", "sync", "unlink"])
// the ext verbs whose --dry-run writes nothing
const EXT_DRY = new Set(["add", "import", "init"])
const SWITCHES = new Set(["--dry-run", "--yes"])

// The words after the playground CLI, however it is called: by name or path, or bun running its cli.ts.
function cliWords(name: string, args: Word[], env: Env): Word[] | undefined {
  if (name === "playground") return args
  if (name !== "bun") return
  const { at, words } = bunCall(args, env)
  const target = words[0] === "run" ? words[1] : words[0]
  return target?.endsWith("playground/cli.ts") ? args.slice(at + 1) : undefined
}

// What of a playground call changes what a guard reads, or undefined; its options split as the CLI's parseWords splits them, a word the hook cannot read taken as the worst.
function cliWrite(words: Word[]): string | undefined {
  const [command, verb, ...rest] = words.map((w) => (marked(w.value) ? undefined : w.value))
  if (command === undefined)
    return words.length ? "playground with a command word it cannot read" : undefined
  if (command === "migrate") return "playground migrate, which seeds the lists and settings"
  if (command === "uninstall")
    return words.some((w) => w.value === "--purge")
      ? "playground uninstall --purge, which removes the data folder"
      : undefined
  if (command !== "ext" && command !== "settings") return
  const positional: (string | undefined)[] = []
  let dry = false
  for (let k = 0; k < rest.length; k++) {
    const word = rest[k]
    if (word !== undefined && SWITCHES.has(word)) dry ||= word === "--dry-run"
    else if (word?.startsWith("--")) k++
    else positional.push(word)
  }
  if (command === "settings") {
    if (verb !== "set" && verb !== "reset") return
    const key = positional[0]
    return key === undefined || GUARD_KEYS.has(key)
      ? `playground settings ${verb} of ${key ?? "a key it cannot read"}, a key a guard reads`
      : undefined
  }
  if (verb === undefined) return "playground ext with a verb it cannot read"
  if (verb === "put")
    return positional[1] === "list" || (positional[1] === undefined && positional.length > 1)
      ? "playground ext put of a list, which renders into a guard's list"
      : undefined
  if (EXT_WRITES.has(verb) && !(dry && EXT_DRY.has(verb)))
    return `playground ext ${verb}, which changes what the guards' lists and policy.json render from`
}

function inspect(raw: string, environment: Environment) {
  const { cwd, tool_input: toolInput, tool_name: tool } = JSON.parse(raw) as Record<string, unknown>
  const input = (toolInput ?? {}) as Record<string, unknown>
  const directory = typeof cwd === "string" ? cwd : undefined
  const root = real(extensionsDir(dataDir(environment)))
  const home = environment.HOME
  const needle = home && root.startsWith(real(home) + sep) ? root.slice(real(home).length) : root
  const inRoot = (path: string | undefined) => {
    if (path === undefined) return false
    const at = real(path)
    return at === root || at.startsWith(root + sep)
  }
  const above = (path: string | undefined) => {
    if (path === undefined) return false
    const at = real(path)
    return at === sep || root.startsWith(at + sep)
  }
  const file = typeof tool === "string" ? input[FILE_TOOLS[tool]] : undefined
  if (typeof file === "string")
    return inRoot(resolve(directory ?? "", file)) ? refuse(`a write to ${file}`) : undefined
  if (tool !== "Bash") return
  const { command } = input
  if (typeof command !== "string") return
  const visit: Visit = async (cmd: Command, parsed, env) => {
    const slot = slotWords(parsed)
    if (slot)
      return slot.length === 0 ? undefined : examine({ ...cmd, words: slot }, env, visit, false)
    const { args, name } = parsed
    const into = cmd.redirects.find(
      (r) =>
        r.target &&
        ([">", ">>", ">|", "<>"].includes(r.op) ||
          (r.op === ">&" && !DUPLICATE.test(r.target.value))) &&
        inRoot(pathOf(r.target, env)),
    )
    if (into?.target) return refuse(`a write to ${pathOf(into.target, env)}`)
    const cli = cliWords(name, args, env)
    const write = cli && cliWrite(cli)
    if (write) return refuse(write)
    if (reads(name, args, env)) return
    if (inRoot(env.cwd)) return refuse(`${name} run inside ${root}`)
    if (name === "git" && inRoot(gitCall(args, env).cwd)) return refuse(`git on a clone in ${root}`)
    for (const word of args) {
      const eq = word.value.indexOf("=")
      const paths = [pathOf(word, env)]
      if (eq > 0) paths.push(pathOf({ ...word, value: word.value.slice(eq + 1) }, env))
      const named = paths.find(inRoot)
      if (named) return refuse(`${name} on ${named}`)
      const holder = REMOVERS.has(name) && paths.find(above)
      if (holder) return refuse(`${name} on ${holder}, which holds ${root}`)
    }
    if (
      INTERPRETERS.has(name) &&
      [...args, ...cmd.redirects.flatMap((r) => (r.body ? [r.body] : []))].some((t) =>
        t.value.includes(needle),
      )
    )
      return refuse(`${name} with a script that names ${root}`)
  }
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known: knownVariables(command, environment, directory),
    process: environment,
    vars: new Map(),
  }
  return run(lex(command, env.known), env, visit)
}

// Fails open: an error on any call lets it run, so a reader bug cannot block every Bash command or write.
export async function check(
  raw: string,
  environment: Environment = process.env,
): Promise<string | undefined> {
  try {
    return await inspect(raw, environment)
  } catch {
    return
  }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text()
  const reason = (await fromFactory(raw)) ? await check(raw) : undefined
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
