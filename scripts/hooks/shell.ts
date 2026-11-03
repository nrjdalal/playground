// The Bash reader the PreToolUse hooks share: it lexes a command and walks it as the shell would run it, reading the heredocs, files and substitutions it can see and marking the rest unknown.
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, resolve } from "node:path"

// `variable` names the first shell variable a text expands, so a hook can tell `"$HERDR_BIN_PATH"` from any other unknown program.
export type Text = { reads?: Text[]; unknown?: string; value: string; variable?: string }
// `glob` marks a word with a glob character the shell sees outside quotes, so `'{print $1}'` holds none and `{a,'b'}` one.
export type Word = Text & { glob?: boolean; procs?: Command[]; quoted: boolean }
type Redirect = { body?: Text; fd: string; op: string; target?: Word }
export type Command = {
  // The token of the run of commands this one belongs to: it changes at each operator that runs a command whatever the one before it did (a `;`, a newline, an `&`, an `||`), and carries into every group, body and pipeline the run reaches, so a cd is read as having moved the shell only for the commands whose token is its own
  chain?: number
  // Set when the command runs only if the one before it succeeded (it sits on the right of an `&&`), so a cd of its own has certainly run for every command the same chain joins after it
  chained?: boolean
  detached?: boolean
  group?: boolean
  // Set when the command sits in a body the shell keeps for a later call (a function's, a brace group's, a coproc's), so a cd of its own may move the shell at any point of the line
  held?: boolean
  inner?: () => Command[]
  redirects: Redirect[]
  // Set when a count or a loop may run the command more than once, so a relative cd of its own may climb or descend any number of folders
  repeated?: boolean
  scope: number
  stdin?: Command
  unsure?: boolean
  words: Word[]
}
type Lexer = {
  // The run of commands the walk is in, carried into every group and substitution it enters, so one reached through a chain keeps that chain's token
  token: number
  commands: Command[]
  i: number
  known: Record<string, string>
  scope: number
  scopes: number[]
  src: string
}
type Lexed = { commands: Command[]; scopes: number[] }
type Pending = { delim: string; quoted: boolean; redirect: Redirect; strip: boolean }
// `old` is set by a hook that follows zsh's ~-, `old.dir` the folder the shell last left (unset when the hook cannot tell), which an assignment to OLDPWD leaves as it is, so a pushd of ~- or ~+ reads a folder there; a hook that leaves it unset reads both as typed.
export type Env = {
  // Set once the line names more folders than the reader carries, so the shell may be in any folder, the one a hook guards included: a hook refuses the command it guards outright, since `places` can enumerate no such set
  cwdAnywhere?: boolean
  // The folder a cd names where the reader can read it, taken as the shell's own: the reading every hook had before the proven folder arrived, kept so a hook that reads this field alone keeps its verdicts. A hook reads the proven folder, and every folder the shell may be in, through `places` instead.
  cwd?: string
  // Every folder a cd on the line has named, which `cd -`, `popd` and a bare `pushd` go back to
  cwdBack?: string[]
  // The folders the shell was in before a cd an `&&` alone made sure, which become the shell's again at the first command outside that cd's own run, since such a command runs whether or not the cd did
  cwdChain?: string[]
  // The `Command.chain` token of that cd, so only a command of its own run keeps the folder it named
  cwdChainToken?: number
  // The folders a body on the line may cd into, which no later cd clears, since the shell may run that body at any point of the line
  cwdHeld?: string[]
  // The folders a cd the reader could not be sure of may have left the shell in, beside `cwdSure`; `cwdSure` is unnamed whenever one of them is the shell's instead
  cwdMaybe?: string[]
  // The folder the reader proved the shell is in: a cd it is sure the shell runs once, into one folder it reads. Unnamed wherever the reader cannot prove one, which is what `places` enumerates instead.
  cwdSure?: string
  // Set once a cd's landing folder cannot be named at all (`cd "$X"`, a popd, zsh's two-operand cd), so each hook reads it by its own fail-closed rule, through `places`'s fallback
  cwdUnread?: boolean
  files: Map<string, Text>
  known: Record<string, string>
  old?: { dir?: string }
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
const MAX_SCRIPT = 131_072
const LARGE = "a text too large to read"

// The performance.now() past which every lex, expansion and walk step throws a RangeError, set by a hook that must answer inside its timeout.
let deadline: number | undefined

// Runs body with a deadline budget ms away, so any slow route through the lexer or the walk refuses, whatever made it slow.
export async function withDeadline<T>(budget: number, body: () => Promise<T>): Promise<T> {
  const outer = deadline
  deadline = performance.now() + budget
  try {
    return await body()
  } finally {
    deadline = outer
  }
}

// Throws once the walk is past its deadline, for a visit whose spawns take time no tick sees.
export function pastDeadline(): void {
  if (deadline !== undefined && performance.now() > deadline)
    throw new RangeError("past the hook's time")
}

let steps = 0

// The one choke point every lex, expansion and walk step passes through; it reads the clock once every 1024 steps, so a tight loop pays for a counter alone.
export function tick(): void {
  if (deadline === undefined || ++steps % 1024 !== 0) return
  if (performance.now() > deadline) throw new RangeError("past the hook's time")
}

// A script a shell, eval or source reads, held under a deadline to the size of a command the hook reads.
function lexScript(value: string, env: Env): Lexed {
  if (deadline !== undefined && value.length > MAX_SCRIPT)
    throw new RangeError("a script too large to read")
  return lex(value, env.known)
}

// A script with xargs' -I string filled in from stdin, refused before it is built when it would outgrow a script the hook reads.
export function filled(script: string, mark: string, value: string): string {
  const count = script.split(mark).length - 1
  if (deadline !== undefined && script.length + count * value.length > MAX_SCRIPT)
    throw new RangeError("a script too large to read")
  return script.replaceAll(mark, value)
}

// A text a command writes or reads from stdin, unknown past the size of a file the hook reads, so a text that doubles stops growing.
const held = (text: Text): Text => (text.value.length > MAX_BYTES ? unknown(LARGE) : text)

const BREAK = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")"])
const REDIRECT = /^(\d*|&)(<<<|<<-|<<|<>|<&|>&!?|>>[!|]?|>[!|]|<|>)/
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
// The reserved words that open a body the shell may run no time or many (a conditional, a loop, a case, a function, a brace group), and those that close one; `function` opens none of its own, since its body's `{` opens it
const OPENS = new Set(["case", "coproc", "for", "if", "select", "until", "while", "{"])
const CLOSES = new Set(["done", "esac", "fi", "}"])
// The openers whose own command the shell may not run as typed: a brace group's, which a function keeps for a later call, and a coproc's, which runs in a subshell. An `if`, `while` or `until` runs its condition, and a `for` or `case` opener runs no command of its own.
const HELD = new Set(["coproc", "function", "{"])
// The operators that run the next command whatever the one before it did, so the run of commands a `cd` moved the shell for ends there; `&&` carries the run on, and `|` keeps a pipeline inside it.
const FREES = new Set(["\n", ";", ";;", "&", "||"])
// Tokens are handed out across every script the hook reads, so a script's own run never shares one with the line that read it.
let tokens = 0
const freshToken = () => ++tokens
// The reserved words a body's own commands carry, which the shell may not run
const BODIES = new Set(["do", "elif", "else", "then"])
// Every reserved word the walk counts, each read in command position alone: `grep -q done` names a pattern, not a loop's end
const MARKERS = new Set([...RESERVED, ...OPENS, ...CLOSES, ...BODIES])

