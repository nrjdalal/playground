// The Bash reader the PreToolUse hooks share: it lexes a command and walks it as the shell would run it, reading the heredocs, files and substitutions it can see and marking the rest unknown.
import { homedir } from "node:os"
import { basename, isAbsolute, resolve } from "node:path"

// `variable` names the first shell variable a text expands, so a hook can tell `"$HERDR_BIN_PATH"` from any other unknown program.
export type Text = { reads?: Text[]; unknown?: string; value: string; variable?: string }
export type Word = Text & { proc?: Command; quoted: boolean }
type Redirect = { body?: Text; fd: string; op: string; target?: Word }
export type Command = {
  detached?: boolean
  group?: boolean
  redirects: Redirect[]
  scope: number
  stdin?: Command
  words: Word[]
}
type Lexer = {
  commands: Command[]
  i: number
  known: Record<string, string>
  scope: number
  scopes: number[]
  src: string
}
type Lexed = { commands: Command[]; scopes: number[] }
type Pending = { delim: string; quoted: boolean; redirect: Redirect; strip: boolean }
export type Env = {
  cwd?: string
  files: Map<string, Text>
  known: Record<string, string>
  process: Record<string, string | undefined>
  vars: Map<string, Text>
}
export type Flag = { name: string; value?: Word }
export type Field = { key: string; text: Text }
export type ApiRequest = { endpoint: Word; fields: Field[]; inputs: Text[]; method: string }

// Marks the part of a word the shell fills in at run time, which the hook cannot know.
export const UNKNOWN = "\u0000"
// Marks where a `$(cat file)` puts a file's text; Text.reads lists those files in order.
export const READ = "\u0001"
// A refusal stops the whole Bash call, so a reason for a value the hook cannot read ends with this.
export const NOT_RUN =
  "The refusal stopped this whole Bash call, so none of its commands ran: once it is fixed, run again each one you still need."
const MAX_BYTES = 1_048_576

const BREAK = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"])
const REDIRECT = /^(\d*|&)(<<<|<<-|<<|<>|<&|>&|>>|>\||<|>)/
const RESERVED = new Set([
  "!",
  "{",
  "}",
  "coproc",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "if",
  "then",
  "until",
  "while",
])
// The words that close a compound command, whose output the hook does not follow.
const GROUPING = new Set(["}", "done", "esac", "fi"])
export const ASSIGN = /^[A-Za-z_]\w*=/
const WRAPPERS = new Map<string, Set<string>>([
  ["builtin", new Set()],
  ["caffeinate", new Set(["-t", "-w"])],
  ["command", new Set()],
  ["doas", new Set(["-u"])],
  ["env", new Set(["-P", "-S", "-u", "--unset"])],
  ["exec", new Set(["-a"])],
  ["nice", new Set(["-n", "--adjustment"])],
  ["nocorrect", new Set()],
  ["noglob", new Set()],
  ["nohup", new Set()],
  ["repeat", new Set()],
  ["stdbuf", new Set(["-e", "-i", "-o"])],
  ["sudo", new Set(["-C", "-D", "-g", "-h", "-p", "-R", "-r", "-T", "-t", "-U", "-u"])],
  ["time", new Set()],
  ["timeout", new Set(["-k", "--kill-after", "-s", "--signal"])],
  ["xargs", new Set(["-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s"])],
])
// Wrappers that take one positional argument (a count or a duration) before the command.
const COUNTED = new Set(["repeat", "timeout"])
export const SHELLS = new Set(["bash", "dash", "ksh", "sh", "zsh"])
const EXPORTS = new Set(["declare", "export", "local", "readonly", "typeset"])
export const PRINTERS = new Set(["echo", "printf"])

const API_FIELDS = new Set(["-F", "--field", "-f", "--raw-field"])
const API_TAKES = new Set([
  ...API_FIELDS,
  "--cache",
  "-H",
  "--header",
  "--hostname",
  "--input",
  "-p",
  "--preview",
  "-q",
  "--jq",
  "-t",
  "--template",
  "-X",
  "--method",
])
const CURL_DATA = new Set([
  "-d",
  "--data",
  "--data-ascii",
  "--data-binary",
  "--data-raw",
  "--data-urlencode",
  "-F",
  "--form",
  "--form-string",
  "--json",
  "-T",
  "--upload-file",
])
export const CURL_TAKES = new Set([
  ...CURL_DATA,
  "-A",
  "--user-agent",
  "-b",
  "--cookie",
  "-c",
  "--cookie-jar",
  "-D",
  "--dump-header",
  "-e",
  "--referer",
  "-H",
  "--header",
  "-K",
  "--config",
  "-m",
  "--max-time",
  "-o",
  "--output",
  "-u",
  "--user",
  "--url",
  "-w",
  "--write-out",
  "-X",
  "--request",
  "-x",
  "--proxy",
])
const ESCAPES: Record<string, string> = {
  '"': '"',
  "'": "'",
  "?": "?",
  "\\": "\\",
  a: "\x07",
  b: "\b",
  E: "\x1b",
  e: "\x1b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
}

