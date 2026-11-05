// PreToolUse hook: refuses a factory session's write into the extensions root, where every guard's list, policy.json and each scope's sources live, and its playground CLI call that changes what a guard reads to allow or deny a call, so no session edits a list in one call and makes the guarded call in the next.
import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"

import { dataDir } from "../../packages/env/src/data-dir"
import { extensionsDir } from "../../packages/settings/src/rendered"
import { bunCall, FILE_TOOLS, gitCall, real } from "./no-main-checkout"
import { fromFactory } from "./role"
import {
  ASSIGN,
  codeFed,
  type Command,
  type Env,
  examine,
  filled,
  GIT_TAKES,
  knownVariables,
  lex,
  marked,
  onlyReserved,
  ownFirst,
  parse,
  type Parsed,
  pathOf,
  places,
  PRINTERS,
  program,
  READ,
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

// a word as the call wrote it, else its value, with each part the hook cannot read shown as $…
const shown = (word: Word): string =>
  (word.raw ?? word.value).replaceAll(UNKNOWN, () => "$…").replaceAll(READ, () => "$…")

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
    !before.some((w) => /^-c|^--(?:config-env|exec-path)/.test(w)) &&
    !rest.some((w) => /^(?:--output|-O|--open-files-in-pager|--ext-diff|--textconv)/.test(w))
  )
}

// gh's calls that only read, a closed list, whose -q or --jq filter and -t or --template template are text that no shell runs
const GH_READS = new Set([
  "api",
  "issue list",
  "issue view",
  "pr list",
  "pr view",
  "run list",
  "run view",
  "search",
])
// a gh api option that sends, and a read's option that opens the browser, each alone or in a cluster of short flags ahead of a filter's or template's own letter
const GH_API_SENDS = /^(?:-[^-=qt]*[FXf]|--(?:cache|field|input|method|raw-field)(?:=|$))/
const GH_WEB = /^(?:-[^-=qt]*w|--web(?:=|$))/

// The words of a read-only gh call's jq filter or Go template (`-q '<filter>'`, `--jq=<filter>`, `-t '<template>'`), read as text rather than a command line; none for any other gh call. A pager or editor variable set on the line needs no check here, since an assignment or an export keeps the line from being read call by call.
function ghFilters(parsed: Parsed): Set<Word> {
  const { args, first, name } = parsed
  const filters = new Set<Word>()
  if (name !== "gh" || !first || marked(first.value)) return filters
  const [verb, sub] = args.map((a) => a.value)
  const call = verb === "api" || verb === "search" ? verb : `${verb} ${sub}`
  if (!GH_READS.has(call)) return filters
  // gh api with a method, a field, an input file or a cache writes or sends, and --web opens a browser, so neither is a reader
  if (verb === "api" && args.some((a) => GH_API_SENDS.test(a.value))) return filters
  if (args.some((a) => GH_WEB.test(a.value))) return filters
  for (let k = 0; k < args.length; k++) {
    const { value } = args[k]
    if (["-q", "--jq", "-t", "--template"].includes(value) && args[k + 1]) filters.add(args[++k])
    else if (/^(?:-[qt].|--(?:jq|template)=)/.test(value)) filters.add(args[k])
  }
  return filters
}

type Namings = { blind: boolean; counts: Map<string, number>; plain: Set<string> }