// The reserved words a command carries in command position, in order: those before the program it runs, the program's own word when it is one too (`fi`, `done`), and `function f {`'s own, since a function's name follows it.
function markers(words: Word[]): string[] {
  const out: string[] = []
  for (let k = 0; k < words.length;) {
    const w = words[k]
    if (w.quoted) break
    if (w.value === "function") {
      out.push("function")
      k += 2
    } else if (MARKERS.has(w.value)) {
      out.push(w.value)
      k++
    } else if (ASSIGN.test(w.value)) k++
    else break
  }
  return out
}
// Whether a program is its command's own first word, a reserved word before it (`!`, `then`, `do`) skipped, rather than one a wrapper or an assignment runs
export const ownFirst = (cmd: Command, first: Word | undefined): first is Word =>
  !!first && first === cmd.words.find((w) => w.quoted || !RESERVED.has(w.value))
// Whether every word of a command is an unquoted reserved word (`fi`, `done`), so it names no program of its own
export const onlyReserved = (cmd: Command): boolean =>
  cmd.words.length > 0 && cmd.words.every((w) => !w.quoted && RESERVED.has(w.value))
// The words that close a compound command, whose output the hook does not follow.
const GROUPING = new Set(["}", "done", "esac", "fi"])
export const ASSIGN = /^[A-Za-z_]\w*=/
// Each wrapper's options, A to Z: its flags, then the options that take a value, short and long; parse reads a cluster (`-Hp`) letter by letter and a value attached (`-pwc`, `--prompt=wc`) or as the next word, and reads an option missing here both as a flag and as taking the next word, so a hook judges the program under each
type Options = { flags: Set<string>; values: Set<string> }
const WRAPPERS = new Map<string, Options>(
  Object.entries({
    builtin: ["", ""],
    caffeinate: ["-d -i -m -s -u", "-t -w"],
    command: ["-p -V -v", ""],
    doas: ["-L -n -s", "-a -C -u"],
    env: ["-0 -i -v --debug --ignore-environment --null", "-P -S -u --unset"],
    exec: ["-c -l", "-a"],
    nice: ["", "-n --adjustment"],
    nocorrect: ["", ""],
    noglob: ["", ""],
    nohup: ["", ""],
    repeat: ["", ""],
    stdbuf: ["", "-e -i -o --error --input --output"],
    sudo: [
      "-A -B -b -E -e -H -i -K -k -l -N -n -P -S -s -V -v --askpass --background --bell --edit --help --list --login --non-interactive --preserve-env --preserve-groups --remove-timestamp --reset-timestamp --set-home --shell --stdin --validate --version",
      "-C -D -g -h -p -R -r -T -t -U -u --chdir --chroot --close-from --command-timeout --group --host --other-user --prompt --role --type --user",
    ],
    time: [
      "-a -h -l -p -q -V -v --append --portability --quiet --verbose",
      "-f -o --format --output",
    ],
    timeout: ["-f -p -v --foreground --preserve-status --verbose", "-k -s --kill-after --signal"],
    xargs: [
      "-0 -o -p -r -t -x --exit --interactive --no-run-if-empty --null --open-tty --show-limits --verbose",
      "-a -d -E -L -n -P -R -S -s --arg-file --delimiter --max-args --max-chars --max-lines --max-procs --process-slot-var",
    ],
  }).map(([name, [flags, values]]) => [
    name,
    { flags: new Set(flags.split(" ")), values: new Set(values.split(" ")) },
  ]),
)

// Where a wrapper's option word leaves its value: "own" when it takes none or carries it, "next" when the next word is its value, or undefined for an option the wrapper's list lacks
function optionValue(word: string, { flags, values }: Options): "next" | "own" | undefined {
  if (word.startsWith("--")) {
    const eq = word.indexOf("=")
    const name = eq === -1 ? word : word.slice(0, eq)
    if (values.has(name)) return eq === -1 ? "next" : "own"
    return flags.has(name) ? "own" : undefined
  }
  for (let k = 1; k < word.length; k++) {
    const option = `-${word[k]}`
    if (values.has(option)) return k === word.length - 1 ? "next" : "own"
    if (!flags.has(option)) return undefined
  }
  return "own"
}