export const unknown = (why: string): Text => ({ unknown: why, value: UNKNOWN })

const merge = (out: Text, part: Text): void => {
  out.value += part.value
  if (part.unknown) out.unknown ??= part.unknown
  if (part.variable) out.variable ??= part.variable
  if (part.reads?.length) (out.reads ??= []).push(...part.reads)
}

const join = (parts: Text[], separator = ""): Text => {
  const out: Text = { value: "" }
  parts.forEach((part, k) => {
    if (k > 0) out.value += separator
    merge(out, part)
  })
  return out
}

export const slice = (word: Word, from: number): Word => {
  const dropped = word.value.slice(0, from).split(READ).length - 1
  return { ...word, reads: word.reads?.slice(dropped), value: word.value.slice(from) }
}

export const visible = (value: string): string =>
  value.replaceAll(UNKNOWN, " ").replaceAll(READ, " ")

export const marked = (value: string): boolean => value.includes(UNKNOWN) || value.includes(READ)

export const program = (value: string): string => basename(value.replace(/^=/, ""))

// uv's and uvx's options that take the next word as their value, so the word after is not the program
export const UV_TAKES = new Set([
  "--cache-dir",
  "--config-file",
  "--directory",
  "--env-file",
  "--extra",
  "--extra-index-url",
  "--from",
  "--group",
  "--index",
  "--index-url",
  "--package",
  "--project",
  "-p",
  "--python",
  "--with",
  "--with-editable",
  "--with-requirements",
])

const PYTHON = /^python(?:\d+(?:\.\d+)*)?$/
// The module a `python -m <module>` runs and the words after it, or undefined for any other command.
export function pythonModule(
  name: string,
  args: Word[],
): { module: string; rest: Word[] } | undefined {
  if (!PYTHON.test(name)) return
  const at = args.findIndex((a) => a.value === "-m")
  const module = at === -1 ? undefined : args[at + 1]
  return module && { module: module.value, rest: args.slice(at + 2) }
}

// Expands the backslash escapes of $'...', echo and printf.
function decode(raw: string): string {
  return raw.replace(
    /\\(?:x([\da-fA-F]{1,2})|u([\da-fA-F]{1,4})|U([\da-fA-F]{1,8})|0?([0-7]{1,3})|([\s\S]))/g,
    (whole, hex?: string, u4?: string, u8?: string, octal?: string, other?: string) => {
      const point =
        hex || u4 || u8
          ? Number.parseInt(hex ?? u4 ?? u8 ?? "", 16)
          : Number.parseInt(octal ?? "", 8)
      if (!Number.isNaN(point)) return point <= 0x10ffff ? String.fromCodePoint(point) : whole
      return ESCAPES[other ?? ""] ?? whole
    },
  )
}

export function lex(src: string, known: Record<string, string> = {}): Lexed {
  const lx: Lexer = { commands: [], i: 0, known, scope: 0, scopes: [-1], src }
  list(lx, 0, false)
  return { commands: lx.commands, scopes: lx.scopes }
}

// A subshell or a substitution is a scope of its own, so a cd inside it stays inside it.
function nest(lx: Lexer, inherit?: Command): void {
  list(lx, lx.scopes.push(lx.scope) - 1, true, inherit)
}

function list(lx: Lexer, scope: number, nested: boolean, inherit?: Command): void {
  const outer = lx.scope
  lx.scope = scope
  try {
    walk(lx, scope, nested, inherit)
  } finally {
    lx.scope = outer
  }
}

