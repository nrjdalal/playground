// PreToolUse hook: refuses a git merge or git pull with the ours strategy or the ours strategy option, since the PR's squash onto canary then deletes whatever canary added that the merge ignored, while canary reads as merged in and every gate stays green; and a git merge, pull or commit with its hooks off (--no-verify, a commit's -n), since its commit then skips commit-msg and a commit's pre-commit.

import { input } from "./input"
import { gitCommand } from "./no-stash"
import { fromFactory } from "./role"
import {
  braceWords,
  type Env,
  knownVariables,
  lex,
  marked,
  PRINTERS,
  program,
  run,
  visible,
  type Visit,
  type Word,
} from "./shell"

const SUBS = new Set(["merge", "pull"])
// The subcommands whose --no-verify turns off the hooks of the commit they make
const VERIFIED = new Set(["commit", "merge", "pull"])
// Short options of git merge and git pull that take a value, attached or as the next word; ATTACHED's take only an attached one.
const SHORT_TAKES = new Set(["F", "X", "m", "o", "s"])
// Short options whose value is only an attached one, so the next word is an option of its own: -S (merge, pull, commit), pull's -j, commit's -u
const ATTACHED = new Set(["S", "j", "u"])
// How deep the hook follows an alias whose text names another alias
const ALIAS_DEPTH = 8
const INSTEAD =
  "Merge canary in plainly instead: git merge origin/canary, and resolve each conflict keeping both sides' meaning. With ours, the PR's squash onto canary deletes whatever canary added that the merge ignored, while every gate still reads green."

const AGAIN =
  "Run it again without --no-verify (or a commit's -n), so git runs the hooks of the commit it makes. A reviewer's local merge of canary drops --no-verify too: git -C <clone> merge --no-edit origin/canary runs the clone's own hooks."

// The values of options a merge, pull or commit takes as the next word, so a value spelled --no-verify is read as git reads it
const TAKES: Record<string, Set<string>> = {
  commit: new Set([
    "--author",
    "--cleanup",
    "--date",
    "--file",
    "--fixup",
    "--message",
    "--pathspec-from-file",
    "--reedit-message",
    "--reuse-message",
    "--squash",
    "--template",
    "--trailer",
  ]),
  merge: new Set([
    "--cleanup",
    "--file",
    "--into-name",
    "--message",
    "--strategy",
    "--strategy-option",
  ]),
  pull: new Set(["--cleanup", "--file", "--strategy", "--strategy-option", "--upload-pack"]),
}
// A commit's short options that take a value, attached or as the next word
const COMMIT_SHORT = new Set(["C", "F", "c", "m", "t"])

// One walk of a merge's, pull's or commit's options as git reads them, past each option's value and up to --: whether it asks for help (-h or --help read as an option), and the option that turns the hooks off, as written, when it is the last word of --no-verify and --verify; a commit also takes -n, alone or in a cluster of short options, and an abbreviation of --no-verify longer than the ambiguous --no-ver; a merge's and a pull's -n is --no-stat.
function walk(sub: string, args: Word[]): { help: boolean; off?: string } {
  let off: string | undefined
  let help = false
  const commit = sub === "commit"
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (v === "--") break
    if (v === "-h" || v === "--help") help = true
    else if (v.startsWith("--")) {
      if (v === "--verify") off = undefined
      else if (v === "--no-verify" || (commit && v.length > 8 && "--no-verify".startsWith(v)))
        off = v
      else if (TAKES[sub]?.has(v)) k++
      continue
    }
    if (!v.startsWith("-") || v === "-") continue
    for (let c = 1; c < v.length; c++) {
      const letter = v[c]
      if (commit && letter === "n") off = "-n"
      else if (ATTACHED.has(letter)) break
      else if ((commit ? COMMIT_SHORT : SHORT_TAKES).has(letter)) {
        if (c === v.length - 1) k++
        break
      }
    }
  }
  return { help, off }
}

// A long option git reads as --strategy or --strategy-option: either name whole, or an abbreviation of --strategy-option longer than --strategy (a shorter one is ambiguous, which git refuses).
const strategyLong = (name: string): boolean =>
  name === "strategy" || (name.length > "strategy".length && "strategy-option".startsWith(name))

// Every -s, -X, --strategy and --strategy-option value a merge or pull names, with the option as written.
function strategies(args: Word[]): { flag: string; value?: Word }[] {
  const found: { flag: string; value?: Word }[] = []
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (v === "--") break
    if (v.startsWith("--")) {
      const eq = v.indexOf("=")
      const name = v.slice(2, eq === -1 ? undefined : eq)
      if (!strategyLong(name)) continue
      if (eq !== -1)
        found.push({ flag: `--${name}`, value: { ...args[k], value: v.slice(eq + 1) } })
      else found.push({ flag: v, value: args[++k] })
      continue
    }
    if (!v.startsWith("-") || v === "-") continue
    for (let c = 1; c < v.length; c++) {
      const letter = v[c]
      if (ATTACHED.has(letter)) break
      if (!SHORT_TAKES.has(letter)) continue
      const attached = v.slice(c + 1)
      const value = attached ? { ...args[k], value: attached } : args[++k]
      if (letter === "s" || letter === "X") found.push({ flag: `-${letter}`, value })
      break
    }
  }
  return found
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

// An alias's call as a shell line: a ! alias's text with the typed words after it, as git runs it, else git with its own options, the alias's words and the typed words
const aliasLine = (text: string, before: Word[], typed: Word[]) => {
  const words = typed.map((w) => quote(w.value)).join(" ")
  if (text.startsWith("!")) return `${text.slice(1)} ${words}`
  return `git ${before.map((w) => quote(w.value)).join(" ")} ${text} ${words}`
}