// The privilege wrappers' options that start a root shell, which reads its script from stdin when no command follows them: a closed list, read as a word or in a cluster of the wrapper's own flags ahead of its first value-taking letter
const ROOT_SHELLS = new Map([
  ["doas", new Set(["-s"])],
  ["sudo", new Set(["--login", "--shell", "-i", "-s"])],
])
// Whether a command starts a shell that reads its script from stdin, with no command of its own: "root" for a privilege wrapper's shell (`sudo -s`, `nice doas -s`, an option or program in a variable taken as one), "shell" for a shell given no script (`sh`, `sudo bash`); a reserved word, a function's name or an assignment before it skipped
export function stdinShell(cmd: Command): "root" | "shell" | undefined {
  const { args, first, name } = parse(cmd)
  if (first && !marked(first.value)) {
    if (!SHELLS.has(name)) return undefined
    const { inline, operand } = shellOperand(args, name)
    return inline || operand ? undefined : "shell"
  }
  let at = 0
  for (let w = cmd.words[at]; w && !w.quoted; w = cmd.words[at]) {
    if (w.value === "function") at += 2
    else if (RESERVED.has(w.value) || ASSIGN.test(w.value)) at++
    else break
  }
  const end = first ? cmd.words.indexOf(first) : -1
  const before = cmd.words.slice(at, end === -1 ? undefined : end)
  const k = before.findIndex((w) => !w.quoted && ROOT_SHELLS.has(program(w.value)))
  if (k === -1) return undefined
  const wrapper = program(before[k].value)
  const shells = ROOT_SHELLS.get(wrapper) as Set<string>
  const { flags, values } = WRAPPERS.get(wrapper) as Options
  // a cluster's letters up to its first value-taking one, which takes the rest as its value (`-su root`, `-su#0`, `-us`): a shell letter among them, each a flag of the wrapper's own
  const clustered = (value: string) => {
    let shell = false
    for (const c of value.slice(1)) {
      if (values.has(`-${c}`)) return shell
      if (!flags.has(`-${c}`)) return false
      shell ||= shells.has(`-${c}`)
    }
    return shell
  }
  // a listed option, alone or in a cluster of the wrapper's own flags (`-Es`, `-su root`), or a word the hook cannot read, which may hold one
  const starts = ({ quoted, value }: Word) =>
    marked(value) ||
    (!quoted && (shells.has(value) || (/^-[A-Za-z]/.test(value) && clustered(value))))
  return !!first || before.slice(k + 1).some(starts) ? "root" : undefined
}

// Wrappers that take one positional argument (a count or a duration) before the command.
const COUNTED = new Set(["repeat", "timeout"])
export const SHELLS = new Set(["bash", "dash", "ksh", "sh", "zsh"])
const EXPORTS = new Set(["declare", "export", "local", "readonly", "typeset"])
export const PRINTERS = new Set(["echo", "printf"])
// Every git-reading hook's one list of the words git 2.56 steps over before its subcommand: each option that takes the next word as its value, and --exec-path, which takes none but whose bare form prints git's folder and exits, so the word after it never runs.
export const GIT_TAKES = new Set([
  "-C",
  "-c",
  "--attr-source",
  "--config-env",
  "--exec-path",
  "--git-dir",
  "--namespace",
  "--work-tree",
])

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

// Each scope's variable names in the order they were set, so a hook reads only those set since it last looked, where a read of them all before each command grows with the square of their count; every set here goes through setVar.
const setLog = new WeakMap<Map<string, Text>, string[]>()
const setVar = (vars: Map<string, Text>, key: string, value: Text): void => {
  vars.set(key, value)
  const log = setLog.get(vars)
  if (log) log.push(key)
  else setLog.set(vars, [key])
}

