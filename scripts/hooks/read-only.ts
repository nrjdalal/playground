// Whether a tool call only reads: a GitHub, Linear or Slack MCP read, or a Bash line whose every command is a git or gh read or a plain reader from a closed list, so a guard whose list is missing can let it run.
import { type Command, lex, marked, parse, type Parsed, program, type Word } from "./shell"

const MCP_READ =
  /^mcp__.+?__(?:(?:download|extract|fetch|get|list|read|search)_.*|.*_(?:history|info|list|read|replies|search|unreads))$/

// Programs that read and run nothing they are handed, A to Z; an option that runs a command (sort's --compress-program) is refused below.
const READERS = new Set([
  "[",
  "basename",
  "cat",
  "cd",
  "comm",
  "cut",
  "date",
  "diff",
  "dirname",
  "echo",
  "grep",
  "head",
  "jq",
  "ls",
  "printf",
  "pwd",
  "readlink",
  "realpath",
  "sort",
  "stat",
  "tail",
  "test",
  "tr",
  "true",
  "uniq",
  "wc",
])

// git subcommands with no write form, A to Z; the ones below them read only in the forms each names.
const GIT_READS = new Set([
  "blame",
  "cat-file",
  "check-ignore",
  "describe",
  "diff",
  "diff-tree",
  "for-each-ref",
  "log",
  "ls-files",
  "ls-tree",
  "merge-base",
  "merge-tree",
  "name-rev",
  "rev-list",
  "rev-parse",
  "shortlog",
  "show",
  "show-ref",
  "status",
  "version",
])
const GIT_GLOBAL_VALUES = new Set(["-C", "--git-dir", "--work-tree"])
const GIT_GLOBAL_FLAGS = new Set(["--no-pager", "-P", "--no-optional-locks"])
const BRANCH_LISTS = new Set([
  "-a",
  "--all",
  "--list",
  "-r",
  "--remotes",
  "--show-current",
  "-v",
  "-vv",
  "--verbose",
])
const CONFIG_READS = new Set(["--get", "--get-all", "--get-regexp", "-l", "--list"])

// gh's read verbs, by `<group> <verb>`; `gh api` reads with GET or HEAD alone.
const GH_READS = new Set([
  "auth status",
  "issue list",
  "issue status",
  "issue view",
  "label list",
  "pr checks",
  "pr diff",
  "pr list",
  "pr status",
  "pr view",
  "release list",
  "release view",
  "repo list",
  "repo view",
  "run list",
  "run view",
  "run watch",
  "workflow list",
  "workflow view",
])

// A variable that makes git or gh run a program (a pager, an editor) or read another config.
const RUNS = /PAGER|EDITOR|BROWSER|^GIT_|^GH_/

const words = (args: Word[]) => args.map((a) => a.value)

function gitReads(args: Word[]): boolean {
  let k = 0
  for (; k < args.length; k++) {
    const v = args[k].value
    if (GIT_GLOBAL_VALUES.has(v)) k++
    else if (!GIT_GLOBAL_FLAGS.has(v) && !/^--(?:git-dir|work-tree)=/.test(v)) break
  }
  const sub = args[k]?.value
  const rest = words(args.slice(k + 1))
  if (!sub || marked(sub)) return false
  if (GIT_READS.has(sub)) return true
  const plain = !args.slice(k + 1).some((a) => marked(a.value))
  if (sub === "fetch" || sub === "ls-remote")
    return (
      plain &&
      !rest.some((v) => v.startsWith("--upload-pack") || (sub === "ls-remote" && v === "-u"))
    )
  if (sub === "grep") return plain && !rest.some((v) => /^-O|^--open-files-in-pager/.test(v))
  if (sub === "branch") return rest.every((v) => BRANCH_LISTS.has(v))
  if (sub === "config") return CONFIG_READS.has(rest[0] ?? "")
  if (sub === "remote")
    return rest.length === 0 || ["-v", "--verbose", "get-url", "show"].includes(rest[0])
  if (sub === "stash") return ["list", "show"].includes(rest[0] ?? "")
  if (sub === "tag") return rest.length === 0 || ["-l", "--list"].includes(rest[0])
  if (sub === "worktree") return rest[0] === "list"
  if (sub === "reflog") return rest.length === 0 || rest[0] === "show"
  return false
}

function ghReads(args: Word[]): boolean {
  const head: string[] = []
  let k = 0
  for (; k < args.length && head.length < (head[0] === "api" ? 1 : 2); k++) {
    const v = args[k].value
    if (v === "-R" || v === "--repo") k++
    else if (!v.startsWith("-")) head.push(v)
  }
  if (head.some(marked)) return false
  if (head[0] === "search") return true
  if (head[0] !== "api") return GH_READS.has(head.join(" "))
  const rest = args.slice(k)
  if (rest.some((a) => marked(a.value))) return false
  let method: string | undefined
  let sends = false
  for (let i = 0; i < rest.length; i++) {
    const v = rest[i].value
    if (v === "-X" || v === "--method") method = rest[++i]?.value.toUpperCase()
    else if (/^-X./.test(v)) method = v.slice(2).toUpperCase()
    else if (v.startsWith("--method=")) method = v.slice(9).toUpperCase()
    else if (/^(?:-[fF]|--field|--raw-field|--input)(?:=|$)|^-[fF]./.test(v)) sends = true
  }
  return method ? method === "GET" || method === "HEAD" : !sends
}

function reads(parsed: Parsed): boolean {
  if ([...parsed.local.keys()].some((key) => RUNS.test(key))) return false
  const name = program(parsed.name)
  if (parsed.name === "") return true
  if (marked(parsed.name)) return false
  if (name === "git") return !parsed.xargs && gitReads(parsed.args)
  if (name === "gh") return !parsed.xargs && ghReads(parsed.args)
  return READERS.has(name) && !words(parsed.args).some((v) => v.startsWith("--compress-program"))
}

const readings = (parsed: Parsed): Parsed[] => [parsed, ...parsed.also.flatMap(readings)]

const commandReads = (cmd: Command): boolean => readings(parse(cmd)).every(reads)

// Whether the call only reads; a call it cannot parse reads as a write.
export function readOnly(raw: string): boolean {
  try {
    const { tool_input: input, tool_name: tool } = JSON.parse(raw) as {
      tool_input?: { command?: unknown }
      tool_name?: unknown
    }
    if (typeof tool !== "string") return false
    if (tool !== "Bash") return MCP_READ.test(tool)
    if (typeof input?.command !== "string") return false
    return lex(input.command).commands.every(commandReads)
  } catch {
    return false
  }
}
