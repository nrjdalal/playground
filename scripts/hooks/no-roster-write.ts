// A check for a factory session: refuses an Edit, a Write or a shell write to the live roster, the data folder's roster.json, whose one writer is scripts/roster.ts (the roster rule), and lets its readers (READERS) run. guards.ts runs it on Bash and no-raw-wa's process on the file tools, so it has no main block of its own. A write position it cannot read, where the call may build it toward the file (builtToward), is refused, failing closed.
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, resolve } from "node:path"

import { dataDirOf } from "../../packages/env/src/data-dir"
import { eachInput } from "./codex"
import {
  type Command,
  knownVariables,
  lex,
  marked,
  outputOf,
  places,
  program,
  run,
  stdinOf,
  type Env,
  UNKNOWN,
  type Visit,
  visible,
  type Word,
  type Xargs,
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
  "column",
  "cut",
  "diff",
  "dirname",
  "du",
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
  "md5sum",
  "more",
  "nl",
  "od",
  "printf",
  "readlink",
  "realpath",
  "rg",
  "sha1sum",
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

// Programs that write or change every file operand they name (a mode, an owner, a flag, a compressed copy in its place), so an operand the hook cannot read is a write position.
const WRITERS = new Set([
  "bzip2",
  "chflags",
  "chgrp",
  "chmod",
  "chown",
  "dd",
  "gzip",
  "install",
  "ln",
  "mv",
  "pigz",
  "rm",
  "shred",
  "tee",
  "touch",
  "truncate",
  "unlink",
  "xz",
  "zstd",
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

// A write in inline code: a write call, an open() for writing or appending, a rename, an unlink, a removal, a remove, delete or move call, a truncate, or a redirect's > (an arrow's => and a comparison's >= aside).
const WRITE_WORDS =
  /write|open\s*\((?:[^()]|\([^()]*\))*,\s*["'][^"']*[wa]|rename|unlink|\brm|(?:remove|delete|move)\s*\(|truncate|(?<![=-])>(?!=)/i
// A path in the code, from its first slash, its segments up to a quote, a blank, a bracket or a shell operator: its folders (a temp folder's -rMNlX1, a no-roster-write folder) hold no write, and its last segment (/bin/rm) and the word before its first slash (writeFileSync/**/) are kept.
const PATHS = /(?:\/[^\s"'`/()<>|&;=,]*)+/g
const writesCode = (code: string) =>
  WRITE_WORDS.test(code.replace(PATHS, (path) => path.slice(path.lastIndexOf("/") + 1)))

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

// Whether code names the roster's folder itself (not a deeper path in it) and a bare roster.json apart (a cd into the folder, a path join), which the code may join into the roster.
const namesApart = (text: string, targets: string[]) => {
  const plain = text.replace(/["'\\]/g, "").toLowerCase()
  if (!/(?<![\w.-]\/)(?<![\w.-])roster\.json(?![\w.-])/.test(plain)) return false
  return (
    targets.some((t) =>
      new RegExp(`${dirname(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-]|/[\\w.-])`).test(
        plain,
      ),
    ) || /\.playground(?![\w.-]|\/[\w.-])|playground_data_dir/.test(plain)
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

// The literal text after a word's last expansion as written, quotes removed: `.md` for `brief-$name.md`, empty for `$F`, `"$(cmd)"` or an xargs -I item a shell's script was filled with unread (UNKNOWN).
const tailOf = (source: string): string => {
  const text = source.replace(/["']/g, "")
  const at = text.lastIndexOf("$")
  const filled = text.lastIndexOf(UNKNOWN)
  if (filled > at) return text.slice(filled + 1)
  if (at < 0) return text
  const rest = text.slice(at + 1)
  if (rest[0] === "{") return rest.slice(rest.indexOf("}") + 1)
  if (rest[0] === "(") return rest.slice(rest.lastIndexOf(")") + 1)
  return rest.replace(/^(?:\w+|[-@*#?$!])/, "")
}

const SEDS = new Set(["sed"])
const FINDS = new Set(["find"])
// find's actions that run a program on each path it reaches, up to a ; or a +, its {} standing for the path
const FIND_EXECS = new Set(["-exec", "-execdir", "-ok", "-okdir"])
// find's actions that write the file named after them, wherever the search starts
const FIND_FILES = new Set(["-fls", "-fprint", "-fprint0", "-fprintf"])
// find's operators that let a path a -name test misses through, GNU's and bfs's , among them
const FIND_OR = new Set(["!", ",", "-not", "-o", "-or"])
// The items of fed text the hook reads one by one; past them the text counts as input it cannot see
const ITEMS = 100
// find's option words before its start points: BSD's flags, GNU's -O level and -D list attached
const FIND_FLAGS = /^-(?:[EHLPXdsx]+|O\d*|D\S+)$/

// The programs this hook reads by name; a g before one (gmv, gtee) is GNU's copy of it, read as the plain program.
const KNOWN = new Set([...FINDS, ...PLACERS, ...READERS, ...SEDS, ...WRITERS])

const shown = (word: Word) => word.source ?? visible(word.value)

// sed writes the files it names in place given -i or --in-place, and only reads them otherwise.
const inPlace = (args: Word[]) => args.some((a) => /^-[A-Za-z]*i|^--in-place/.test(a.value))

// sort's output files: -o's value attached (-o<v>, -uo<v>) or the next word, and --output's after = or the next word.
const sortOutputs = (args: Word[]): Word[] =>
  args.flatMap((a, i) => {
    const own = (value: string) => [{ ...a, raw: undefined, source: undefined, value }]
    const next = args[i + 1] ? [args[i + 1]!] : []
    if (a.value === "--output") return next
    if (a.value.startsWith("--output=")) return own(a.value.slice("--output=".length))
    const short = /^-[A-Za-z]*o(.*)$/.exec(a.value)
    if (!short) return []
    return short[1] ? own(short[1]) : next
  })

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
    cwdSure: cwd,
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
  // Whether an unread word may be built toward the roster: the call names it, the word's text before its first expansion is in a folder holding it (`<data folder>/$f`), or the word starts with an expansion, the line holds a read, and the roster is near or the shell's folder holds it (unseenHolds), as for input the hook cannot see.
  const builtToward = (typed: Word, at: Env) => {
    if (named) return true
    const prefix = typed.value.slice(0, typed.value.search(/[\u0000\u0001]/))
    if (prefix) {
      const folder = prefix.slice(0, prefix.lastIndexOf("/") + 1)
      return !!folder && holdsWord({ ...typed, glob: false, value: folder }, at)
    }
    return lexed.commands.some((c) => c.words.some((w) => w.value === "read")) && unseenHolds(at)
  }
  // A word unread in a write position (a redirect's target, a placer's destination, a writer's operand, sort's -o) may write the roster when it may be built toward it (builtToward) and the text after its last expansion may end its path; an unread operand of any other program runs.
  const writes = (typed: Word, at: Env, position = false) => {
    const paths = pathsOf(typed, at)
    if (!paths) {
      const tail = tailOf(typed.source ?? typed.raw ?? "").toLowerCase()
      return position && targets.some((t) => t.endsWith(tail)) && builtToward(typed, at)
    }
    return paths.some(({ glob, path }) => isRoster(path, targets, glob))
  }
  // The roster as a word a program takes, for a path stdin or a search may hand it
  const roster: Word = { quoted: true, source: targets[0]!, value: targets[0]! }
  // The roster stood in for input the hook cannot see, which only a program that writes each operand it names (WRITERS, an in-place sed), a program the hook cannot name or a placer's destination is refused on, as an unread operand is
  const unseen = new WeakSet<Word>()
  const unseenRoster: Word = { ...roster }
  unseen.add(unseenRoster)
  const toolOf = (name: string) => {
    const prog = program(name)
    // GNU coreutils, find and sed under their g-prefixed names (gmv, gtee, gfind, gsed) run as the plain ones
    return /^g./.test(prog) && KNOWN.has(prog.slice(1)) ? prog.slice(1) : prog
  }
  // Whether a path, a glob's pattern when glob is set, is the roster or a folder holding it.
  const holds = (path: string, glob: boolean) =>
    targets.some((target) => {
      const p = segments(path)
      const t = segments(target)
      if (glob && p.some((s) => s.includes("**"))) return true
      return (
        p.length <= t.length &&
        p.every((s, i) => (glob ? new Bun.Glob(s).match(t[i]!) : s === t[i]))
      )
    })
  const holdsWord = (word: Word, at: Env) =>
    pathsOf(word, at)?.some(({ glob, path }) => holds(path, glob)) ?? false
  const lexed = lex(command, env.known)
  // Whether the call reaches toward the roster: it names it, or a word of it is the roster or a folder holding it.
  const near = named || lexed.commands.some((c) => c.words.some((w) => holdsWord(w, env)))
  // Whether output the hook cannot see may list the roster: the call reaches toward it, or the shell's folder holds it.
  const unseenHolds = (at: Env) => near || places(at).some(({ cwd }) => !!cwd && holds(cwd, false))
  // A find's start points past its leading options (BSD's -f names one), else the shell's folder.
  const startsOf = (args: Word[]): Word[] => {
    const starts: Word[] = []
    let i = 0
    for (; i < args.length; i++) {
      const v = args[i]!.value
      if (v === "--") {
        i++
        break
      }
      if (v === "-D" || v === "-f") {
        if (v === "-f" && args[i + 1]) starts.push(args[i + 1]!)
        i++
      } else if (!FIND_FLAGS.test(v)) break
    }
    for (; i < args.length && !/^[-(!,]/.test(args[i]!.value); i++) starts.push(args[i]!)
    return starts.length ? starts : [{ quoted: false, value: "." }]
  }
  // Whether a find's search may reach the roster: a start point is or holds it, or cannot be read, and its -name and -iname tests do not all miss roster.json with none of FIND_OR's operators to let a miss through; a pattern it cannot read, or one with a backslash escape, may match.
  const reaches = (args: Word[], at: Env): boolean => {
    const start = startsOf(args).some((w) => {
      const paths = pathsOf(w, at)
      return !paths || paths.some(({ glob, path }) => holds(path, glob))
    })
    if (!start) return false
    const names = args.flatMap((a, i) =>
      (a.value === "-name" || a.value === "-iname") && args[i + 1]
        ? [{ insensitive: a.value === "-iname", word: args[i + 1]! }]
        : [],
    )
    if (!names.length || args.some((a) => FIND_OR.has(a.value))) return true
    return names.some(({ insensitive, word }) => {
      const read = readOf(word, at)
      if (!read || read.value.includes("\\")) return true
      return new Bun.Glob(insensitive ? read.value.toLowerCase() : read.value).match("roster.json")
    })
  }
  const isFind = (cmd: Command | undefined) => !!cmd && FINDS.has(toolOf(cmd.words[0]?.value ?? ""))
  // Fed text as the words it hands on: split at its delimiters, else at lines for an -I string, else at blanks; text holding more than ITEMS of them is judged as input the hook cannot see, so a writer it feeds is refused.
  const itemsOf = (text: string, xargs?: NonNullable<Xargs>): Word[] => {
    const at = xargs?.delimiters?.length
      ? new RegExp(xargs.delimiters.map((d) => d!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"))
      : xargs?.replace
        ? /\n/
        : /\s+/
    return text
      .split(at)
      .map((v) => (xargs?.replace ? v.trim() : v.replace(/["']/g, "")))
      .filter(Boolean)
      .map((value) => ({ glob: /[*?[]/.test(value), quoted: false, value }))
  }
  // Whether a command's output may list the roster: a find that reaches it, text holding it as a path, or output the hook cannot see where unseenHolds.
  const listsRoster = async (
    cmd: Command,
    args: Word[],
    tool: string,
    at: Env,
    viaXargs: boolean,
  ) => {
    if (FINDS.has(tool)) return reaches(args, at)
    const out = await outputOf(cmd, at)
    if (marked(out.value)) return viaXargs && unseenHolds(at)
    const items = itemsOf(out.value)
    if (items.length > ITEMS) return viaXargs && unseenHolds(at)
    return namesRoster(out.value, targets) || items.some((w) => writes(w, at))
  }
  // The words an xargs hands its program, one list per run: each fed item in its -I string's place, else after the program's own words; the roster for a find that reaches it, or for input the hook cannot see (unread, or past ITEMS items) where unseenHolds.
  const xargsRuns = async (cmd: Command, args: Word[], xargs: NonNullable<Xargs>, at: Env) => {
    const mark = xargs.replace
    const fill = (a: Word, mark: string, item: Word): Word => {
      // an unseen item right after a folder in the -I string may be any name in it (`xargs -I{} rm <data folder>/{}`)
      const anyName = unseen.has(item) && a.value.slice(0, a.value.indexOf(mark)).endsWith("/")
      const word = {
        ...a,
        glob: a.glob || item.glob || anyName,
        raw: undefined,
        source: undefined,
        value: a.value.replaceAll(mark, anyName ? "*" : item.value),
      }
      if (unseen.has(item)) unseen.add(word)
      return word
    }
    const put = (items: Word[]): Word[][] =>
      mark
        ? items.map((item) => args.map((a) => (a.value.includes(mark) ? fill(a, mark, item) : a)))
        : [[...args, ...items]]
    // an -I string placing an item right after a folder holding the roster (`<data folder>/{}`) reaches toward it, whatever feeds the input
    const intoFolder =
      !!mark &&
      args.some((a) =>
        a.value
          .split(mark)
          .slice(0, -1)
          .some((before) => {
            const folder = before.slice(before.search(/[^\s"'=]*$/))
            return folder.endsWith("/") && holdsWord({ ...a, glob: false, value: folder }, at)
          }),
      )
    const unseenReach = () => intoFolder || unseenHolds(at)
    if (isFind(cmd.stdin)) return reaches(cmd.stdin!.words.slice(1), at) ? put([roster]) : []
    const input = await stdinOf(cmd, at)
    if (xargs.files?.length || xargs.delimiters?.includes(undefined) || marked(input.value))
      return unseenReach() ? put([unseenRoster]) : []
    const items = itemsOf(input.value, xargs)
    if (items.length > ITEMS) return unseenReach() ? put([unseenRoster]) : []
    return items.length ? put(items) : []
  }
  const visit: Visit = async (cmd, parsed, at) => {
    const { args, name, xargs } = parsed
    for (const r of cmd.redirects)
      if (r.target && r.op.includes(">") && writes(r.target, at, true))
        return refuse(`a redirect onto ${shown(r.target)}`)
    if (!program(name)) return
    const tool = toolOf(name)
    // a program a pipe feeds as code (`| xargs sh -c 'rm "$0"'`) runs on this one's output, read past the script's own words; unseen output counts only when xargs hands it on
    if (cmd.feedsShell) {
      const xargsFed = lexed.commands.some(
        (c) => c.stdin === cmd && program(c.words[0]?.value ?? "") === "xargs",
      )
      if (await listsRoster(cmd, args, tool, at, xargsFed))
        return refuse(`${tool} feeding the roster to a program that runs it as code`)
    }
    // a program xargs runs takes its input as words: its -I string's place, else after its own words
    if (xargs) {
      const runs = await xargsRuns(cmd, args, xargs, at)
      for (const fed of runs) {
        const found = await visit(cmd, { ...parsed, args: fed, xargs: undefined }, at)
        if (found) return found
      }
      if (runs.length) return
    }
    if (FINDS.has(tool)) {
      for (const [i, a] of args.entries())
        if (FIND_FILES.has(a.value) && args[i + 1] && writes(args[i + 1]!, at, true))
          return refuse(`${tool} ${a.value} onto ${shown(args[i + 1]!)}`)
      const reached = reaches(args, at)
      if (reached && args.some((a) => a.value === "-delete"))
        return refuse(`${tool} -delete reaching the roster`)
      // each command find runs is read as a line of its own, an sh -c script included, with {} as the roster where the search may reach it
      for (const [i, a] of args.entries()) {
        if (!FIND_EXECS.has(a.value) || !args[i + 1]) continue
        const end = args.findIndex((w, j) => j > i && (w.value === ";" || w.value === "+"))
        const line = args
          .slice(i + 1, end < 0 ? undefined : end)
          .map((w) => {
            const typed = w.raw ?? w.source ?? `'${w.value.replaceAll("'", `'\\''`)}'`
            return reached ? typed.replaceAll("{}", roster.value) : typed
          })
          .join(" ")
        const found = await run(lex(line, at.known), { ...at, vars: new Map(at.vars) }, visit, true)
        if (found) return found
        // the command itself, its {} a word of its own as find hands it (`sh -c 'rm "$0"' {}`), so a program the roster reaches as an argument is judged with it
        const [first, ...rest] = args.slice(i + 1, end < 0 ? undefined : end)
        const own = await visit(
          cmd,
          {
            ...parsed,
            args: rest.map((w) => (reached && w.value.includes("{}") ? roster : w)),
            first,
            name: first!.value,
            xargs: undefined,
          },
          at,
        )
        if (own) return own
      }
      return
    }
    if (
      CODE_RUNNERS.has(tool) &&
      args.some(
        (a) =>
          (namesRoster(a.value, targets) || namesApart(a.value, targets)) && writesCode(a.value),
      )
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
    // sort writes the file its -o names, attached or next, in a cluster (-uo) too, or its --output
    if (tool === "sort")
      for (const out of sortOutputs(args))
        if (writes(out, at, true)) return refuse(`sort -o onto ${shown(out)}`)
    if (READERS.has(tool)) return
    const writer = WRITERS.has(tool) || SEDS.has(tool)
    // the unseen roster reaches a writer, and a program the hook cannot name, which may be one
    for (const word of args)
      if ((writer || marked(name) || !unseen.has(word)) && writes(word, at, writer))
        return refuse(`${tool} on ${shown(word)}`)
  }
  return run(lexed, env, visit, true)
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