async function judgeGit(args: Word[], env: Env, depth: number): Promise<string | undefined> {
  const { aliases, rest, sub } = gitCommand(args)
  if (!sub) return
  if (marked(sub.value)) {
    if (rest.some((a) => a.value === "ours"))
      return `no-ours-merge hook refuses this git call: it cannot read which git command runs (${visible(sub.value)}) beside ours. ${INSTEAD}`
    if (rest.some((a) => a.value.startsWith("--no-veri")))
      return `no-ours-merge hook refuses this git call: it cannot read which git command runs (${visible(sub.value)}) beside --no-verify. ${AGAIN}`
    return
  }
  // git runs an alias only for a name that is no git command of its own, the last -c for it winning
  const name = `alias.${sub.value}=`
  const text = aliases.findLast((a) => a.startsWith(name))?.slice(name.length)
  if (text !== undefined && !VERIFIED.has(sub.value) && depth < ALIAS_DEPTH) {
    const line = aliasLine(text, args.slice(0, args.indexOf(sub)), rest)
    return run(lex(line, env.known), env, visitor(depth + 1))
  }
  if (!VERIFIED.has(sub.value)) return
  const { help, off } = walk(sub.value, rest)
  if (help) return
  if (off)
    return `no-ours-merge hook refuses git ${sub.value} ${off}, which turns its hooks off. ${AGAIN}`
  if (!SUBS.has(sub.value)) return
  for (const { flag, value } of strategies(rest)) {
    if (value && marked(value.value))
      return `no-ours-merge hook refuses git ${sub.value} ${flag} with a value it cannot read (${visible(value.value)}). ${INSTEAD}`
    if (value?.value === "ours")
      return `no-ours-merge hook refuses git ${sub.value} ${flag} ours. ${INSTEAD}`
  }
}

const verified = (args: Word[]) => VERIFIED.has(gitCommand(args).sub?.value ?? "")

// Each word as the shell's brace expansion makes it, a list past braceWords' cap kept as written
const expanded = (args: Word[]): Word[] =>
  args.flatMap((w) =>
    w.unknown === "a brace expansion"
      ? (braceWords(w.value)?.map((value) => ({ ...w, unknown: undefined, value })) ?? [w])
      : [w],
  )

// git itself, a name the hook cannot read with a merge, pull or commit after it, or git behind a wrapper the reader does not know (run-slot.sh <who> -- git merge ...); depth counts the aliases followed to reach it.
const visitor =
  (depth: number): Visit =>
  async (_cmd, { args: typed, first, name }, env) => {
    const args = expanded(typed)
    if (name === "git") return judgeGit(args, env, depth)
    if (first && (first.unknown || marked(first.value)) && verified(args))
      return judgeGit(args, env, depth)
    if (PRINTERS.has(name)) return
    const nested = args.findIndex(
      (a, j) => program(a.value) === "git" && verified(args.slice(j + 1)),
    )
    if (nested !== -1) return judgeGit(args.slice(nested + 1), env, depth)
  }

const BARE = (command: string) => command.replace(/[\\'"]/g, "")

// The cheap first look: ours, veri (--no-verify and its abbreviations), a short option holding n or a brace list named anywhere, quotes gone so o'u'rs still counts; $'...' can spell any word, so it always counts.
const candidate = (command: string): boolean =>
  command.includes("$'") || /ours|veri|(?:^|[\s{,])-[^\s-]*n|\{[^}]*,/.test(BARE(command))

// A call that reads as a merge or pull with ours, or a merge, pull or commit with its hooks off, which the hook refuses when it cannot read it
const mergeCall = (command: string): boolean => {
  const bare = BARE(command)
  if (!/\bgit\b/i.test(bare)) return false
  if (/\b(?:merge|pull)\b/.test(bare) && /ours/.test(bare)) return true
  if (/\b(?:commit|merge|pull)\b/.test(bare) && /--no-veri/.test(bare)) return true
  return /\bcommit\b/.test(bare) && /(?:^|[\s{,])-[^\s-]*n/.test(bare)
}

async function inspect(raw: string, environment: Record<string, string | undefined>) {
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    payload = undefined
  }
  if (typeof payload !== "object" || payload === null)
    return mergeCall(raw)
      ? "no-ours-merge hook could not parse its input, which reads as a merge with ours or a git call with its hooks off, so it refuses the call."
      : undefined
  const { cwd, tool_input: toolInput, tool_name: tool } = payload as Record<string, unknown>
  if (tool !== "Bash") return
  const command = (toolInput as { command?: unknown } | null)?.command
  if (typeof command !== "string" || !candidate(command)) return
  const directory = typeof cwd === "string" ? cwd : undefined
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known: knownVariables(command, environment, directory),
    process: environment,
    vars: new Map(),
  }
  return run(lex(command, env.known), env, visitor(0))
}

// Fails closed only on a call that reads as a merge with ours or a git call with its hooks off: an error on any other call lets it run, so a parser bug cannot block every Bash command.
export async function check(
  raw: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  try {
    return await inspect(raw, environment)
  } catch (error) {
    let command = raw
    try {
      const parsed = JSON.parse(raw) as { tool_input?: { command?: unknown } }
      if (typeof parsed.tool_input?.command === "string") command = parsed.tool_input.command
    } catch {}
    if (!mergeCall(command)) return
    return `no-ours-merge hook could not read this call (${error}), which reads as a merge with ours or a git call with its hooks off, so it refuses it. Split it into plain commands and run them again.`
  }
}

if (import.meta.main) {
  const raw = await input("no-ours-merge", "guard")
  const reason = (await fromFactory(raw)) ? await check(raw) : undefined
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
