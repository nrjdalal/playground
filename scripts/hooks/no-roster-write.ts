// A check for a factory session: refuses an Edit, a Write or a shell write to the live roster, the data folder's roster.json, whose one writer is scripts/roster.ts (the roster rule), and lets every read run. guards.ts runs it on Bash and no-raw-wa's process on the file tools, so it has no main block of its own. A call that names the file where the hook cannot read whether it writes is refused, failing closed.
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, resolve } from "node:path"

import { dataDirOf } from "../../packages/env/src/data-dir"
import { eachInput } from "./codex"
import {
  knownVariables,
  lex,
  marked,
  places,
  program,
  run,
  type Env,
  type Visit,
  visible,
  type Word,
} from "./shell"

type Environment = Record<string, string | undefined>

const refuse = (what: string) =>
  `no-roster-write hook refuses ${what}: the live roster changes only through scripts/roster.ts (the roster rule), so every reader sees it whole. Write it with bun scripts/roster.ts set <name> <key>=<value>, and read it with cat, jq or grep.`

// Programs that only read the files they name, so the roster as their operand stays as it is.
const READERS = new Set([
  "[",
  "basename",
  "bat",
  "cat",
  "cmp",
  "diff",
  "dirname",
  "echo",
  "egrep",
  "fgrep",
  "file",
  "grep",
  "head",
  "jq",
  "less",
  "ls",
  "md5",
  "more",
  "printf",
  "readlink",
  "realpath",
  "rg",
  "sha256sum",
  "shasum",
  "stat",
  "tail",
  "test",
  "wc",
])

// Programs that place their operands at the last one, or into its folder: a copier only reads its sources, the rest move or link them too.
const PLACERS = new Set(["cp", "ditto", "install", "ln", "mv", "rsync"])
const COPIERS = new Set(["cp", "ditto", "rsync"])
// The placers whose -t or --target-directory names the folder they place into; rsync's -t keeps times.
const TARGET_FLAG = new Set(["cp", "install", "ln", "mv"])

// Programs that write every file operand they name, so an operand the hook cannot read is a write position.
const WRITERS = new Set([
  "dd",
  "install",
  "ln",
  "mv",
  "rm",
  "shred",
  "tee",
  "touch",
  "truncate",
  "unlink",
])

// Programs that run inline code the hook does not parse: code naming the roster runs only when it holds no write word (WRITE_WORDS).
const CODE_RUNNERS = new Set([
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
])