function walk(lx: Lexer, scope: number, nested: boolean, inherit?: Command): void {
  const { src } = lx
  const pending: Pending[] = []
  const fresh = (): Command => ({ redirects: [], scope, stdin: inherit, words: [] })
  let cmd = fresh()
  // A pipeline's commands and a backgrounded one run in subshells: a cd there leaves the shell where it was.
  const end = (op: string) => {
    const done = cmd
    const pipe = op === "|" || op === "|&"
    if (pipe || op === "&") done.detached = true
    if (done.words.length > 0 || done.redirects.length > 0 || done.group) lx.commands.push(done)
    cmd = fresh()
    if (pipe) {
      cmd.stdin = done
      cmd.detached = true
    }
  }
  while (lx.i < src.length) {
    const c = src[lx.i]
    const redirect = REDIRECT.exec(src.slice(lx.i, lx.i + 8))
    if (c === " " || c === "\t") lx.i++
    else if (c === "\\" && src[lx.i + 1] === "\n") lx.i += 2
    else if (c === "\n") {
      lx.i++
      heredocs(lx, pending, nested)
      end(";")
    } else if (c === "#") {
      while (lx.i < src.length && src[lx.i] !== "\n") lx.i++
    } else if (c === ")") {
      lx.i++
      end(";")
      if (nested) return
    } else if (c === "(") {
      lx.i++
      const piped = cmd.words.length === 0 && cmd.redirects.length === 0 ? cmd.stdin : undefined
      end(";")
      nest(lx, piped)
      cmd.group = true
    } else if ((c === "<" || c === ">") && src[lx.i + 1] === "(") {
      cmd.words.push(procSub(lx))
    } else if (redirect) {
      lx.i += redirect[0].length
      while (src[lx.i] === " " || src[lx.i] === "\t") lx.i++
      const [, fd, op] = redirect
      const target = src.startsWith("<(", lx.i) ? procSub(lx) : word(lx)
      const entry: Redirect = { fd, op, target }
      if (op === "<<" || op === "<<-") {
        pending.push({
          delim: target.value,
          quoted: target.quoted,
          redirect: entry,
          strip: op === "<<-",
        })
      } else if (op === "<<<") entry.body = { ...target, value: `${target.value}\n` }
      cmd.redirects.push(entry)
    } else if (c === ";" || c === "&" || c === "|") {
      const two = src.slice(lx.i, lx.i + 2)
      const op = ["&&", ";;", "|&", "||"].includes(two) ? two : c
      lx.i += op.length
      end(op)
    } else {
      const from = lx.i
      cmd.words.push(word(lx))
      if (lx.i === from) lx.i++
    }
  }
  heredocs(lx, pending, nested)
  end(";")
}

// A process substitution, carrying its last command so a shell that reads it as a script can read that command's output.
function procSub(lx: Lexer): Word {
  lx.i += 2
  const from = lx.commands.length
  nest(lx)
  return {
    proc: lx.commands.slice(from).at(-1),
    quoted: false,
    ...unknown("a process substitution"),
  }
}

function heredocs(lx: Lexer, pending: Pending[], nested: boolean): void {
  for (const doc of pending.splice(0)) {
    const lines: string[] = []
    while (lx.i < lx.src.length) {
      const start = lx.i
      const newline = lx.src.indexOf("\n", start)
      const stop = newline === -1 ? lx.src.length : newline
      const raw = lx.src.slice(start, stop)
      const line = doc.strip ? raw.replace(/^\t+/, "") : raw
      lx.i = stop + 1
      if (line === doc.delim) break
      // bash 3.2 ends a heredoc inside $( ) at `EOF)`, leaving the `)` to close the substitution.
      if (nested && line.startsWith(`${doc.delim})`)) {
        lx.i = start + raw.length - line.length + doc.delim.length
        break
      }
      lines.push(line)
    }
    const body = lines.map((line) => `${line}\n`).join("")
    doc.redirect.body = doc.quoted ? { value: body } : expandHeredoc(body)
  }
}