// The operators after ${K that only read K; any other (`=`, `:=`, zsh's `::=`, a subscript, a modifier) may set it, so it counts as a naming
const READS_ONLY = /^(?:\}|:?[-+?]|[#%/])/

// Text the shell evaluates, where an assignment sets a name the hook never reads: arithmetic naming a variable, whose value it evaluates as an expression (`V=XY=0; (( V ))` sets XY), in `(( ))`, `$(( ))`, `$[ ]`, a `[[ ]]` comparison or a substring offset; and bash's prompt transformation (`${V@P}`)
const EVALUATES = [
  /\(\([^)]*[A-Za-z_]/,
  /\$\[[^\]]*[A-Za-z_]/,
  /\[\[.*\s-(?:eq|ge|gt|le|lt|ne)\s/s,
  /\$\{[#!]?\w+:(?![-+=?:])[^}]*[A-Za-z_]/,
  /@P\}/,
]

// A subscript, which both shells evaluate as arithmetic naming a variable, but an empty one, `@`, `*`, digits with only `-`, `:`, `,` and spaces among them, or one that starts with `^`, where both shells stop on a math error before reading a name (`a[]`, `a[@]`, `a[-1]`, `a[0:9]`, `a[1,5]`, `a[^;]`); read on the line as written and on its unquoted text, since the shell removes a quote or a backslash between a name and its `[` before read, unset or printf -v sees it (`${a[V]}`, zsh's `$a[V]`, `a[V]=`, `read 'a[V]'`, `printf -v 'a[V]'`, `[[ -v a[V] ]]`)
const SUBSCRIPT = /\w\[(?!(?:[@*]|[-\d:,\s]*)\]|\^)/

// bash's indirection, `${!…}` through any parameter, a positional or special one included, which assigns (`${!N:=…}`) or evaluates any subscript the parameter's value holds; only the name list and an array's keys closed right after (`${!N*}`, `${!N[@]}`) and `${!}`, the last background job's pid, are no indirection
const INDIRECTS = /\$\{!(?!\}|[A-Za-z_]\w*(?:[*@]|\[[*@]\])\})/

// zsh's glob qualifiers that run code, an e with its code up to its separator's match (`[`, `{` and `<` pair with their closers, any other character with itself) or a `+` with a function's name, closed at a word's end (`*(e:…:)`, `*(.e{…})`, `*(+f)`); read on singleQuotesOut's text, since a qualifier acts only on unquoted text
const QUALIFIER =
  /[^\s(|&;<>$=]\((?:#q)?[^()\s|]*?(?:e(?:\[[^]*?\]|\{[^]*?\}|<[^]*?>|([^\s[{<])[^]*?\1)|\+\w+)[^()\s]*\)(?=$|[\s;&|)<>`}])/

// The line with each single-quoted span outside double quotes, comments, backslash escapes and heredoc bodies put as one letter, so a jq filter's `select(…)` reads as no qualifier while `'f1'(e:…:)` still does; a heredoc's body is kept as written, and the line as written when a quote or a heredoc is left open or the line holds `$'…'`, whose quoting this scan does not read
function singleQuotesOut(command: string): string {
  if (command.includes("$'")) return command
  let out = ""
  let double = false
  const docs: { delim: string; strip: boolean }[] = []
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (c === "\\") {
      out += command.slice(i, i + 2)
      i++
    } else if (double) {
      if (c === '"') double = false
      out += c
    } else if (c === '"') {
      double = true
      out += c
    } else if (c === "#" && (i === 0 || /[\s;&|(]/.test(command[i - 1]))) {
      const end = command.indexOf("\n", i)
      const stop = end === -1 ? command.length : end
      out += command.slice(i, stop)
      i = stop - 1
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1)
      if (end === -1) return command
      out += "x"
      i = end
    } else if (command.startsWith("<<<", i)) {
      out += "<<<"
      i += 2
    } else if (command.startsWith("<<", i)) {
      const doc = command.slice(i).match(/^<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([\w.-]+))/)
      if (!doc) return command
      docs.push({ delim: doc[2] ?? doc[3] ?? doc[4], strip: doc[1] === "-" })
      out += doc[0]
      i += doc[0].length - 1
    } else if (c === "\n" && docs.length) {
      out += c
      let at = i + 1
      for (const { delim, strip } of docs) {
        for (;;) {
          if (at > command.length) return command
          const end = command.indexOf("\n", at)
          const stop = end === -1 ? command.length : end
          const line = command.slice(at, stop)
          out += command.slice(at, Math.min(stop + 1, command.length))
          at = stop + 1
          if ((strip ? line.replace(/^\t+/, "") : line) === delim) break
          if (end === -1) return command
        }
      }
      docs.length = 0
      i = at - 1
    } else out += c
  }
  return double || docs.length ? command : out
}

// How many times the line names each variable other than by reading it ($K, ${K}, ${K:-…} and the other READS_ONLY forms): every other spelling of the name counts, an assignment, an append, a bare word (read's, a for loop's, arithmetic's) and a name spelled across a quote or a backslash (`X\Y`, `X"Y"`, which the shell reads as XY) included, as does one attached after an option cluster's a or v (`printf -vK`), a lone flag (`-K`) aside; and the names an unquoted plain assignment sets (`K=`, where a quoted `"K=a"` is a command), read in one pass
function namings(command: string): Namings {
  const counts = new Map<string, number>()
  const plain = new Set<string>()
  const add = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1)
  // a name indirection sets or evaluates a variable whose name the hook cannot read: an assignment sets it, and a read evaluates any subscript the name's value holds (`N=a; N+=[V]; : ${!N}`), so zsh's P flag holds nothing, nor does a flag with a delimited argument (`${(j:…:)…}`), since its argument can hide a `)` and a P, nor do the e, % and # flags, which evaluate a value as shell text, a prompt or arithmetic
  let blind =
    EVALUATES.some((evaluates) => evaluates.test(command)) ||
    SUBSCRIPT.test(command) ||
    SUBSCRIPT.test(unquoted(command)) ||
    QUALIFIER.test(singleQuotesOut(command)) ||
    INDIRECTS.test(command)
  for (const [, flags, closed] of command.matchAll(/\$\{\(([^)]*)(\)?)/g))
    if (!closed || !/^[\w@~^=!*-]*$/.test(flags) || /[eP]/.test(flags)) blind = true
  for (const m of command.matchAll(/(\$\{[#!]?)?(?<![\w$])([A-Za-z_]\w*)/g)) {
    const [whole, expanded, key] = m
    const next = command.slice(m.index + whole.length)
    if (expanded && READS_ONLY.test(next)) continue
    const assigns = next[0] === "=" ? "=" : undefined
    const at = m.index + (expanded?.length ?? 0)
    if (!expanded && command[at - 1] === "-" && (at < 2 || /\s/.test(command[at - 2]))) {
      for (let k = 0; k < key.length - 1; k++)
        if (key[k] === "a" || key[k] === "v") add(key.slice(k + 1))
      continue
    }
    add(key)
    if (!expanded && assigns === "=" && (at === 0 || /[\s;&|(]/.test(command[at - 1])))
      plain.add(key)
  }
  const from: number[] = []
  let joined = ""
  for (let i = 0; i < command.length; i++)
    if (!"\\'\"".includes(command[i])) {
      from.push(i)
      joined += command[i]
    }
  for (const m of joined.matchAll(/(?<![\w$])[A-Za-z_]\w*/g)) {
    const end = m.index + m[0].length - 1
    if (from[end] - from[m.index] !== end - m.index) add(m[0])
  }
  return { blind, counts, plain }
}

// The parameters the shell sets itself, whose value a later word reads is the shell's and not an assignment's: bash 5.3's bash(1), PARAMETERS, Shell Variables ("The shell sets following variables"); zsh 5.9's zshparam(1), PARAMETERS SET BY THE SHELL, and each module's Parameters in its zshmodules(1), zsh/zftp's ZFTP_ family by prefix; and the names a builtin or a match writes with no name among its words (read's and select's REPLY and reply, `=~`'s and the glob flags' MATCH, MBEGIN, MEND, match, mbegin and mend, pcre_match's ZPCRE_OP, and bash's COLUMNS and LINES under checkwinsize)
const SHELL_SETS = new Set([
  "ARGC",
  "BASH",
  "BASHOPTS",
  "BASHPID",
  "COLUMNS",
  "COPROC",
  "CPUTYPE",
  "DIRSTACK",
  "EGID",
  "EPOCHREALTIME",
  "EPOCHSECONDS",
  "ERRNO",
  "EUID",
  "FUNCNAME",
  "FUNCNEST",
  "GID",
  "GROUPS",
  "HISTCMD",
  "HOST",
  "HOSTNAME",
  "HOSTTYPE",
  "LINENO",
  "LINES",
  "LOGNAME",
  "MACHTYPE",
  "MAPFILE",
  "MATCH",
  "MBEGIN",
  "MEND",
  "OLDPWD",
  "OPTARG",
  "OPTIND",
  "OSTYPE",
  "PIPESTATUS",
  "PPID",
  "PWD",
  "RANDOM",
  "REPLY",
  "SECONDS",
  "SHELLOPTS",
  "SHLVL",
  "SRANDOM",
  "TRY_BLOCK_ERROR",
  "TRY_BLOCK_INTERRUPT",
  "TTY",
  "TTYIDLE",
  "UID",
  "USERNAME",
  "VENDOR",
  "ZCURSES_COLORS",
  "ZCURSES_COLOR_PAIRS",
  "ZPCRE_OP",
  "_",
  "aliases",
  "argv",
  "builtins",
  "commands",
  "dirstack",
  "dis_aliases",
  "dis_builtins",
  "dis_functions",
  "dis_functions_source",
  "dis_galiases",
  "dis_patchars",
  "dis_reswords",
  "dis_saliases",
  "epochtime",
  "errnos",
  "funcfiletrace",
  "funcsourcetrace",
  "funcstack",
  "functions",
  "functions_source",
  "functrace",
  "galiases",
  "history",
  "historywords",
  "jobdirs",
  "jobstates",
  "jobtexts",
  "keymaps",
  "langinfo",
  "mapfile",
  "match",
  "mbegin",
  "mend",
  "modules",
  "nameddirs",
  "options",
  "parameters",
  "patchars",
  "pipestatus",
  "reply",
  "reswords",
  "saliases",
  "signals",
  "status",
  "sysparams",
  "termcap",
  "terminfo",
  "userdirs",
  "usergroups",
  "widgets",
  "zcurses_attrs",
  "zcurses_colors",
  "zcurses_keycodes",
  "zcurses_windows",
  "zgdbm_tied",
])
// the families of those the manuals list by prefix (BASH_ARGV, COMP_WORDS, READLINE_LINE, ZSH_SUBSHELL, zsh_eval_context)
const SHELL_SETS_PREFIX = /^(?:BASH_|COMP_|READLINE_|ZFTP_|ZSH_|zsh_)/
// zsh's tied parameters, where a write to either side rewrites the other: each array and its colon-joined scalar, and the aliases, from zsh 5.9's zshparam(1), PARAMETERS USED BY THE SHELL, and zsh/watch's watch and WATCH in zshmodules(1)
const TIED = new Set([
  "CDPATH",
  "FIGNORE",
  "FPATH",
  "HISTCHARS",
  "MAILPATH",
  "MANPATH",
  "MODULE_PATH",
  "PATH",
  "PROMPT",
  "PROMPT2",
  "PROMPT3",
  "PROMPT4",
  "PS1",
  "PS2",
  "PS3",
  "PS4",
  "PSVAR",
  "WATCH",
  "cdpath",
  "fignore",
  "fpath",
  "histchars",
  "mailpath",
  "manpath",
  "module_path",
  "path",
  "prompt",
  "psvar",
  "watch",
])

// The allow-list, the one way a variable's value is held: a name the shell neither sets itself nor ties to another, which a plain NAME=value the hook reads whole names once on a line that names no IFS (the rest of steadyNames places that assignment)
function holdable(key: string, named: Namings, counts: Map<string, number>): boolean {
  return (
    counts.get(key) === 1 &&
    named.plain.has(key) &&
    !SHELL_SETS.has(key) &&
    !SHELL_SETS_PREFIX.test(key) &&
    !TIED.has(key)
  )
}

type Steady = { has: (key: string) => boolean }
const NONE: Steady = { has: () => false }

// The builtins that set a variable by a name among their words, from bash 5.3's bash(1), SHELL BUILTIN COMMANDS, and zsh 5.9's zshbuiltins(1) and zshmodules(1)
const NAME_SETTERS = new Set([
  "compgen",
  "declare",
  "export",
  "float",
  "getln",
  "getopts",
  "integer",
  "let",
  "local",
  "mapfile",
  "pcre_match",
  "print",
  "printf",
  "private",
  "read",
  "readarray",
  "readonly",
  "set",
  "shift",
  "stat",
  "strftime",
  "syserror",
  "sysopen",
  "sysread",
  "syswrite",
  "typeset",
  "unset",
  "vared",
  "wait",
  "zcurses",
  "zformat",
  "zgdbmpath",
  "zgetattr",
  "zlistattr",
  "zmodload",
  "zparseopts",
  "zpty",
  "zregexparse",
  "zselect",
  "zsocket",
  "zstat",
  "zstyle",
  "zsystem",
  "ztcp",
  "ztie",
  "zuntie",
])
// the setters that name a variable only by their v option, so their other words are text they print
const PRINTS = new Set(["print", "printf"])
// zsh's builtins that make a name integer or float, so every later assignment to it is an arithmetic evaluation, as let's words are
const NUMERIC = new Set(["float", "integer"])
// the builtins that give a name an attribute: n makes a bash nameref, a name whose every later write sets the variable its value names, and i (zsh's E and F too) makes every later assignment to it an arithmetic evaluation
const TYPESETS = new Set(["declare", "export", "local", "readonly", "typeset"])
// the builtins that run text as the line's own shell, which can set any variable
const RUNS_TEXT = new Set([".", "eval", "source"])
// the tests whose -v reads its operand as a name, evaluating any subscript it holds; test and [ take their operators after expansion, so a word that expands may be a -v or split into one and its operand, while [[ reads its operators as written
const TESTS = new Set(["[", "[[", "test"])
// the -v operand that names no subscript: a plain unquoted name, as written
const PLAIN_NAME = /^[A-Za-z_]\w*$/
// a word written with any expansion but a plain `$name` or `${name}`: a command substitution, a backtick, a process substitution, arithmetic, an ANSI-C string, a positional or special parameter, a parameter with an operator
const EXPANDS = /\$(?![A-Za-z_]\w*|\{[A-Za-z_]\w*\})|`|[<>]\(/
// the operators of test and [ that take a value after them, so a quoted word ahead of one, or of the closing ], is an operand
const BINARY = new Set([
  "!=",
  "-a",
  "-ef",
  "-eq",
  "-ge",
  "-gt",
  "-le",
  "-lt",
  "-ne",
  "-nt",
  "-o",
  "-ot",
  "<",
  "=",
  "==",
  "=~",
  ">",
])
const testsAName = (args: Parsed["args"], expands: boolean): boolean =>
  args.some((w, k) => {
    const next = args[k + 1]
    if (w.value === "-v") return next !== undefined && !PLAIN_NAME.test(next.source ?? "")
    if (!expands) return false
    if (EXPANDS.test(w.source ?? "$")) return true
    if (!marked(w.value)) return false
    return !w.quoted || (next !== undefined && next.value !== "]" && !BINARY.has(next.value))
  })
// the words that open and close a compound body or group, and the other reserved words a command may lead with
const OPENS = new Set(["case", "for", "if", "select", "until", "while", "{"])
const CLOSES = new Set(["done", "esac", "fi", "}"])
const LEADS = new Set(["!", "coproc", "do", "elif", "else", "then", "time"])

// For each command of the line, the variables whose value the shell has when it runs: each named once, by an unquoted plain assignment that is its command's first word, at the line's top level (outside any function, compound body, group or subshell) and not piped or sent to the background; one the shell always runs (first, or after `;` or `&`) holds for every later command, and one after `&&` only along that `&&` chain, since the shell skips the rest of the chain with it. A line that runs eval or source, sets a variable by a name the hook cannot read whole (a name-indirection assignment, a bash nameref, an integer attribute or text the shell evaluates among them), or names IFS, holds none, and holdable() is the rest of the allow-list
function steadyNames(named: Namings, commands: Command[]): (cmd: Command) => Steady {
  if (named.blind || named.counts.has("IFS")) return () => NONE
  const counts = new Map(named.counts)
  const parses = commands.map((cmd) => parse(cmd))
  for (const [at, cmd] of commands.entries()) {
    const { name } = parses[at]
    if (RUNS_TEXT.has(name)) return () => NONE
    const flagged = (letters: RegExp) =>
      cmd.words.some((w, k) => k > 0 && /^-[^-\s]/.test(w.value) && letters.test(w.value))
    if (NUMERIC.has(name) || (TYPESETS.has(name) && flagged(/[EFin]/))) return () => NONE
    // let evaluates each word as arithmetic, which evaluates a variable's value as an expression
    if (name === "let" && cmd.words.some((w, k) => k > 0 && /[A-Za-z_]/.test(w.value)))
      return () => NONE
    // zsh's print -P expands its words as a prompt, which with PROMPT_SUBST set runs their expansions
    if (name === "print" && flagged(/P/)) return () => NONE
    // a -v operand holds only as a PLAIN_NAME, since any other may name a subscript, and in test and [ a word that EXPANDS holds nothing, nor does a plain `$name` the hook cannot read but as a quoted operand
    if (TESTS.has(name) && testsAName(parses[at].args, name !== "[[")) return () => NONE
    const loop = cmd.words.findIndex(
      (w) => !w.quoted && (w.value === "for" || w.value === "select"),
    )
    if (!NAME_SETTERS.has(name) && loop === -1) continue
    // print and printf name one only by a v in an option cluster (`-v N`, `-vN`, `-rv N`), the last one given winning: every cluster's rest and the word after it count, since any may be the name
    const vNames = cmd.words.flatMap((w, k) =>
      k > 0 && /^-[^-\s]*v/.test(w.value)
        ? [{ ...w, value: w.value.slice(w.value.indexOf("v") + 1) }, cmd.words[k + 1]]
        : [],
    )
    const names = loop !== -1 ? [cmd.words[loop + 1]] : PRINTS.has(name) ? vNames : cmd.words
    // a name the shell reads after quote removal (`read X\Y` sets XY) counts as written, and one the hook cannot read could be any; a name word with a quote or a backslash and a `[` reads as subscripted whatever the subscript, so no quoted or escaped subscript in a setter's name passes
    for (const word of names) {
      if (!word) continue
      if (marked(word.value.split("=")[0])) return () => NONE
      if (word.quoted && word.value.includes("[")) return () => NONE
      for (const key of word.value.match(/[A-Za-z_]\w*/g) ?? [])
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const set = new Map<string, { at: number; chain?: number }>()
  const where = new Map<Command, { at: number; chain: number }>()
  let chain = 0
  let depth = 0
  for (const [at, cmd] of commands.entries()) {
    if (cmd.follows !== "&&") chain++
    where.set(cmd, { at, chain })
    const top = depth === 0 && cmd.scope === 0
    for (let k = 0; k < cmd.words.length; k++) {
      const { quoted, value } = cmd.words[k]
      if (quoted) break
      if (value === "function") k++
      else if (OPENS.has(value)) depth++
      else if (CLOSES.has(value)) depth--
      else if (!LEADS.has(value)) break
    }
    if (depth < 0) return () => NONE
    const always = !cmd.follows || cmd.follows === ";" || cmd.follows === "&"
    if (!top || cmd.detached || (!always && cmd.follows !== "&&")) continue
    const [first] = cmd.words
    if (!first || !ASSIGN.test(first.value) || parses[at].name !== "") continue
    for (const key of parses[at].local.keys())
      if (holdable(key, named, counts)) set.set(key, always ? { at } : { at, chain })
  }
  return (cmd) => {
    const here = where.get(cmd)
    if (!here) return NONE
    return {
      has: (key) => {
        const from = set.get(key)
        return (
          !!from && from.at < here.at && (from.chain === undefined || from.chain === here.chain)
        )
      },
    }
  }
}

// A word with a value the lexer could not read, lexed again with the steady variables the call has set by now; undefined when it holds none, or still holds one the hook cannot read
function heldWord(word: Word, env: Env, steady: Steady): Word | undefined {
  return word.raw && marked(word.value) ? relexed(word.raw, heldVars(env, steady)) : undefined
}

// A raw word lexed with known variables: the one word it makes, or undefined when it still holds a value the hook cannot read
function relexed(raw: string, known: Record<string, string>): Word | undefined {
  // a substitution's commands come first, so the word's own command is the last
  const words = lex(raw, known).commands.at(-1)?.words ?? []
  return words.length === 1 && !marked(words[0].value) ? words[0] : undefined
}

// The steady variables the call has set by now whose values the hook holds, an assignment that names an earlier one (`T="$S/x"`) lexed again with it, in the order they were set
function heldVars(env: Env, steady: Steady): Record<string, string> {
  const known = { ...env.known }
  for (const [key, text] of env.vars) {
    // a TMPDIR the call sets steers mktemp, so mktemp's path stays unheld
    if (key === "TMPDIR" || !steady.has(key)) continue
    if (!text.unknown && !marked(text.value)) known[key] = text.value
    else if ("raw" in text && typeof text.raw === "string") {
      const again = relexed(text.raw, known)?.value
      if (again?.startsWith(`${key}=`)) known[key] = again.slice(key.length + 1)
    }
  }
  return known
}

// Whether the hook holds a word's whole value
const held = (word: Word, env: Env, steady: Steady): boolean =>
  !marked(word.value) || !!heldWord(word, env, steady)

// The values git's -c options set before its subcommand (`-c k=v`, `-ck=v`)
function gitConfigs(args: Word[]): Word[] {
  const configs: Word[] = []
  for (let k = 0; k < args.length; k++) {
    const { value } = args[k]
    if (value === "-c" && args[k + 1]) configs.push(args[++k])
    else if (value.startsWith("-c") && value.length > 2) configs.push(args[k])
    else if (GIT_TAKES.has(value)) k++
    else if (!value.startsWith("-")) break
  }
  return configs
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
// what lets an awk program run a command or write a file: system(), getline, a > redirect or an @ directive, and a | pipe outside the literals awkPipe allows
const AWK_RUNS = /system|getline|[>@]/
const awkRuns = (program: string) => AWK_RUNS.test(program) || awkPipe(program)

// The literals a | may sit in without piping: a regex that is the program's whole leading pattern (`/a|b/`, `/a|b/ {…}`), and a regex or a string right after ~ (`$1 ~ /a|b/`, `$1 ~ "a|b"`), each holding no quote, no [ and no newline
const AWK_LEAD = /^\s*\/(?:[^\\/"[\n]|\\.)*\/(?=\s*(?:\{|$))/
const AWK_MATCH = /~\s*(?:\/(?:[^\\/"[\n]|\\.)*\/|"[^"\\\n]*")/g

// Whether a program holding a | may pipe: once the allowed literals are cut out, any |, quote, /, # or backslash left counts as one, as canary counted every |
function awkPipe(program: string): boolean {
  if (!program.includes("|")) return false
  return /["/#\\|]/.test(program.replace(AWK_LEAD, " ").replace(AWK_MATCH, " "))
}

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
    .filter(({ value }) => rooted || awkRuns(value))
    .flatMap(({ value }) => [...value.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]))
}

// Whether a call's program is its command's own first word, read outright, bare or by a system path, so no wrapper or file of another folder runs in its place
function ownProgram(cmd: Command, { first, name }: Parsed): boolean {
  return (
    ownFirst(cmd, first) &&
    !marked(name) &&
    /^(?:\/(?:bin|opt\/homebrew\/bin|usr\/bin|usr\/local\/bin)\/)?[^/]+$/.test(first.value)
  )
}

// Whether a call is a closed-list reader whose quoted words are never a command line: awk, cat, cut, grep, head, sort, tail, uniq or wc, or a read-only gh call with a jq filter, as its own program (ownProgram), with no variable set in the call
function narrow(cmd: Command, env: Env): boolean {
  const parsed = parse(cmd)
  const { args, first } = parsed
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
  if (!ownProgram(cmd, parsed)) return false
  const base = program(first.value).toLowerCase()
  if (AWKS.has(base)) {
    const programs = awkPrograms(args)
    return !!programs && programs.every(({ value }) => !marked(value) && !awkRuns(value))
  }
  if (["cat", "grep", "head", "tail", "wc"].includes(base)) return reads(parsed, env)
  if (base === "cut") return true
  // a read-only gh call is narrow when its jq filter is the only word that holds a space
  if (base === "gh") {
    const filters = ghFilters(parsed)
    return filters.size > 0 && args.every((a) => filters.has(a) || !/\s/.test(a.value))
  }
  if (base === "sort") return !args.some(({ value }) => /^-[a-zA-Z]*o|^--./.test(value))
  if (base === "uniq")
    return args.filter(({ value }) => value === "-" || !value.startsWith("-")).length <= 1
  return false
}

// Whether a line holds a shell reading its script from stdin (`sudo -s`, `sh`) or a command its pipe feeds as code (codeFed) anywhere, its groups' and substitutions' included, which runs whatever a reader prints into it
function rooted(commands: Command[]): boolean {
  if (codeFed(commands).size > 0) return true
  return commands.some(
    (cmd) =>
      !!stdinShell(cmd) ||
      (!!cmd.inner && rooted(cmd.inner())) ||
      [...cmd.words, ...cmd.redirects.flatMap((r) => (r.target ? [r.target] : []))].some(
        (word) => !!word.procs && rooted(word.procs),
      ),
  )
}

// A git commit the hook reads as text: git as its own program (ownProgram), its sub commit, no shell variable set, no git option ahead of commit that changes what git runs or where (-c, -C, --config-env, --exec-path, --git-dir, --work-tree), and every spaced word a quoted message it holds (after -m, a flag cluster ending in m, --message, or --message=), since commit runs no word it is given.
function quietCommit(cmd: Command, parsed: Parsed, env: Env): boolean {
  const { args, local, name } = parsed
  if (name !== "git" || local.size > 0 || !ownProgram(cmd, parsed)) return false
  const { rest, sub } = gitCall(args, env)
  if (sub !== "commit") return false
  const before = args.slice(0, args.length - rest.length - 1).map((a) => a.value)
  if (
    before.some(
      (w) => w === "-c" || w === "-C" || /^--(?:config-env|exec-path|git-dir|work-tree)/.test(w),
    )
  )
    return false
  return args.every(
    (word, at) =>
      !/\s/.test(word.value) ||
      (word.quoted &&
        !marked(word.value) &&
        (/^(?:-[a-zA-Z]*m|--message)$/.test(args[at - 1]?.value ?? "") ||
          word.value.startsWith("--message="))),
  )
}

// Whether a line is read whole, as canary read it, every spaced text of every program but a reader a command line; a line is read call by call only when every command, its substitutions' included, is narrow or a quiet commit and no redirect writes a file
function wholeLine(commands: Command[], env: Env): boolean {
  return commands.some((cmd) => {
    const words = [...cmd.words, ...cmd.redirects.flatMap((r) => (r.target ? [r.target] : []))]
    if (words.some((word) => word.procs && wholeLine(word.procs, env))) return true
    const writes = cmd.redirects.some((r) => writer(r) && r.target?.value !== "/dev/null")
    return writes || !(narrow(cmd, env) || quietCommit(cmd, parse(cmd), env))
  })
}

// Calls whose string argument a shell runs: exec and execSync in a program that names child_process, and execFile, execFileSync, spawn and spawnSync in a program that names `shell` other than as a key whose whole value is a literal `false` (true, a shell's path, a value read at run time or an expression that starts with `false` all run one). A ~ in that string expands to the home as the shell runs it, so the string is judged as its own shell line rather than left relative to the cwd.
const IMPLICIT_SHELL = new Set(["exec", "execSync"])
const SHELL_RUNNER = /\b(exec|execFile|execFileSync|execSync|spawn|spawnSync)\s*\(/g
// `shell`, a quoted key's quotes included, and the `: false` after it when that is its whole value, ended by a comma or a closing bracket.
const SHELL_WORD = /(["']?)\bshell\b\1(\s*:\s*false\b(?=\s*[,})]))?/g

// Whether a program names a `shell` other than a key whose whole value is a literal false: read across the program, since a shorthand property, a spread or an options object passed by name carries the option outside the call's own text.
function namesShell(text: string): boolean {
  return [...text.matchAll(SHELL_WORD)].some((m) => !m[2])
}

function skipSpace(src: string, k: number): number {
  while (k < src.length && /\s/.test(src[k])) k++
  return k
}

// A JavaScript string literal at `src[i]` (a ', " or ` quote): its content and the index past the close, or undefined when `src[i]` is no quote or a template holds a ${…} substitution.
function stringLiteral(src: string, i: number): { end: number; value: string } | undefined {
  const quote = src[i]
  if (quote !== '"' && quote !== "'" && quote !== "`") return undefined
  let value = ""
  let k = i + 1
  while (k < src.length && src[k] !== quote) {
    if (src[k] === "\\") {
      value += src[k + 1] ?? ""
      k += 2
    } else value += src[k++]
  }
  if (quote === "`" && value.includes("${")) return undefined
  return { end: k + 1, value }
}

// The command string a shell-running call is given, read from just after its `(`: a run of string literals joined by `+`, or undefined when the first argument is not a literal run (an array, a variable, a template with a substitution). A shell variable ($VAR) inside the literal is kept and judged as the shell reads it, so the rest of the line is still judged.
function commandString(src: string, open: number): string | undefined {
  let value = ""
  let k = open
  for (;;) {
    k = skipSpace(src, k)
    const literal = stringLiteral(src, k)
    if (!literal) return undefined
    value += literal.value
    k = skipSpace(src, literal.end)
    if (src[k] !== "+") break
    k++
  }
  return value
}

// Each command string a shell-running call in a program's text is given, so a ~ in one is judged as the shell expands it; exec and execSync count only in a program that names child_process, so a regex's or a query's `.exec` is left alone, and a spawn, spawnSync, execFile or execFileSync counts only in a program that names a `shell` other than a key whose whole value is a literal `false`.
function shellRunnerArgs(text: string): string[] {
  const out: string[] = []
  const childProcess = text.includes("child_process")
  const shell = namesShell(text)
  for (const m of text.matchAll(SHELL_RUNNER)) {
    const open = m.index + m[0].length
    const command = commandString(text, open)
    if (command === undefined) continue
    if ((IMPLICIT_SHELL.has(m[1]) && childProcess) || shell) out.push(command)
  }
  return out
}

// Every text of a variable the call sets or exports, and on a line read whole of every word, that holds a space, a leading ! dropped, each read as a command line of its own, and the command string a shell-running call in it is given; `vars` is the scope's variables set since their lines were last read.
function runsOf(parsed: Parsed, vars: Text[], whole: boolean, rootLine: boolean): string[] {
  const { args, first, local } = parsed
  const values = [...local.values(), ...vars].flatMap((text) => {
    tick()
    return text.unknown ? [] : [text.value]
  })
  for (const word of whole ? (first ? [first, ...args] : args) : [])
    for (const text of texts(word)) {
      values.push(text.value.replace(/^!/, ""))
      // printf and echo -e print a \n as a line break, which a root shell runs as one
      if (rootLine) values.push(...text.value.split("\\n"))
      values.push(...shellRunnerArgs(text.value))
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
      ? "playground uninstall --purge, which moves the data folder aside"
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
    return "playground ext accept, the owner's own call: post it as an accept decision with bun run ask new (.agents/dashboard/asks.md), whose Approve has the dashboard run it with no role, since the CLI refuses an accept with PLAYGROUND_ROLE set"
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

// unknown: the line names HOME, TMPDIR or PWD other than by expanding them, so it is read a second time with those unknown, since the shell's value may not be the environment's
async function inspect(raw: string, environment: Environment, unknown = false) {
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
  let steadyAt: (cmd: Command) => Steady = () => NONE
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
    return keys.flatMap((k) => {
      tick()
      return vars.get(k) ?? []
    })
  }
  const visit: Visit = async (cmd: Command, parsed, env) => {
    const slot = slotWords(parsed)
    if (slot)
      return slot.length === 0 ? undefined : examine({ ...cmd, words: slot }, env, visit, false)
    const { args, first, name, xargs } = parsed
    // every folder the shell may be in, so a write a cd the reader cannot be sure of would land in the root is judged there too
    for (const here of places(env)) {
      const into = cmd.redirects.find(
        (r) =>
          r.target &&
          writer(r) &&
          (inRoot(pathOf(r.target, here)) ||
            (GLOB.test(r.target.value) && !!names(r.target, here, true))),
      )
      if (into?.target) return refuse(`a write to ${pathOf(into.target, here)}`)
    }
    // past the cap the root may be a folder places() dropped, so a writing redirect whose target leans on the shell's own folder is refused before a reader or an echo lets it run
    const blind = env.cwdAnywhere
      ? cmd.redirects.find(
          (r) =>
            r.target && writer(r) && pathOf(r.target, { ...env, cwd: undefined }) === undefined,
        )
      : undefined
    if (blind?.target)
      return refuse(
        `a write to ${blind.target.value} on a line that names more folders than the hook carries, since it cannot rule out ${root}; run it as a line of its own after a cd to a literal path`,
      )
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
    // a quiet commit's message is text git never runs, but one naming a gated call is refused all the same
    const quiet = !whole && quietCommit(cmd, parsed, env)
    for (const word of quiet ? args : []) {
      if (!/\s/.test(word.value)) continue
      const named = lex(word.value.replace(/^--message=/, ""), env.known)
        .commands.flatMap((c) => cliCalls(parse(c), env))
        .map((words) => cliWrite(words))
        .find(Boolean)
      if (named) return refuse(named)
    }
    // a bare assignment or export with no command, or a reader: only its redirect writes, and a variable it sets is read where a command runs with it
    if (!first || EXPORTS.has(name) || reader) return
    // a program word the hook cannot read is named as such, so a refusal always names what runs
    const verb = name && !marked(name) ? name : "a program it cannot read"
    const remover = REMOVERS.has(name)
    // a line that names more folders than the reader carries (`Env.cwdAnywhere` in shell.ts) may run inside this root, whatever folder it started in
    if (env.cwdAnywhere)
      return refuse(
        `${verb} on a line that names more folders than the hook carries, since it cannot rule out ${root}; run it as a line of its own after a cd to a literal path`,
      )
    const steady = steadyAt(cmd)
    // on a line read call by call, a read-only gh call's jq filter is text, never a path
    const filters = whole ? new Set<Word>() : ghFilters(parsed)
    // each folder the shell may be in, so a program a cd the reader cannot be sure of would run inside the root, or a path of its own that lands there, is judged in every one
    for (const here of places(env)) {
      if (inRoot(here.cwd)) return refuse(`${verb} run inside ${root}`)
      if (name === "git" && inRoot(gitCall(args, here).cwd))
        return refuse(`git on a clone in ${root}`)
      // a value the hook cannot read under a remover, or in git's -c, could name the root, so it is refused unless the call holds it
      const unheld = remover ? args.find((word) => !held(word, here, steady)) : undefined
      if (unheld)
        return refuse(
          `${verb} on ${shown(unheld)}, a value the hook does not hold; hold it in the same call (X=<path>; ${verb} "$X") or write the path literally`,
        )
      if (name === "git") {
        const config = gitConfigs(args).find((word) => marked(word.value))
        if (config)
          return refuse(
            `git ${/^-c./.test(config.raw ?? config.value) ? "" : "-c "}${shown(config)}, a value built from a variable or a substitution; write the value literally in the call`,
          )
      }
      const scope = since(varsJudged, here.vars, `${here.cwd}\0${remover}`)
      for (const value of [...parsed.local.values(), ...scope]) {
        const named = names({ ...value, quoted: false }, here, remover)
        if (named) return refuse(`${verb} with a variable on ${named}`)
      }
      const literal = !whole && narrow(cmd, here)
      for (const word of [first, ...args].map((word) => heldWord(word, here, steady) ?? word)) {
        // a quiet commit's message and a gh filter are text, judged only when the root is in it; a filter's unquoted glob is the shell's, judged as any glob
        const text = (quiet && /\s/.test(word.value)) || (filters.has(word) && !word.glob)
        if (text && !texts(word).some((t) => holds(t.value, here))) continue
        const named = names(word, here, remover, literal)
        if (named) return refuse(`${verb} on ${named}`)
      }
      if (cmd.redirects.some((r) => r.body && holds(r.body.value, here)))
        return refuse(`${verb} with a script that names ${root}`)
      if (fed && remover && (fed.unknown || marked(fed.value)))
        return refuse(
          `${verb} under xargs fed by ${fed.unknown ?? "a value it cannot read"}, a value the hook does not hold; write the paths literally in the call`,
        )
      if (fed) {
        const named =
          !fed.unknown &&
          fed.value
            .split(/\s+/)
            .filter(Boolean)
            .map((value) => names({ quoted: false, value }, here, remover))
            .find(Boolean)
        if (named) return refuse(`${verb} under xargs on ${named}`)
      }
    }
  }
  const named = namings(command)
  const known = knownVariables(command, environment, directory)
  const steered = Object.keys(known).filter((key) => named.counts.has(key))
  if (unknown) for (const key of steered) delete known[key]
  const lexed = lex(command, known)
  steadyAt = steadyNames(named, lexed.commands)
  const env: Env = {
    cwd: directory,
    // the line starts in the folder the tool names, which the reader has proved by the payload itself
    cwdSure: directory,
    files: new Map(),
    known,
    // zsh starts with OLDPWD at the folder it starts in
    old: { dir: directory },
    process: environment,
    vars: new Map(),
  }
  // a line with a root shell is read whole with no reader spared, an awk program's strings its lines, since what a reader prints into the shell runs
  rootLine = rooted(lexed.commands)
  whole = rootLine || wholeLine(lexed.commands, env)
  // a line holding an ext score is refused whole once any command on it changes who the session reads as, so a shell it runs or pipes into carries the change
  if (SCORE.test(unquoted(command)) && changesIdentity(lexed.commands))
    return refuse(SCORE_AS_OTHER)
  const verdict = await run(lexed, env, visit, true)
  if (verdict || unknown || steered.length === 0) return verdict
  return inspect(raw, environment, true)
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