// A write in inline code: a write call, an open() for writing or appending, a rename, an unlink, a removal, a truncate, or a redirect's > (an arrow's => and a comparison's >= aside).
const WRITE_WORDS =
  /write|open\s*\((?:[^()]|\([^()]*\))*,\s*["'][^"']*[wa]|rename|unlink|\brm|truncate|(?<![=-])>(?!=)/i

// The live roster, as typed and as the data folder's links resolve, each in lower case, since macOS opens a path in any case.
const targetsOf = (environment: Environment): string[] => {
  const data = dataDirOf(environment)
  let real = data
  try {
    real = realpathSync(data)
  } catch {}
  return [...new Set([data, real].map((d) => resolve(d, "roster.json").toLowerCase()))]
}

const segments = (path: string) => resolve(path).toLowerCase().split("/").filter(Boolean)

// Whether a path, a glob's pattern when glob is set, may be the roster itself.
const isRoster = (path: string, targets: string[], glob = false) =>
  targets.some((target) => {
    const p = segments(path)
    const t = segments(target)
    if (p.length !== t.length) return glob && p.some((s) => s.includes("**"))
    return p.every((s, i) => (glob ? new Bun.Glob(s).match(t[i]!) : s === t[i]))
  })

// Whether a call's text names the roster, as its path or under .playground or $PLAYGROUND_DATA_DIR, whatever reads it.
const namesRoster = (text: string, targets: string[]) => {
  const plain = text.replace(/["'\\]/g, "").toLowerCase()
  return (
    targets.some((t) =>
      new RegExp(`${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`).test(plain),
    ) || /(?:\.playground|playground_data_dir\}?)\/+roster\.json(?![\w.-])/.test(plain)
  )
}

// A word as the shell runs it: one the lexer could not read is lexed again with the variables the call has set by then, else it stays unread.
const readOf = (word: Word, at: Env): { glob?: boolean; value: string } | undefined => {
  if (!marked(word.value)) return word
  if (!word.raw) return
  const known = { ...at.known }
  for (const [key, text] of at.vars) if (!marked(text.value)) known[key] = text.value
  // a substitution lexes as commands of its own, whose first word is never the word itself
  const { commands } = lex(word.raw, known)
  const again = commands.length === 1 ? commands[0]!.words[0] : undefined
  return again && !marked(again.value) ? again : undefined
}

// The literal text after a word's last expansion as written, quotes removed: `.md` for `brief-$name.md`, empty for `$F` or `"$(cmd)"`.
const tailOf = (source: string): string => {
  const text = source.replace(/["']/g, "")
  const at = text.lastIndexOf("$")
  if (at < 0) return text
  const rest = text.slice(at + 1)
  if (rest[0] === "{") return rest.slice(rest.indexOf("}") + 1)
  if (rest[0] === "(") return rest.slice(rest.lastIndexOf(")") + 1)
  return rest.replace(/^(?:\w+|[-@*#?$!])/, "")
}

const SEDS = new Set(["sed"])

// The programs this hook reads by name, each of which GNU also installs with a g before it
const KNOWN = new Set([...PLACERS, ...READERS, ...SEDS, ...WRITERS])

const shown = (word: Word) => word.source ?? visible(word.value)

// sed writes the files it names in place given -i or --in-place, and only reads them otherwise.
const inPlace = (args: Word[]) => args.some((a) => /^-[A-Za-z]*i|^--in-place/.test(a.value))

// A placer's destination: its -t folder where it takes one, else its last operand.
const destinationOf = (tool: string, args: Word[]): Word | undefined => {
  const t = TARGET_FLAG.has(tool)
    ? args.findIndex((a) => a.value === "-t" || a.value.startsWith("--target-directory"))
    : -1
  if (t >= 0) return args[t]!.value.includes("=") ? args[t] : args[t + 1]
  return args.filter((a) => !a.value.startsWith("-")).at(-1)
}

async function judgeBash(command: string, cwd: string | undefined, environment: Environment) {
  const targets = targetsOf(environment)
  const named = namesRoster(command, targets)
  const env: Env = {
    cwd,
    files: new Map(),
    known: knownVariables(command, environment, cwd),
    process: environment,
    vars: new Map(),
  }
  // Each word as a path it may name in each folder the shell may be in: undefined when the word is unread.
  const pathsOf = (typed: Word, at: Env): { glob: boolean; path: string }[] | undefined => {
    const word = readOf(typed, at)
    if (!word) return
    const out: { glob: boolean; path: string }[] = []
    for (const place of places(at))
      for (const raw of [word.value, word.value.slice(word.value.indexOf("=") + 1)]) {
        const value = /^~(?:\/|$)/.test(raw)
          ? `${environment.HOME || homedir()}${raw.slice(1)}`
          : raw
        const path = value.startsWith("/") ? value : place.cwd && resolve(place.cwd, value)
        if (path) out.push({ glob: !!word.glob, path })
      }
    return out
  }
  // A word unread in a write position (a redirect's target, a placer's destination, a writer's operand) may write the roster when the call names it and the text after its last expansion may end its path; an unread operand of any other program runs.
  const writes = (typed: Word, at: Env, position = false) => {
    const paths = pathsOf(typed, at)
    if (!paths) {
      const tail = tailOf(typed.source ?? typed.raw ?? "").toLowerCase()
      return position && named && targets.some((t) => t.endsWith(tail))
    }
    return paths.some(({ glob, path }) => isRoster(path, targets, glob))
  }
  const visit: Visit = async (cmd, { args, name }, at) => {
    for (const r of cmd.redirects)
      if (r.target && r.op.includes(">") && writes(r.target, at, true))
        return refuse(`a redirect onto ${shown(r.target)}`)
    const prog = program(name)
    if (!prog) return
    // GNU coreutils and sed under their g-prefixed names (gmv, gtee, gsed) run as the plain ones
    const tool = /^g./.test(prog) && KNOWN.has(prog.slice(1)) ? prog.slice(1) : prog
    if (
      CODE_RUNNERS.has(tool) &&
      args.some((a) => namesRoster(a.value, targets) && WRITE_WORDS.test(a.value))
    )
      return refuse(`${tool} code that names the roster and holds a write word`)
    if (PLACERS.has(tool)) {
      const dest = destinationOf(tool, args)
      if (dest && writes(dest, at, true)) return refuse(`${tool} onto ${shown(dest)}`)
      // a file named roster.json placed into the data folder lands on it
      const into = dest ? (pathsOf(dest, at) ?? []) : []
      const sources = args.filter((a) => a !== dest && !a.value.startsWith("-"))
      if (
        sources.some((s) => basename(s.value).toLowerCase() === "roster.json") &&
        into.some(({ path }) => isRoster(resolve(path, "roster.json"), targets))
      )
        return refuse(`${tool} of a roster.json into ${dest && shown(dest)}`)
      if (COPIERS.has(tool)) return
    }
    if (SEDS.has(tool)) {
      // a script naming the roster may write it (w, W, e, s///w with any address or delimiter), so it fails closed; the roster as an operand of its own is only read
      const script = (a: Word) =>
        namesRoster(a.source ?? a.value, targets) &&
        !(pathsOf(a, at) ?? []).some(({ glob, path }) => isRoster(path, targets, glob))
      if (args.some(script)) return refuse(`${tool} whose script names the roster`)
      if (!inPlace(args)) return
    }
    if (READERS.has(tool)) return
    const writer = WRITERS.has(tool) || SEDS.has(tool)
    for (const word of args)
      if (writes(word, at, writer)) return refuse(`${tool} on ${shown(word)}`)
  }
  return run(lex(command, env.known), env, visit, true)
}

const FILE_TOOLS = new Set(["Edit", "MultiEdit", "NotebookEdit", "Write"])

async function inspect(raw: string, environment: Environment) {
  const {
    cwd,
    tool_input: input,
    tool_name: tool,
  } = JSON.parse(raw) as {
    cwd?: unknown
    tool_input?: Record<string, unknown>
    tool_name?: unknown
  }
  const folder = typeof cwd === "string" ? cwd : undefined
  if (tool === "Bash" && typeof input?.command === "string")
    return judgeBash(input.command, folder, environment)
  if (typeof tool === "string" && FILE_TOOLS.has(tool)) {
    const path = input?.file_path ?? input?.notebook_path
    if (typeof path === "string" && isRoster(resolve(folder ?? "/", path), targetsOf(environment)))
      return refuse(`a ${tool} of ${path}`)
  }
}

// Fails closed: a call it cannot parse that names the roster is refused, and every other unread call runs.
export async function check(
  raw: string,
  environment: Environment = process.env,
): Promise<string | undefined> {
  try {
    return await eachInput(raw, "no-roster-write", (one) => inspect(one, environment))
  } catch {
    return namesRoster(raw, targetsOf(environment))
      ? refuse("a call naming the roster that it cannot read")
      : undefined
  }
}