function expandHeredoc(body: string): Text {
  const joined = body.replaceAll("\\\n", "")
  const value = joined.replace(/\\([\\$`])/g, "$1")
  return /\$[\w{(@*#?!$-]|`/.test(joined.replace(/\\[\\$`]/g, ""))
    ? { unknown: "an expansion in an unquoted heredoc", value }
    : { value }
}

function word(lx: Lexer): Word {
  const { src } = lx
  const start = lx.i
  const out: Word = { quoted: false, value: "" }
  let bare = ""
  while (lx.i < src.length && !BREAK.has(src[lx.i])) {
    const c = src[lx.i]
    const next = src[lx.i + 1] ?? ""
    if (c === "\\") {
      out.quoted = true
      if (next !== "\n") out.value += next
      lx.i += 2
    } else if (c === "'") {
      out.quoted = true
      const close = src.indexOf("'", lx.i + 1)
      const stop = close === -1 ? src.length : close
      out.value += src.slice(lx.i + 1, stop)
      lx.i = stop + 1
    } else if (c === '"') {
      out.quoted = true
      lx.i++
      merge(out, double(lx))
    } else if (c === "$" && next === "'") {
      out.quoted = true
      merge(out, ansi(lx))
    } else if (c === "$" && next === '"') lx.i++
    else if (c === "$") merge(out, dollar(lx))
    else if (c === "`") merge(out, backtick(lx))
    else if (c === "~" && lx.i === start && (next === "" || next === "/" || BREAK.has(next))) {
      out.value += homedir()
      lx.i++
    } else {
      out.value += c
      bare += c
      lx.i++
    }
  }
  if (/\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(bare)) out.unknown ??= "a brace expansion"
  return out
}

function double(lx: Lexer): Text {
  const { src } = lx
  const out: Text = { value: "" }
  while (lx.i < src.length && src[lx.i] !== '"') {
    const c = src[lx.i]
    const next = src[lx.i + 1] ?? ""
    if (c === "\\") {
      if (next !== "\n") out.value += '$`"\\'.includes(next) ? next : c + next
      lx.i += 2
    } else if (c === "$") merge(out, dollar(lx))
    else if (c === "`") merge(out, backtick(lx))
    else {
      out.value += c
      lx.i++
    }
  }
  lx.i++
  return out
}

function ansi(lx: Lexer): Text {
  const { src } = lx
  let i = lx.i + 2
  while (i < src.length && src[i] !== "'") i += src[i] === "\\" ? 2 : 1
  const raw = src.slice(lx.i + 2, Math.min(i, src.length))
  lx.i = i + 1
  return { value: decode(raw) }
}

function dollar(lx: Lexer): Text {
  const { src } = lx
  const next = src[lx.i + 1] ?? ""
  const variable = (name: string | undefined): Text =>
    name !== undefined && lx.known[name] !== undefined
      ? { value: lx.known[name], variable: name }
      : { ...unknown("a shell variable"), variable: name }
  if (src.startsWith("$((", lx.i)) {
    const end = balanced(src, lx.i + 1, "(", ")")
    inner(lx, src.slice(lx.i + 3, end - 2))
    lx.i = end
    return unknown("an arithmetic expansion")
  }
  if (next === "(") {
    lx.i += 2
    const from = lx.commands.length
    nest(lx)
    return substituted(lx.commands.slice(from))
  }
  if (next === "{") {
    const end = balanced(src, lx.i + 1, "{", "}")
    const name = /^\$\{([A-Za-z_]\w*)\}$/.exec(src.slice(lx.i, end))?.[1]
    inner(lx, src.slice(lx.i + 2, end - 1))
    lx.i = end
    return variable(name)
  }
  if (/[A-Za-z_]/.test(next)) {
    const from = ++lx.i
    while (/\w/.test(src[lx.i] ?? "")) lx.i++
    return variable(src.slice(from, lx.i))
  }
  if (/[\d@*#?$!-]/.test(next)) {
    lx.i += 2
    return unknown("a shell variable")
  }
  lx.i++
  return { value: "$" }
}

// Lexes an expansion's own text for the substitutions in it, so their commands are read.
function inner(lx: Lexer, src: string): void {
  const sub = { ...lx, i: 0, src }
  while (sub.i < src.length) {
    const from = sub.i
    word(sub)
    if (sub.i === from) sub.i++
  }
}

function balanced(src: string, from: number, open: string, close: string): number {
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (c === "\\") i++
    else if (c === "'") {
      const end = src.indexOf("'", i + 1)
      i = end === -1 ? src.length : end
    } else if (c === open) depth++
    else if (c === close && --depth === 0) return i + 1
  }
  return src.length
}

function backtick(lx: Lexer): Text {
  const { src } = lx
  let i = lx.i + 1
  let inner = ""
  while (i < src.length && src[i] !== "`") {
    if (src[i] === "\\" && i + 1 < src.length) {
      inner += "$`\\".includes(src[i + 1]) ? src[i + 1] : src[i] + src[i + 1]
      i += 2
    } else inner += src[i++]
  }
  lx.i = i + 1
  list({ ...lx, i: 0, src: inner }, lx.scopes.push(lx.scope) - 1, false)
  return unknown("a command substitution")
}

// `$(cat <<'EOF' ... EOF)`, `$(cat file)` and `$(< file)` are read; any other command substitution is unknown.
function substituted(inner: Command[]): Text {
  const [only] = inner
  if (inner.length !== 1 || only.stdin || only.group) return unknown("a command substitution")
  const [first, ...args] = only.words
  const plainCat = first?.value === "cat" && !first.unknown && !first.reads?.length
  const input = only.redirects[0]
  if (only.redirects.length === 1 && input.body && plainCat && args.length === 0) {
    return input.body.unknown
      ? input.body
      : { ...input.body, value: input.body.value.replace(/\n+$/, "") }
  }
  if (
    only.redirects.length === 0 &&
    plainCat &&
    args.length === 1 &&
    !args[0].value.startsWith("-")
  ) {
    return { reads: [args[0]], value: READ }
  }
  if (only.words.length === 0 && only.redirects.length === 1 && input.op === "<" && input.target) {
    return { reads: [input.target], value: READ }
  }
  return unknown("a command substitution")
}

// xargs in front of a command: `replace` is its -I (or BSD -J) string, which marks where stdin goes; without one, stdin is appended as arguments.
export type Xargs = { replace?: string } | undefined

export type Parsed = {
  args: Word[]
  chdir?: Word
  first?: Word
  local: Map<string, Text>
  name: string
  xargs: Xargs
}

export function parse(cmd: Command): Parsed {
  let { words } = cmd
  const local = new Map<string, Text>()
  const assign = (w: Word) => {
    const eq = w.value.indexOf("=")
    local.set(w.value.slice(0, eq), slice(w, eq + 1))
  }
  let chdir: Word | undefined
  let xargs: Xargs
  let k = 0
  while (k < words.length && !words[k].quoted) {
    if (RESERVED.has(words[k].value)) k++
    else if (words[k].value === "function") k += 2
    else break
  }
  while (k < words.length && ASSIGN.test(words[k].value)) assign(words[k++])
  for (;;) {
    const wrapper = program(words[k]?.value ?? "")
    const takes = WRAPPERS.get(wrapper)
    if (!takes) break
    if (wrapper === "xargs") xargs ??= {}
    k++
    while (k < words.length) {
      const v = words[k].value
      if (ASSIGN.test(v)) assign(words[k++])
      // env -S splits its one string into the words it runs
      else if (wrapper === "env" && /^(?:-[0iv]*S|--split-string(?:=|$))/.test(v)) {
        const attached = /^(?:-[0iv]*S|--split-string=?)(.*)$/.exec(v)?.[1] ?? ""
        const split = (attached || words[k + 1]?.value || "")
          .split(/\s+/)
          .filter(Boolean)
          .map((value) => ({ quoted: false, value }))
        words = [...words.slice(0, k), ...split, ...words.slice(attached ? k + 1 : k + 2)]
      } else if (wrapper === "env" && (v === "-C" || v === "--chdir")) {
        chdir = words[k + 1]
        k += 2
      } else if (xargs && /^(?:-[IiJ]|--replace)/.test(v)) {
        const attached = /^(?:-[IiJ]|--replace=?)(.*)$/.exec(v)?.[1] ?? ""
        const separate = v === "-I" || v === "-J"
        xargs.replace = separate ? words[k + 1]?.value : attached || "{}"
        k += separate ? 2 : 1
      } else if (takes.has(v)) k += 2
      else if (v.startsWith("-") && v !== "-") k++
      else break
    }
    if (COUNTED.has(wrapper)) k++
  }
  return {
    args: words.slice(k + 1),
    chdir,
    first: words[k],
    local,
    name: k < words.length ? program(words[k].value) : "",
    xargs,
  }
}

// run-slot.sh runs the words after its -- as the command: those words (none when it has no --), or undefined for any other command, so a hook that calls it reads a slotted command as the command itself.
export function slotWords({ args, name }: Parsed): Word[] | undefined {
  if (name !== "run-slot.sh") return
  const at = args.findIndex((a) => a.value === "--")
  return at === -1 ? [] : args.slice(at + 1)
}

// A shell whose script file is run-slot.sh runs that run-slot call: its words from the script on, the shell's own flags before it dropped, or undefined for any other shell call.
export function shellSlot(args: Word[], shell: string): Word[] | undefined {
  const { inline, operand } = shellOperand(args, shell)
  if (inline || !operand || program(operand.value) !== "run-slot.sh") return
  return args.slice(args.indexOf(operand))
}

// A hook's judgement of one command, given everything but the shell's own builtins, the shells it starts and eval, which run() follows itself.
export type Visit = (cmd: Command, parsed: Parsed, env: Env) => Promise<string | undefined>

// builtins: visit also each bare assignment or wrapper with no command (name "", as a bare `env`) and each declare, export, local, readonly or typeset.
export async function run(
  lexed: Lexed,
  env: Env,
  visit: Visit,
  builtins = false,
): Promise<string | undefined> {
  const envs = new Map<number, Env>([[0, env]])
  const envOf = (scope: number): Env => {
    const found = envs.get(scope)
    if (found) return found
    const parent = envOf(lexed.scopes[scope])
    const child: Env = { ...parent, vars: new Map(parent.vars) }
    envs.set(scope, child)
    return child
  }
  for (const cmd of lexed.commands) {
    const verdict = await examine(cmd, envOf(cmd.scope), visit, builtins)
    if (verdict) return verdict
  }
}

const subshell = (env: Env): Env => ({ ...env, vars: new Map(env.vars) })

// One command as run() reads it, cd, the shells it starts and eval followed, for a hook that finds a command inside another (a wrapper's words).
export async function examine(
  cmd: Command,
  env: Env,
  visit: Visit,
  builtins: boolean,
): Promise<string | undefined> {
  const parsed = parse(cmd)
  const { args, chdir, local, name } = parsed
  const here: Env = chdir ? { ...env, cwd: pathOf(chdir, env) } : env
  let verdict: string | undefined
  if (name === "") {
    for (const [key, value] of local) env.vars.set(key, value)
    if (builtins) verdict = await visit(cmd, parsed, here)
  } else if (name === "cd" || name === "pushd") {
    env.cwd = cmd.detached ? undefined : await cdTarget(args, env)
  } else if (name === "popd") env.cwd = undefined
  else if (EXPORTS.has(name)) {
    for (const w of args.filter((a) => ASSIGN.test(a.value))) {
      const eq = w.value.indexOf("=")
      env.vars.set(w.value.slice(0, eq), slice(w, eq + 1))
    }
    if (builtins) verdict = await visit(cmd, parsed, here)
  } else if (SHELLS.has(name)) verdict = await shell(name, args, cmd, here, visit, builtins)
  else if (
    (name === "source" || name === ".") &&
    (args[0]?.proc || args[0]?.value === "/dev/stdin")
  ) {
    const script = await scriptOf(args[0], cmd, here)
    verdict = script.unknown
      ? await visit(cmd, parsed, here)
      : await run(lex(script.value, env.known), here, visit, builtins)
  } else if (name === "eval") {
    verdict = await run(lex(args.map((a) => a.value).join(" "), env.known), here, visit, builtins)
  } else verdict = await visit(cmd, parsed, here)
  await record(cmd, name, args, here)
  return verdict
}

// The directory a cd lands in; undefined when the hook cannot tell, or the cd would fail and leave the shell where it was.
async function cdTarget(args: Word[], env: Env): Promise<string | undefined> {
  const dir = args.find((a) => !(a.value.startsWith("-") && a.value.length > 1))
  if (!dir) return homedir()
  const path = dir.value === "-" ? undefined : pathOf(dir, env)
  if (!path) return undefined
  try {
    return (await Bun.file(path).stat()).isDirectory() ? path : undefined
  } catch {
    return undefined
  }
}

// A shell's options that take the next word as their value; -O and +O take one in bash and sh alone, since zsh's take none.
const SHELL_TAKES = new Set(["-o", "+o", "--init-file", "--rcfile"])
const BASH_TAKES = new Set([...SHELL_TAKES, "-O", "+O"])

// A shell's first operand, and whether -c makes it the script's text rather than a script file's name; no operand means the shell reads its script from stdin.
export function shellOperand(args: Word[], shell: string): { inline: boolean; operand?: Word } {
  const takes = shell === "bash" || shell === "sh" ? BASH_TAKES : SHELL_TAKES
  let inline = false
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (takes.has(v)) k++
    else if (/^[-+][A-Za-z]+$/.test(v)) inline ||= v.startsWith("-") && v.includes("c")
    else if (!v.startsWith("--")) return { inline, operand: args[k] }
  }
  return { inline }
}

async function shell(
  name: string,
  args: Word[],
  cmd: Command,
  env: Env,
  visit: Visit,
  builtins: boolean,
): Promise<string | undefined> {
  const slot = shellSlot(args, name)
  if (slot) return examine({ ...cmd, words: slot }, env, visit, builtins)
  const { inline, operand } = shellOperand(args, name)
  if (operand && inline) return run(lex(operand.value, env.known), subshell(env), visit, builtins)
  const script = await scriptOf(operand, cmd, env)
  return script.unknown
    ? undefined
    : run(lex(script.value, env.known), subshell(env), visit, builtins)
}

// A shell's or source's script: stdin with no operand or `/dev/stdin`, a process substitution's output, else unknown.
async function scriptOf(operand: Word | undefined, cmd: Command, env: Env): Promise<Text> {
  if (!operand || operand.value === "/dev/stdin") return stdinOf(cmd, env)
  return operand.proc ? outputOf(operand.proc, env) : unknown("a script file")
}

async function record(cmd: Command, name: string, args: Word[], env: Env): Promise<void> {
  for (const r of cmd.redirects) {
    if (r.op !== ">" && r.op !== ">>" && r.op !== ">|") continue
    const path = r.target && pathOf(r.target, env)
    if (!path) continue
    const stdout = r.fd === "" || r.fd === "1" || r.fd === "&"
    const out = stdout
      ? await outputOf(cmd, env)
      : unknown(`what ${name || "a command"} writes to stderr`)
    env.files.set(path, r.op === ">>" ? join([await existing(path, env), out]) : out)
  }
  if (name !== "tee") return
  const input = await stdinOf(cmd, env)
  const append = args.some((a) => a.value === "-a" || a.value === "--append")
  for (const a of args) {
    const path = a.value.startsWith("-") ? undefined : pathOf(a, env)
    if (path) env.files.set(path, append ? join([await existing(path, env), input]) : input)
  }
}

async function existing(path: string, env: Env): Promise<Text> {
  return env.files.get(path) ?? (await readFile(path)) ?? { value: "" }
}

async function outputOf(cmd: Command, env: Env): Promise<Text> {
  const { args, name } = parse(cmd)
  if (name === "") {
    return cmd.group || cmd.words.some((w) => GROUPING.has(w.value) && !w.quoted)
      ? unknown("the output of a command group")
      : { value: "" }
  }
  if (name === "cat") {
    const sources = args.filter((a) => a.value === "-" || !a.value.startsWith("-"))
    if (sources.length === 0) return stdinOf(cmd, env)
    return join(
      await Promise.all(
        sources.map((s) => (s.value === "-" ? stdinOf(cmd, env) : readPath(s, env))),
      ),
    )
  }
  if (name === "tee") return stdinOf(cmd, env)
  if (!PRINTERS.has(name)) return unknown(`the output of ${name}`)
  const values = await Promise.all(args.map((a) => resolveText(a, env)))
  const hidden = values.find((v) => v.unknown)
  if (hidden) return hidden
  if (name === "printf") return { value: printf(values.map((v) => v.value)) }
  let k = 0
  while (k < values.length && /^-[neE]+$/.test(values[k].value)) k++
  return {
    value: `${values
      .slice(k)
      .map((v) => decode(v.value))
      .join(" ")}\n`,
  }
}

// printf reuses its format while arguments remain; a pass that takes none ends it.
function printf([format = "", ...args]: string[]): string {
  const conversion = /%(?:%|[-+ #0']*\d*(?:\.\d+)?([a-zA-Z]))/g
  let out = ""
  let k = 0
  for (;;) {
    const before = k
    out += decode(format).replace(conversion, (_, kind?: string) => {
      if (!kind) return "%"
      const value = args[k++] ?? ""
      return kind === "b" ? decode(value) : value
    })
    if (k === before || k >= args.length) return out
  }
}

export async function stdinOf(cmd: Command, env: Env): Promise<Text> {
  const input = cmd.redirects.findLast(
    (r) => (r.fd === "" || r.fd === "0") && r.op.startsWith("<") && r.op !== "<&",
  )
  if (input?.target?.proc) return outputOf(input.target.proc, env)
  if (input?.op === "<" || input?.op === "<>")
    return input.target ? readPath(input.target, env) : unknown("an input redirect")
  if (input)
    return input.body ? resolveText(input.body, env) : unknown("a heredoc the hook could not read")
  if (cmd.stdin) return outputOf(cmd.stdin, env)
  return unknown("stdin the hook cannot see")
}

export async function resolveText(text: Text, env: Env): Promise<Text> {
  if (text.unknown || !text.reads?.length) return text
  let { value } = text
  for (const path of text.reads) {
    const file = await readPath(path, env)
    if (file.unknown) return file
    value = value.replace(READ, () => file.value)
  }
  return { value }
}

export function pathOf(text: Text, env: Env): string | undefined {
  if (text.unknown || text.reads?.length || text.value === "") return undefined
  if (isAbsolute(text.value)) return text.value
  return env.cwd ? resolve(env.cwd, text.value) : undefined
}

// Reads a regular file of at most MAX_BYTES; undefined when there is no file at the path.
async function readFile(path: string): Promise<Text | undefined> {
  const file = Bun.file(path)
  try {
    const stats = await file.stat()
    if (!stats.isFile()) return unknown(`${path}, which is not a regular file`)
    if (stats.size > MAX_BYTES) return unknown(`${path}, which is too large to read`)
    return { value: await file.text() }
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined
    return unknown(`${path}, which the hook cannot read`)
  }
}

export async function readPath(path: Text, env: Env): Promise<Text> {
  const resolved = pathOf(path, env)
  if (!resolved && path.unknown)
    return unknown(
      `a file path built from ${path.unknown}, which the hook cannot expand: name the file by its literal absolute path`,
    )
  if (!resolved) return unknown("a file path the hook cannot resolve")
  return (
    env.files.get(resolved) ??
    (await readFile(resolved)) ??
    unknown(`${resolved}, which does not exist yet`)
  )
}

export function parseFlags(
  args: Word[],
  takes: Set<string>,
): { flags: Flag[]; positionals: Word[] } {
  const flags: Flag[] = []
  const positionals: Word[] = []
  for (let k = 0; k < args.length; k++) {
    const w = args[k]
    const v = w.value
    if (v === "--") {
      positionals.push(...args.slice(k + 1))
      break
    }
    if (v.startsWith("--")) {
      const eq = v.indexOf("=")
      const name = eq === -1 ? v : v.slice(0, eq)
      flags.push({
        name,
        value: eq !== -1 ? slice(w, eq + 1) : takes.has(name) ? args[++k] : undefined,
      })
    } else if (v.startsWith("-") && v.length > 1) {
      for (let c = 1; c < v.length; c++) {
        const name = `-${v[c]}`
        if (!takes.has(name)) {
          flags.push({ name })
          continue
        }
        const rest = c + 1 < v.length ? slice(w, v[c + 1] === "=" ? c + 2 : c + 1) : args[++k]
        flags.push({ name, value: rest })
        break
      }
    } else positionals.push(w)
  }
  return { flags, positionals }
}

export const unreadable = (text: Text): boolean =>
  Boolean(text.unknown) || Boolean(text.reads?.length) || marked(text.value)

export const fromXargs = (text: Text, xargs: Xargs): boolean =>
  Boolean(xargs?.replace) && text.value.includes(xargs?.replace ?? "")

// An argument that starts with xargs' -I string, or is a flag holding it (`-{}`, `--{}`), can become any flag.
export const flagFromXargs = (text: Text, xargs: Xargs): boolean =>
  fromXargs(text, xargs) &&
  (text.value.startsWith(xargs?.replace ?? "") || text.value.startsWith("-"))

// A text holding xargs' -I string is filled in from stdin, so the hook cannot read it.
export function viaXargs(text: Text, xargs: Xargs): Text {
  return fromXargs(text, xargs) ? unknown(`what xargs puts in place of ${xargs?.replace}`) : text
}

// gh's subcommand words (`pr comment`, or `api` alone), the repositories its -R flags name, and the arguments after the subcommand.
export function ghCommand(args: Word[]): { head: string[]; repos: Word[]; rest: Word[] } {
  const repos: Word[] = []
  const head: string[] = []
  let k = 0
  while (k < args.length && head.length < (head[0] === "api" ? 1 : 2)) {
    const v = args[k].value
    if (v === "-R" || v === "--repo") {
      if (args[k + 1]) repos.push(args[k + 1])
      k += 2
    } else if (v.startsWith("--repo=")) repos.push(slice(args[k++], 7))
    else if (v.startsWith("-R")) repos.push(slice(args[k++], 2))
    else if (v.startsWith("-")) k++
    else head.push(args[k++].value)
  }
  return { head, repos, rest: args.slice(k) }
}

// What `gh api` sends: its endpoint, its -f/-F fields (a file's text for `@file`), its --input and its method; undefined with no endpoint.
export async function ghApi(
  args: Word[],
  cmd: Command,
  env: Env,
  xargs: Xargs,
): Promise<ApiRequest | undefined> {
  const { flags, positionals } = parseFlags(args, API_TAKES)
  const [endpoint] = positionals
  if (!endpoint) return
  const fields: Field[] = []
  const inputs: Text[] = []
  let method: string | undefined
  for (const { name, value } of flags) {
    if (!value) continue
    if (name === "-X" || name === "--method")
      method = value.unknown ? "POST" : value.value.toUpperCase()
    else if (name === "--input")
      inputs.push(value.value === "-" ? await stdinOf(cmd, env) : await readPath(value, env))
    else if (API_FIELDS.has(name)) {
      const eq = value.value.indexOf("=")
      const key = eq === -1 ? value.value : value.value.slice(0, eq)
      const field = eq === -1 ? { quoted: false, value: "" } : slice(value, eq + 1)
      const fromFile =
        (name === "-F" || name === "--field") && field.value.startsWith("@") && !field.unknown
      const text = !fromFile
        ? field
        : field.value === "@-"
          ? await stdinOf(cmd, env)
          : await readPath(slice(field, 1), env)
      fields.push(
        fromXargs(value, xargs) ? { key: "body", text: viaXargs(value, xargs) } : { key, text },
      )
    }
  }
  if (xargs && !xargs.replace) {
    fields.push({
      key: "body",
      text: unknown("the arguments xargs appends; a read passes with -X GET"),
    })
  }
  if (args.some((a) => flagFromXargs(a, xargs))) {
    fields.push({ key: "body", text: unknown(`what xargs puts in place of ${xargs?.replace}`) })
  }
  const sent = fields.length + inputs.length > 0
  return { endpoint, fields, inputs, method: method ?? (sent ? "POST" : "GET") }
}

export const curlUrls = (flags: Flag[], positionals: Word[]): Word[] => [
  ...positionals,
  ...flags.filter((f) => f.name === "--url" && f.value).map((f) => f.value as Word),
]

// What curl sends: each data, form or upload flag's text, a file's text for `@file` and stdin's for `@-`.
export async function curlData(flags: Flag[], cmd: Command, env: Env): Promise<Text[]> {
  const data: Text[] = []
  for (const { name, value } of flags) {
    if (!value || !CURL_DATA.has(name)) continue
    if (name === "-T" || name === "--upload-file") data.push(await readPath(value, env))
    else if (value.value.startsWith("@") && name !== "--data-raw" && name !== "--form-string") {
      data.push(
        value.value === "@-" ? await stdinOf(cmd, env) : await readPath(slice(value, 1), env),
      )
    } else data.push(value)
  }
  return data
}

// HOME and TMPDIR resolve in paths, and PWD while the command never changes directory, unless the command assigns them itself.
export function knownVariables(
  command: string,
  environment: Record<string, string | undefined>,
  cwd: string | undefined,
): Record<string, string> {
  const values: Record<string, string | undefined> = {
    HOME: environment.HOME,
    PWD: /\b(?:cd|popd|pushd)\b/.test(command) ? undefined : cwd,
    TMPDIR: environment.TMPDIR,
  }
  const known: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    if (value && !command.includes(`${name}=`)) known[name] = value
  }
  return known
}
