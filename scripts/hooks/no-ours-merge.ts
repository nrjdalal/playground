// PreToolUse hook: refuses a git merge or git pull with the ours strategy or the ours strategy option, since the PR's squash onto canary then deletes whatever canary added that the merge ignored, while canary reads as merged in and every gate stays green; and a git merge, pull or commit with its hooks off (--no-verify, a commit's -n), since its commit then skips commit-msg and a commit's pre-commit.

import { input } from "./input"
import { gitCommand } from "./no-stash"
import { fromFactory } from "./role"
import {
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
// Short options of git merge and git pull that take a value, attached or as the next word; -S takes only an attached one.
const SHORT_TAKES = new Set(["F", "X", "j", "m", "o", "s"])
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
// A commit's short options that take a value, attached or as the next word; -S and -u take only an attached one
const COMMIT_SHORT = new Set(["C", "F", "c", "m", "t"])

// The option that turns the hooks off, as written, when it is the last word of --no-verify and --verify: a commit also takes -n, alone or in a cluster of short options, and an abbreviation of --no-verify longer than the ambiguous --no-ver; a merge's and a pull's -n is --no-stat.
function hooksOff(sub: string, args: Word[]): string | undefined {
  let off: string | undefined
  const commit = sub === "commit"
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (v === "--") break
    if (v.startsWith("--")) {
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
      else if (letter === "S" || letter === "u") break
      else if ((commit ? COMMIT_SHORT : SHORT_TAKES).has(letter)) {
        if (c === v.length - 1) k++
        break
      }
    }
  }
  return off
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
      if (letter === "S") break
      if (!SHORT_TAKES.has(letter)) continue
      const attached = v.slice(c + 1)
      const value = attached ? { ...args[k], value: attached } : args[++k]
      if (letter === "s" || letter === "X") found.push({ flag: `-${letter}`, value })
      break
    }
  }
  return found
}

function judgeGit(args: Word[]): string | undefined {
  const { aliases, rest, sub } = gitCommand(args)
  if (!sub) return
  if (marked(sub.value)) {
    return rest.some((a) => a.value === "ours")
      ? `no-ours-merge hook refuses this git call: it cannot read which git command runs (${visible(sub.value)}) beside ours. ${INSTEAD}`
      : undefined
  }
  const alias = aliases.find((a) => a.startsWith(`alias.${sub.value}=`))
  if (alias && /\b(?:merge|pull)\b/.test(alias) && /\bours\b/.test(alias))
    return `no-ours-merge hook refuses git ${sub.value}: it is an alias for a merge with ours. ${INSTEAD}`
  if (alias && /\b(?:commit|merge|pull)\b/.test(alias) && /--no-verify\b/.test(alias))
    return `no-ours-merge hook refuses git ${sub.value}: it is an alias for a git call with --no-verify, which turns its hooks off. ${AGAIN}`
  if (!VERIFIED.has(sub.value)) return
  if (rest.some((a) => a.value === "-h" || a.value === "--help")) return
  const off = hooksOff(sub.value, rest)
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

const merges = (args: Word[]) => VERIFIED.has(gitCommand(args).sub?.value ?? "")

// git itself, a name the hook cannot read with a merge, pull or commit after it, or git behind a wrapper the reader does not know (run-slot.sh <who> -- git merge ...).
const visit: Visit = async (_cmd, { args, first, name }) => {
  if (name === "git") return judgeGit(args)
  if (first && (first.unknown || marked(first.value)) && merges(args)) return judgeGit(args)
  if (PRINTERS.has(name)) return
  const nested = args.findIndex((a, j) => program(a.value) === "git" && merges(args.slice(j + 1)))
  if (nested !== -1) return judgeGit(args.slice(nested + 1))
}

const BARE = (command: string) => command.replace(/[\\'"]/g, "")

// The cheap first look: ours, veri (--no-verify and its abbreviations) or a short option holding n named anywhere, quotes gone so o'u'rs still counts; $'...' can spell any word, so it always counts.
const candidate = (command: string): boolean =>
  command.includes("$'") || /ours|veri|(?:^|\s)-[^\s-]*n/.test(BARE(command))

// A call that reads as a merge or pull with ours, or a merge, pull or commit with its hooks off, which the hook refuses when it cannot read it
const mergeCall = (command: string): boolean => {
  const bare = BARE(command)
  if (!/\bgit\b/i.test(bare)) return false
  if (/\b(?:merge|pull)\b/.test(bare) && /ours/.test(bare)) return true
  if (/\b(?:commit|merge|pull)\b/.test(bare) && /--no-verify\b/.test(bare)) return true
  return /\bcommit\b/.test(bare) && /(?:^|\s)-n\b/.test(bare)
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
  return run(lex(command, env.known), env, visit)
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