// The names a scope's variables were set by since a hook's cursor, every name on its first look (a copied scope's included), and the cursor that marks where it read to.
export function varsSince(vars: Map<string, Text>, cursor: number | undefined): [string[], number] {
  const log = setLog.get(vars) ?? []
  return [cursor === undefined ? [...vars.keys()] : log.slice(cursor), log.length]
}

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
  const lx: Lexer = { commands: [], i: 0, known, scope: 0, scopes: [-1], src, token: freshToken() }
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
  const opens: number[] = []
  // How many bodies the walk is inside, how many of them a loop runs, and the operator that joined the last command to this one, so a command the shell may not run is marked unsure and one it runs only on the command before it succeeding is marked chained.
  let depth = 0
  let loops = 0
  let after = ""
  // A pipeline's commands and a backgrounded one run in subshells: a cd there leaves the shell where it was.
  const end = (op: string) => {
    const done = cmd
    const pipe = op === "|" || op === "|&"
    const brace = (c: Command, value: string) => c.words[0]?.value === value && !c.words[0].quoted
    if (brace(done, "}")) {
      const open = opens.pop()
      if (open !== undefined) {
        const { commands } = lx
        const close = commands.length
        done.inner = () => topLevel(commands.slice(open, close), scope)
      }
    }
    if (pipe || op === "&") done.detached = true
    if (done.words.length > 0 || done.redirects.length > 0 || done.group) {
      // the reserved words in command position alone, so an argument that holds one (`grep -q done`, `echo if`) opens and closes no body
      const reserved = markers(done.words)
      const opened = reserved.filter((w) => OPENS.has(w)).length
      const closed = reserved.filter((w) => CLOSES.has(w)).length
      const body = reserved.some((w) => HELD.has(w) || BODIES.has(w))
      const loop = reserved.includes("do")
      // an `&&` is left out: a command on its right runs only if the one before it succeeded, so it is chained rather than unsure, and every command the chain joins after it runs only if it did too
      if (after === "||" || depth > 0 || body) done.unsure = true
      if (after === "&&") done.chained = true
      done.chain = lx.token
      if (reserved.some((w) => HELD.has(w))) done.held = true
      if (loops > 0 || loop) done.repeated = true
      depth = Math.max(0, depth + opened - closed)
      loops = Math.max(0, loops + (loop ? 1 : 0) - (reserved.includes("done") ? 1 : 0))
      // a run ends only at an operator that runs the next command whatever this one did, and only outside every body: a `|` keeps the pipeline in the run, and entering a group, a body or a script keeps the run it was reached through
      if (depth === 0 && FREES.has(op)) lx.token = freshToken()
      after = op
      for (const w of done.words) {
        if (w.value !== "{" || w.quoted) break
        opens.push(lx.commands.length)
      }
      lx.commands.push(done)
    }
    cmd = fresh()
    if (pipe) {
      cmd.stdin = done
      cmd.detached = true
    }
  }
  while (lx.i < src.length) {
    tick()
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
      const from = lx.commands.length
      const scope = lx.scopes.length
      nest(lx, piped)
      cmd.group = true
      const members = topLevel(lx.commands.slice(from), scope)
      cmd.inner = () => members
    } else if ((c === "<" || c === ">") && src[lx.i + 1] === "(") {
      cmd.words.push(procSub(lx))
    } else if (redirect) {
      lx.i += redirect[0].length
      while (src[lx.i] === " " || src[lx.i] === "\t") lx.i++
      const [, fd] = redirect
      // zsh's >!, >>! and >&! override noclobber as >| does
      const op = redirect[2].replace(/!$/, "|").replace(/^(>[>&])\|$/, "$1")
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

// The commands of one scope whose output leaves it, so not piped into another.
function topLevel(cmds: Command[], scope: number): Command[] {
  const fed = new Set(cmds.map((c) => c.stdin))
  return cmds.filter((c) => !fed.has(c) && c.scope === scope)
}

// A process substitution, carrying the commands whose output leaves it, so a shell that reads it as a script can read that output.
function procSub(lx: Lexer): Word {
  lx.i += 2
  const from = lx.commands.length
  const scope = lx.scopes.length
  nest(lx)
  return {
    procs: topLevel(lx.commands.slice(from), scope),
    quoted: false,
    ...unknown("a process substitution"),
  }
}

function heredocs(lx: Lexer, pending: Pending[], nested: boolean): void {
  for (const doc of pending.splice(0)) {
    const lines: string[] = []
    while (lx.i < lx.src.length) {
      tick()
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
  while (
    lx.i < src.length &&
    (!BREAK.has(src[lx.i]) || (src[lx.i] === "(" && lx.i > start && src[lx.i + 1] !== ")"))
  ) {
    tick()
    const c = src[lx.i]
    const next = src[lx.i + 1] ?? ""
    if (c === "(") {
      const end = balanced(src, lx.i, "(", ")")
      out.value += src.slice(lx.i, end)
      bare += src.slice(lx.i, end)
      inner(lx, src.slice(lx.i + 1, end - 1))
      lx.i = end
    } else if (c === "\\") {
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
    else if (c === "$" || c === "`") {
      // an unquoted expansion's value is globbed too
      const text = c === "$" ? dollar(lx) : backtick(lx)
      merge(out, text)
      if (GLOB_CHARS.test(text.value)) out.glob = true
    } else if (c === "~" && lx.i === start && (next === "" || next === "/" || BREAK.has(next))) {
      out.value += homedir()
      lx.i++
    } else {
      out.value += c
      bare += c
      lx.i++
    }
  }
  // the lookahead finds the close once, so a { with no } costs its length rather than its square
  if (/\{(?=[^{}]*\})[^{}]*(?:,|\.\.)/.test(bare)) out.unknown ??= "a brace expansion"
  if (GLOB_CHARS.test(bare)) out.glob = true
  return out
}

const GLOB_CHARS = /[*?[{(]/

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
  tick()
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
    tick()
    const from = sub.i
    if ((src[sub.i] === "<" || src[sub.i] === ">") && src[sub.i + 1] === "(") procSub(sub)
    else word(sub)
    if (sub.i === from) sub.i++
  }
}

function balanced(src: string, from: number, open: string, close: string): number {
  let depth = 0
  for (let i = from; i < src.length; i++) {
    tick()
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
  // the other readings of a wrapper's option it cannot read, each judged as the command too
  also: Parsed[]
  args: Word[]
  chdir?: Word
  first?: Word
  local: Map<string, Text>
  name: string
  xargs: Xargs
}

// env's split-string option, attached or not, with the text it carries attached
const SPLIT = /^(?:-[0iv]*S|--split-string(?:=|$))(.*)$/

type State = { chdir?: Word; local: Map<string, Text>; rest: Word[]; xargs: Xargs }
// The other readings one command's parse makes at most, so options it cannot read cost a bounded time; past them it reads each as canary did, a flag
const READINGS = 16

export function parse(cmd: Command): Parsed {
  // the words still to read, the next one last, so env -S puts its words back in front in the time of their own count
  const state: State = { local: new Map(), rest: cmd.words.toReversed(), xargs: undefined }
  const { rest } = state
  for (let w = rest.at(-1); w && !w.quoted; w = rest.at(-1)) {
    if (RESERVED.has(w.value)) rest.pop()
    else if (w.value === "function") rest.length = Math.max(0, rest.length - 2)
    else break
  }
  while (ASSIGN.test(rest.at(-1)?.value ?? "")) assign(state.local, rest.pop() as Word)
  return unwrap(state, undefined, { left: READINGS })
}

const assign = (local: Map<string, Text>, w: Word) => {
  const eq = w.value.indexOf("=")
  local.set(w.value.slice(0, eq), slice(w, eq + 1))
}

// The program behind the wrappers at the front of the words, resumed inside `inside`'s options for a second reading: an option the wrapper's lists lack is read as a flag, as a value-less option, and again as taking the next word, and a value in a variable again as expanding to no word and to more than one, each other reading kept in `also`.
function unwrap(state: State, inside: string | undefined, budget: { left: number }): Parsed {
  const { local, rest } = state
  const peek = (): Word | undefined => rest[rest.length - 1]
  const take = (): Word | undefined => rest.pop()
  const also: Parsed[] = []
  const fork = (wrapper: string, drop: number) =>
    budget.left-- > 0 &&
    also.push(
      unwrap(
        {
          chdir: state.chdir,
          local: new Map(local),
          rest: rest.slice(0, Math.max(0, rest.length - drop)),
          xargs: state.xargs && { ...state.xargs },
        },
        wrapper,
        budget,
      ),
    )
  for (let wrapper = inside; ; wrapper = undefined) {
    if (!wrapper) {
      wrapper = program(peek()?.value ?? "")
      if (!WRAPPERS.has(wrapper)) break
      if (wrapper === "xargs") state.xargs ??= {}
      take()
    }
    const options = WRAPPERS.get(wrapper) as Options
    for (let w = peek(); w; w = peek()) {
      const v = w.value
      if (ASSIGN.test(v)) assign(local, take() as Word)
      // env -S splits its one string into the words it runs
      else if (wrapper === "env" && SPLIT.test(v)) {
        const attached = SPLIT.exec(v)?.[1] ?? ""
        take()
        const split = (attached || take()?.value || "").split(/\s+/).filter(Boolean)
        for (let j = split.length - 1; j >= 0; j--) rest.push({ quoted: false, value: split[j] })
      } else if (wrapper === "env" && (v === "-C" || v === "--chdir")) {
        take()
        state.chdir = take()
      } else if (wrapper === "env" && /^(?:-C|--chdir=)./.test(v)) {
        state.chdir = slice(w, v.startsWith("-C") ? 2 : "--chdir=".length)
        take()
      } else if (state.xargs && /^(?:-[IiJ]|--replace)/.test(v)) {
        const attached = /^(?:-[IiJ]|--replace=?)(.*)$/.exec(v)?.[1] ?? ""
        take()
        state.xargs.replace = v === "-I" || v === "-J" ? take()?.value : attached || "{}"
      } else if (v === "--") {
        take()
        while (ASSIGN.test(peek()?.value ?? "")) assign(local, take() as Word)
        break
      } else if (v.startsWith("-") && v !== "-") {
        // nice's own -<number> is its adjustment
        const end =
          wrapper === "nice" && /^-\d+$/.test(v)
            ? "own"
            : marked(v)
              ? undefined
              : optionValue(v, options)
        if (!end) fork(wrapper, 2)
        else if (end === "next" && marked(rest[rest.length - 2]?.value ?? "")) {
          fork(wrapper, 1)
          fork(wrapper, 3)
        }
        rest.length = Math.max(0, rest.length - (end === "next" ? 2 : 1))
      } else break
    }
    if (COUNTED.has(wrapper)) take()
  }
  const first = take()
  return {
    also,
    args: rest.reverse(),
    chdir: state.chdir,
    first,
    local,
    name: first ? program(first.value) : "",
    xargs: state.xargs,
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

// A hook's judgement of one command, given everything but the shell's own builtins, the shells it starts, eval, and source or . of a process substitution or /dev/stdin, which run() follows itself.
export type Visit = (cmd: Command, parsed: Parsed, env: Env) => Promise<string | undefined>

// builtins: visit also each bare assignment or wrapper with no command (name "", as a bare `env`), each declare, export, local, readonly or typeset, and a bare copy of each followed command that has a redirect.
export async function run(
  lexed: Lexed,
  env: Env,
  visit: Visit,
  builtins = false,
): Promise<string | undefined> {
  // each script a shell, eval or source reads holds its text until it returns, so a deep chain of them can outgrow the hook's memory and time
  if (running >= MAX_RUNS) throw new RangeError("scripts nested too deep")
  running++
  try {
    return await runAll(lexed, env, visit, builtins)
  } finally {
    running--
  }
}

let running = 0
const MAX_RUNS = 256

async function runAll(
  lexed: Lexed,
  env: Env,
  visit: Visit,
  builtins: boolean,
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

// One command as run() reads it, cd, the shells it starts, eval, and source or . of a process substitution or /dev/stdin followed, for a hook that finds a command inside another (a wrapper's words).
export async function examine(
  cmd: Command,
  env: Env,
  visit: Visit,
  builtins: boolean,
): Promise<string | undefined> {
  tick()
  unchain(cmd, env)
  const readings = (parsed: Parsed): Parsed[] => [parsed, ...parsed.also.flatMap(readings)]
  const [primary, ...others] = readings(parse(cmd))
  // only the primary reading moves the folder, sets variables and records files, as canary's one reading did; each other runs on a copy of the env before the command
  const before = others.length > 0 ? apart(env) : env
  const verdict = await examineReading(cmd, primary, env, visit, builtins)
  if (verdict) return verdict
  for (const parsed of others) {
    const verdict = await examineReading(cmd, parsed, apart(before), visit, builtins)
    if (verdict) return verdict
  }
}

const apart = (env: Env): Env => ({
  ...env,
  files: new Map(env.files),
  known: { ...env.known },
  process: { ...env.process },
  vars: new Map(env.vars),
})

async function examineReading(
  cmd: Command,
  parsed: Parsed,
  env: Env,
  visit: Visit,
  builtins: boolean,
): Promise<string | undefined> {
  const { args, chdir, local, name } = parsed
  // env -C runs the command in the folder it names, wherever the shell is, so its own reading of the folder replaces every other
  const into = chdir && pathOf(chdir, env)
  const here: Env = chdir
    ? {
        ...env,
        cwd: into,
        cwdHeld: [],
        cwdMaybe: [],
        cwdSure: into,
        cwdUnread: into === undefined,
      }
    : env
  let verdict: string | undefined
  const followed = SHELLS.has(name) || [".", "cd", "eval", "popd", "pushd", "source"].includes(name)
  if (followed && builtins && cmd.redirects.length > 0) {
    const bare = { ...cmd, words: [] }
    verdict = await visit(bare, parse(bare), here)
    if (verdict) return verdict
  }
  if (name === "") {
    for (const [key, value] of local) setVar(env.vars, key, value)
    if (builtins) verdict = await visit(cmd, parsed, here)
  } else if (name === "cd" || name === "popd" || name === "pushd") {
    // a glob in the folder is judged as any program's words are, since it may land anywhere it matches
    if (name !== "popd" && args.some((a) => GLOB_CHARS.test(a.value)))
      verdict = await visit(cmd, parsed, here)
    await chdirTo(name, cmd, parsed, env)
  } else if (EXPORTS.has(name)) {
    for (const w of args.filter((a) => ASSIGN.test(a.value))) {
      const eq = w.value.indexOf("=")
      setVar(env.vars, w.value.slice(0, eq), slice(w, eq + 1))
    }
    if (builtins) verdict = await visit(cmd, parsed, here)
  } else if (SHELLS.has(name))
    verdict = await nested(cmd, env, () =>
      shell(name, args, cmd, here, visit, builtins, parsed.xargs),
    )
  else if (
    (name === "source" || name === ".") &&
    (args[0]?.procs || args[0]?.value === "/dev/stdin")
  ) {
    const script = await scriptOf(args[0], cmd, here)
    verdict =
      (script.unknown ? await visit(cmd, parsed, here) : undefined) ??
      (await nested(cmd, env, () => run(lexScript(known(script), env), here, visit, builtins)))
  } else if (name === "eval") {
    verdict = await nested(cmd, env, () =>
      run(lexScript(args.map((a) => a.value).join(" "), env), here, visit, builtins),
    )
  } else verdict = await visit(cmd, parsed, here)
  await record(cmd, name, args, here)
  return verdict
}

// Runs a script a command of the line reads (a shell, an eval, a source). The line's own run does not reach into it, since every command of the script runs because that command ran, so the script reads with no chain of the line's; what the script's own trailing chain leaves joins the line's on the way out, under the reading command's own token, since a cd an `&&` made sure at the end of an eval or a source may not have run either.
async function nested<T>(cmd: Command, env: Env, body: () => Promise<T>): Promise<T> {
  const chain = env.cwdChain
  const token = env.cwdChainToken
  env.cwdChain = []
  env.cwdChainToken = undefined
  try {
    return await body()
  } finally {
    const left = [...new Set([...(chain ?? []), ...(env.cwdChain ?? [])])]
    env.cwdChain = keep(left, env)
    env.cwdChainToken = left.length > 0 ? (chain?.length ? token : cmd.chain) : undefined
  }
}

// The two wrappers that run a shell builtin, so `builtin cd X` and `command cd X` move the shell as a bare `cd` does; every other wrapper (`env`, `nice`, `xargs`) runs no builtin at all.
const BUILTIN = new Set(["builtin", "command"])
// Whether the shell is sure to run a command once, so the folder a cd of its own lands in is the folder the commands after it run from: it reaches its program as its own first word or through `builtin` or `command` alone, and the lexer marked it neither detached (a pipeline, a background) nor unsure (an `||`'s right side, a body the shell may run no time or many) nor repeated. A command on an `&&`'s right side is sure in this sense, since every command that chain joins after it runs only if it ran and succeeded; `unchain` ends that where the chain does.
const sureToRun = (cmd: Command, parsed: Parsed): boolean =>
  !cmd.detached &&
  !cmd.unsure &&
  !cmd.repeated &&
  (ownFirst(cmd, parsed.first) || throughBuiltin(cmd, parsed))

// Whether `builtin` or `command` runs the command's program, with nothing but their own options, reserved words and assignments in front of it.
const throughBuiltin = (cmd: Command, { first }: Parsed): boolean => {
  if (!first) return false
  const before = cmd.words.slice(0, cmd.words.indexOf(first))
  return (
    before.some((w) => !w.quoted && BUILTIN.has(program(w.value))) &&
    before.every(
      (w) =>
        !w.quoted &&
        (BUILTIN.has(program(w.value)) ||
          w.value.startsWith("-") ||
          MARKERS.has(w.value) ||
          ASSIGN.test(w.value)),
    )
  )
}

// Whether a count or a loop may run a command more than once, so a relative cd of its own climbs or descends once for each run.
const manyTimes = (cmd: Command, { first }: Parsed): boolean =>
  !!cmd.repeated ||
  cmd.words
    .slice(0, first ? cmd.words.indexOf(first) : 0)
    .some((w) => !w.quoted && COUNTED.has(program(w.value)))

// The folders the shell may be in before a command runs: the one the reader proved, else each one a cd it could not be sure of may have reached.
const startFolders = (env: Env): string[] => [
  ...(env.cwdSure === undefined ? [] : [env.cwdSure]),
  ...(env.cwdMaybe ?? []),
]

// Each folder the shell may be in when a command runs, as an Env of its own, so a hook judges the command in every folder it cannot rule out: the folder the reader proved, each one a cd it could not be sure of may have reached, and each one a body on the line may cd into. `fallback` is the folder a hook reads when a cd's landing folder cannot be named at all (`cd "$X"`), by its own fail-closed rule. Each Env carries its own folder as both `cwd` and `cwdSure`, so a hook reads the folder it is judging in by either field, and tells the folder the reader proved by `cwdSure` matching the reader's own; a command the reader can place in no folder is judged once with none named. The proven folder comes first.
export function places(env: Env, fallback?: string): Env[] {
  const folders = [
    ...startFolders(env),
    ...(env.cwdHeld ?? []),
    ...(env.cwdUnread && fallback !== undefined ? [fallback] : []),
  ]
  const out: Env[] = []
  const seen = new Set<string>()
  for (const cwd of folders) {
    tick()
    if (seen.has(cwd)) continue
    seen.add(cwd)
    out.push({ ...env, cwd, cwdSure: cwd })
  }
  // a command the reader can place in no folder is judged once with none named, so the hook's own fail-closed rule reads it
  return out.length > 0 ? out : [{ ...env, cwd: undefined, cwdSure: undefined }]
}

// Every folder above a path, up to the root, since a relative cd a loop runs climbs one for each run.
function ancestors(path: string): string[] {
  const out: string[] = []
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    tick()
    out.push(dir)
    if (dir === dirname(dir)) return out
  }
}

// The one folder a cd names, taken as the shell's own wherever the reader reads it: `Env.cwd`'s own rule, which every hook read before the proven folder arrived and a hook outside `places` reads still.
async function cdTarget(name: string, args: Word[], env: Env): Promise<string | undefined> {
  const dir = args.find((a) => !(a.value.startsWith("-") && a.value.length > 1))
  if (!dir) return homedir()
  const typed = dir.value === "-" ? undefined : await folder(pathOf(dir, env))
  // in a hook that follows ~-, a pushd's unquoted ~- is the folder the shell last left and ~+ the current one, as the shell expands them; beside a folder named ~- or ~+ the typed reading stays, though the shell still expands the word
  const tilde =
    !typed && name === "pushd" && env.old && !dir.quoted && !dir.unknown && !dir.reads?.length
      ? /^~([-+])(?=\/|$)/.exec(dir.value)
      : null
  const base = tilde && (tilde[1] === "-" ? env.old?.dir : env.cwd)
  return base ? await folder(base + dir.value.slice(2)) : typed
}

async function folder(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined
  return (await isFolder(path)) ? path : undefined
}

// Where a cd or pushd may leave the shell: each folder its own words name, whether its target names a folder the reader cannot read at all, and `back` for a form that returns to a folder the line named before, so every one of those is a candidate too. `cd -` and a bare `pushd` are such forms, and so is zsh's two-operand cd, which replaces part of the path the shell is in: its operands go in as candidates, since one of them is the folder a one-operand reading would reach. A bare `pushd` takes the home as well, which zsh's PUSHD_TO_HOME makes it reach.
type Move = { back?: boolean; paths: string[]; unread: boolean }

function cdTargets(name: string, cmd: Command, parsed: Parsed, env: Env, from: string[]): Move {
  const dirs = parsed.args.filter((a) => !(a.value.startsWith("-") && a.value.length > 1))
  const [dir] = dirs
  if (!dir) {
    return name === "cd"
      ? { paths: [homedir()], unread: false }
      : { back: true, paths: [homedir()], unread: true }
  }
  if (dir.value === "-") return { back: true, paths: [], unread: true }
  const paths = new Set<string>()
  const many = manyTimes(cmd, parsed)
  let unread = dirs.length > 1
  for (const word of dirs.length > 1 ? dirs : [dir]) {
    for (const base of from.length > 0 ? from : [undefined]) {
      tick()
      const path = pathOf(word, { ...env, cwd: base })
      if (path === undefined) {
        unread = true
        continue
      }
      paths.add(path)
      // a loop or a count runs the cd again from wherever the last run left it, so a target that climbs reaches every folder above
      if (many && word.value.split("/").includes("..")) {
        for (const up of ancestors(path)) paths.add(up)
      }
    }
  }
  return { back: dirs.length > 1, paths: [...paths], unread }
}

// In a hook that follows zsh's ~- (`Env.old` set), a pushd's unquoted ~- returns to a folder the shell was in and ~+ stays in the one it is in; the reader takes every folder `cd -` would go back to, or each one the shell may be in, beside the typed reading and the folder `Env.cwd`'s own reading lands in, so it is never looser than that reading.
function pushdTilde(
  move: Move,
  name: string,
  parsed: Parsed,
  env: Env,
  from: string[],
  back: string[],
): Move {
  const dir = parsed.args.find((a) => !(a.value.startsWith("-") && a.value.length > 1))
  const tilde =
    name === "pushd" && env.old && dir && !dir.quoted && !dir.unknown && !dir.reads?.length
      ? /^~([-+])(?=\/|$)/.exec(dir.value)
      : null
  if (!tilde || !dir) return move
  const bases = tilde[1] === "-" ? back : from
  const paths = [
    ...move.paths,
    ...bases.map((base) => base + dir.value.slice(2)),
    ...(env.cwd === undefined ? [] : [env.cwd]),
  ]
  return {
    back: move.back || tilde[1] === "-",
    paths: [...new Set(paths)],
    unread: move.unread || bases.length === 0,
  }
}

// Where a cd, pushd or popd leaves the folder. A cd the shell is sure to run once, into one folder the reader reads, moves it there and clears each folder it may have been in, since the shell is certainly in that one; any other leaves `cwd` unnamed with every folder it may have reached a candidate, so each hook judges the commands after it in all of them. A cd inside a body the shell keeps for a later call moves nothing now, and its folder stays a candidate through every later cd, since the line may call that body at any point.
async function chdirTo(name: string, cmd: Command, parsed: Parsed, env: Env): Promise<void> {
  // `cwd` moves by the reading every hook had before the proven folder arrived, so a hook that reads it alone keeps its verdicts; it is read first, since it resolves a relative target against the folder this cd leaves
  const left = env.cwd
  env.cwd = name === "popd" || cmd.detached ? undefined : await cdTarget(name, parsed.args, env)
  if (env.old) env.old = name === "popd" ? {} : { dir: env.cwd === undefined ? undefined : left }
  const from = startFolders(env)
  const back = [...new Set([...(env.cwdBack ?? []), ...from])]
  const move: Move =
    name === "popd"
      ? { back: true, paths: [], unread: true }
      : pushdTilde(cdTargets(name, cmd, parsed, env, from), name, parsed, env, from, back)
  const { paths, unread } = move
  // the folder `Env.cwd`'s own reading left and the one it lands in join them, so the one folder `Env.old` names is always one a `cd -` or a `pushd ~-` of the reader's may go back to
  const named = [left, env.cwd].filter((dir): dir is string => dir !== undefined)
  env.cwdBack = keep([...new Set([...back, ...paths, ...named])], env)
  if (cmd.held) {
    env.cwdHeld = keep([...new Set([...(env.cwdHeld ?? []), ...paths])], env)
    env.cwdUnread ||= unread
    return
  }
  // a cd an `&&` joins to what follows needs no folder there to read: one into a folder that is not there fails, and then nothing the chain joins after it runs
  const chained = cmd.chained && !negated(cmd)
  if (
    sureToRun(cmd, parsed) &&
    !unread &&
    paths.length === 1 &&
    (chained || (await isFolder(paths[0])))
  ) {
    env.cwdSure = paths[0]
    env.cwdMaybe = []
    env.cwdUnread = false
    // the chain holds only to the first command it does not reach, so the folders from before this cd are kept for that one
    if (chained) {
      env.cwdChain = keep([...new Set([...(env.cwdChain ?? []), ...from])], env)
      env.cwdChainToken = cmd.chain
    }
    return
  }
  env.cwdSure = undefined
  // a form that returns to a folder the line named before takes every one of them, since the reader cannot tell which the shell goes back to
  env.cwdMaybe = keep([...new Set([...(move.back ? back : from), ...paths])], env)
  env.cwdUnread = env.cwdUnread || unread || (from.length === 0 && paths.length === 0)
}

// Whether a `!` inverts the command's own status, which an `&&` after it reads: a cd negated an odd number of times carries the chain on when it fails, so the commands after it run in the folder the shell never left and the reader keeps that folder a candidate.
const negated = (cmd: Command): boolean =>
  markers(cmd.words).filter((word) => word === "!").length % 2 === 1

// A cd an `&&` alone made sure holds for its own run of commands alone: any other command runs whether or not that cd did, so the folders from before it are the shell's again beside the one it named. A command keeps the folder only by proof, its own token matching the cd's, which every operator that frees a command takes away and no group, body, pipeline or script grants.
function unchain(cmd: Command, env: Env): void {
  if (!env.cwdChain?.length || cmd.chain === env.cwdChainToken) return
  env.cwdMaybe = keep(
    [...new Set([...(env.cwdMaybe ?? []), ...(env.cwdSure ? [env.cwdSure] : []), ...env.cwdChain])],
    env,
  )
  env.cwdSure = undefined
  env.cwdChain = []
  env.cwdChainToken = undefined
}

// At most this many folders are carried for one line, since each hook judges every command in all of them.
const MAX_FOLDERS = 32

// The folders kept, and `Env.cwdAnywhere` set once a line names more than that: dropping a folder would let a line name a guarded one past the cap and run there, so past it the shell reads as able to be in any folder, and each hook refuses the command it guards. It stays set for the rest of the line, since a folder the reader dropped stays one the shell may be in.
function keep(folders: string[], env: Env): string[] {
  if (folders.length <= MAX_FOLDERS) return folders
  env.cwdAnywhere = true
  env.cwdSure = undefined
  env.cwdUnread = true
  return folders.slice(0, MAX_FOLDERS)
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await Bun.file(path).stat()).isDirectory()
  } catch {
    return false
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
  xargs?: Xargs,
): Promise<string | undefined> {
  const slot = shellSlot(args, name)
  if (slot) return examine({ ...cmd, words: slot }, env, visit, builtins)
  const { inline, operand } = shellOperand(args, name)
  if (operand && inline) {
    let script = operand.value
    if (xargs?.replace && script.includes(xargs.replace)) {
      const fed = await stdinOf(cmd, env)
      script = filled(script, xargs.replace, fed.unknown ? UNKNOWN : fed.value.trim())
    }
    return run(lexScript(script, env), subshell(env), visit, builtins)
  }
  const script = await scriptOf(operand, cmd, env)
  return run(lexScript(known(script), env), subshell(env), visit, builtins)
}

// A script's parts the hook can read, each part it cannot read (a `curl`'s output in a group) taken as a line break, so the rest is still walked.
const known = (script: Text): string => script.value.replaceAll(UNKNOWN, "\n")

// A shell's or source's script: stdin with no operand or `/dev/stdin`, a process substitution's output, else unknown; a walk with a budget throws on one too large to hold.
async function scriptOf(operand: Word | undefined, cmd: Command, env: Env): Promise<Text> {
  const script =
    !operand || operand.value === "/dev/stdin"
      ? await stdinOf(cmd, env)
      : operand.procs
        ? await outputs(operand.procs, env)
        : unknown("a script file")
  if (deadline !== undefined && script.unknown === LARGE) throw new RangeError(LARGE)
  return script
}

// The output of a list of commands run in order, unknown when any part is.
async function outputs(cmds: Command[], env: Env): Promise<Text> {
  return join(await Promise.all(cmds.map((c) => outputOf(c, env))))
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
    env.files.set(path, held(r.op === ">>" ? join([await existing(path, env), out]) : out))
  }
  if (name !== "tee") return
  const input = await stdinOf(cmd, env)
  const append = args.some((a) => a.value === "-a" || a.value === "--append")
  for (const a of args) {
    const path = a.value.startsWith("-") ? undefined : pathOf(a, env)
    if (path) env.files.set(path, held(append ? join([await existing(path, env), input]) : input))
  }
}

async function existing(path: string, env: Env): Promise<Text> {
  return env.files.get(path) ?? (await readFile(path)) ?? { value: "" }
}

async function outputOf(cmd: Command, env: Env): Promise<Text> {
  tick()
  const { args, name } = parse(cmd)
  if (name === "") {
    if (cmd.inner) return outputs(cmd.inner(), env)
    return cmd.group || cmd.words.some((w) => GROUPING.has(w.value) && !w.quoted)
      ? unknown("the output of a command group")
      : { value: "" }
  }
  if (name === "cat") {
    const sources = args.filter((a) => a.value === "-" || !a.value.startsWith("-"))
    if (sources.length === 0) return stdinOf(cmd, env)
    // the first `-` reads all of stdin, so a later one reads nothing; the sources are read in turn until their text outgrows what the hook holds
    const first = sources.findIndex((s) => s.value === "-")
    const parts: Text[] = []
    let size = 0
    for (const [k, s] of sources.entries()) {
      tick()
      const part =
        s.value !== "-"
          ? await readPath(s, env)
          : k === first
            ? await stdinOf(cmd, env)
            : { value: "" }
      size += part.value.length
      if (size > MAX_BYTES) return unknown(LARGE)
      parts.push(part)
    }
    return join(parts)
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
  const conversion = /%(?:%|[-+ #0']*(?:[1-9]\d*)?(?:\.\d+)?([a-zA-Z]))/g
  const pattern = decode(format)
  let out = ""
  let k = 0
  for (;;) {
    tick()
    const before = k
    out += pattern.replace(conversion, (_, kind?: string) => {
      if (!kind) return "%"
      const value = args[k++] ?? ""
      return kind === "b" ? decode(value) : value
    })
    if (k === before || k >= args.length) return out
  }
}

export async function stdinOf(cmd: Command, env: Env): Promise<Text> {
  tick()
  return held(await stdinText(cmd, env))
}

async function stdinText(cmd: Command, env: Env): Promise<Text> {
  const input = cmd.redirects.findLast(
    (r) => (r.fd === "" || r.fd === "0") && r.op.startsWith("<") && r.op !== "<&",
  )
  if (input?.target?.procs) return outputs(input.target.procs, env)
  if (input?.op === "<" || input?.op === "<>")
    return input.target ? readPath(input.target, env) : unknown("an input redirect")
  if (input)
    return input.body ? resolveText(input.body, env) : unknown("a heredoc the hook could not read")
  if (cmd.stdin) return outputOf(cmd.stdin, env)
  return unknown("stdin the hook cannot see")
}

export async function resolveText(text: Text, env: Env): Promise<Text> {
  if (text.unknown || !text.reads?.length) return text
  // each read fills the next READ mark in turn; splitting once keeps the cost to the text's length
  const pieces = text.value.split(READ)
  let value = pieces[0]
  for (const [k, path] of text.reads.entries()) {
    tick()
    const file = await readPath(path, env)
    if (file.unknown) return file
    if (k + 1 < pieces.length) value += file.value + pieces[k + 1]
    if (value.length > MAX_BYTES) return unknown(LARGE)
  }
  for (const piece of pieces.slice(text.reads.length + 1)) value += READ + piece
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
