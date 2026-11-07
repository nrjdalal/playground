// Whether a tool call only reads, while a guard's list or policy.json is unreadable: a Bash line whose every command is one of the exact read shapes below, with no redirect and no glob, brace, parenthesis or $ in any word, quoted or not, so a guard can let it run.
import { type Command, lex, marked } from "./shell"

// A read shape: the options it takes alone and with a value (see fits), a bare count (`-5`), and whether it takes operands.
type Shape = { count?: boolean; flags?: string[]; operands?: boolean; values?: string[] }

const READ_FILE: Shape = { count: true, operands: true, values: ["-c", "-n"] }
const GH_VIEW: Shape = {
  flags: ["-c", "--comments"],
  operands: true,
  values: ["--jq", "--json", "-q", "-R", "--repo"],
}

// Readers by bare name, A to Z.
const READERS: Record<string, Shape> = {
  cat: { flags: ["-n"], operands: true },
  cd: { operands: true },
  echo: { flags: ["-n"], operands: true },
  grep: {
    flags: ["-c", "-E", "-F", "-h", "-i", "-l", "-n", "-q", "-r", "-rn", "-s", "-v"],
    operands: true,
    values: ["-e"],
  },
  head: READ_FILE,
  ls: { flags: ["-1", "-a", "-l", "-la"], operands: true },
  pwd: {},
  tail: READ_FILE,
  wc: { flags: ["-c", "-l", "-w"], operands: true },
}

// git's read subcommands, A to Z, after an optional `-C <dir>`; a branch or remote takes no operand, which would name one to make.
const GIT: Record<string, Shape> = {
  branch: { flags: ["-a", "-r", "--show-current", "-v"] },
  diff: {
    flags: ["--cached", "--name-only", "--name-status", "--staged", "--stat"],
    operands: true,
  },
  log: {
    count: true,
    flags: ["--name-only", "--oneline", "--stat"],
    operands: true,
    values: ["--format", "-n", "--pretty"],
  },
  remote: { flags: ["-v", "--verbose"] },
  "rev-parse": {
    flags: ["--abbrev-ref", "--short", "--show-toplevel", "--verify"],
    operands: true,
  },
  show: {
    flags: ["--name-only", "--oneline", "--stat"],
    operands: true,
    values: ["--format", "--pretty"],
  },
  status: { flags: ["-b", "--branch", "--porcelain", "-s", "--short"], operands: true },
}

// gh's read verbs, A to Z, each `<group> <verb>` as its first two words.
const GH: Record<string, Shape> = {
  "issue list": {
    values: [
      "-A",
      "--author",
      "--jq",
      "--json",
      "-L",
      "-l",
      "--label",
      "--limit",
      "-q",
      "-R",
      "--repo",
      "-S",
      "-s",
      "--search",
      "--state",
    ],
  },
  "issue view": GH_VIEW,
  "pr checks": { operands: true, values: ["-R", "--repo"] },
  "pr diff": { flags: ["--name-only"], operands: true, values: ["-R", "--repo"] },
  "pr list": {
    values: [
      "-A",
      "--author",
      "-B",
      "--base",
      "-H",
      "--head",
      "--jq",
      "--json",
      "-L",
      "--limit",
      "-q",
      "-R",
      "--repo",
      "-s",
      "--state",
    ],
  },
  "pr view": GH_VIEW,
}

const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/

// Whether every word fits the shape: a listed option, with its value after `=` or (but a git long one) the next word that is no option, a count where it takes one, or an operand where it takes them; `-R` names an OWNER/REPO, and no word holds a URL, which would reach another host.
function fits(args: string[], shape: Shape, git = false): boolean {
  for (let i = 0; i < args.length; i++) {
    const v = args[i]
    const [option, value] =
      v.startsWith("--") && v.includes("=")
        ? [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]
        : [v, undefined]
    if (v.includes("://")) return false
    if (v === "--")
      return shape.operands === true && args.slice(i + 1).every((a) => !a.includes("://"))
    if (shape.values?.includes(option)) {
      const given = value ?? (git && option.startsWith("--") ? undefined : args[++i])
      if (given === undefined || (value === undefined && given.startsWith("-"))) return false
      if ((option === "-R" || option === "--repo") && !OWNER_REPO.test(given)) return false
    } else if (shape.flags?.includes(v) || (shape.count && /^-\d+$/.test(v))) continue
    else if (v.startsWith("-") || !shape.operands) return false
  }
  return true
}

// `gh api` reads with GET or HEAD, no field, one endpoint on GitHub that is not graphql.
function apiReads(args: string[]): boolean {
  const endpoints: string[] = []
  for (let i = 0; i < args.length; i++) {
    const v = args[i]
    if (v === "-X" || v === "--method") {
      if (!["GET", "HEAD"].includes(args[++i]?.toUpperCase())) return false
    } else if (v === "--jq" || v === "-q") i++
    else if (v !== "--paginate") {
      if (v.startsWith("-")) return false
      endpoints.push(v)
    }
  }
  return endpoints.length === 1 && !endpoints[0].includes("://") && endpoints[0] !== "graphql"
}

const shapeOf = (shapes: Record<string, Shape>, key: string | undefined): Shape | undefined =>
  key !== undefined && Object.hasOwn(shapes, key) ? shapes[key] : undefined

function commandReads(cmd: Command): boolean {
  if (cmd.redirects.length > 0 || cmd.words.some((w) => /[*?[{()$]/.test(w.value))) return false
  const words = cmd.words.map((w) => w.value)
  return words.length === 0 || (!words.some(marked) && readsWords(words))
}

// Whether a command's words, its program first, are one of the read shapes above; the caller rules out redirects, globs and words it cannot read.
export function readsWords(words: string[]): boolean {
  const [name, ...args] = words
  if (name === "git") {
    const k = args[0] === "-C" ? 2 : 0
    const shape = shapeOf(GIT, args[k])
    return shape !== undefined && fits(args.slice(k + 1), shape, true)
  }
  if (name === "gh") {
    if (args[0] === "api") return apiReads(args.slice(1))
    const shape = shapeOf(GH, `${args[0]} ${args[1]}`)
    return shape !== undefined && fits(args.slice(2), shape)
  }
  const shape = shapeOf(READERS, name)
  return shape !== undefined && fits(args, shape)
}

// Whether the call only reads; a call it cannot parse reads as a write.
export function readOnly(raw: string): boolean {
  try {
    const { tool_input: input, tool_name: tool } = JSON.parse(raw) as {
      tool_input?: { command?: unknown }
      tool_name?: unknown
    }
    if (tool !== "Bash" || typeof input?.command !== "string") return false
    return lex(input.command).commands.every(commandReads)
  } catch {
    return false
  }
}
