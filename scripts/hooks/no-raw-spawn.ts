// PreToolUse hook: refuses a Claude Code session not started through scripts/spawn.sh, since only spawn.sh holds the factory to its capacity gate (load, memory and usage). It reads each cmux call by the commands of cmux 0.65.1's Start & Resume and Agents help groups and the terminal openers: a command it runs that starts claude (`--command`, `--shell`, `--layout`, respawn-pane's trailing words, the words after `--` for `surface`), an agent or saved session it opens, forks, restores or wakes that is or may be Claude (omc and recover --session among them); a `claude --resume` or `--continue`; and every herdr call but its reads and a scratch world of the session's own, herdr by any path or a program it cannot read followed by a herdr group, since herdr's socket has no access control.
import "../../packages/env/src/aliases"
import { join, resolve, sep } from "node:path"

import { fromFactory } from "./role"
import {
  type Env,
  knownVariables,
  lex,
  marked,
  pathOf,
  run,
  slice,
  type Text,
  unreadable,
  type Visit,
  type Word,
} from "./shell"

const SPAWN = join(import.meta.dir, "..", "spawn.sh")
// The cmux subcommands that open or resume a session; a program the hook cannot read is judged as cmux when one of these follows it.
const HEADS = new Set([
  "agent",
  "agent-hibernation",
  "claude-teams",
  "fork",
  "local-tmux",
  "local-zellij",
  "new-pane",
  "new-split",
  "new-surface",
  "new-workspace",
  "omc",
  "recover",
  "respawn-pane",
  "restore",
  "restore-session",
  "session",
  "surface",
  "tmux",
  "vault",
])
// Agents cmux knows besides Claude: a fork or restore that names one of these, and no Claude, opens no Claude session.
const OTHER_AGENTS = new Set(["codex", "opencode", "pi"])
// cmux's global options that take a value, which come before its command.
const GLOBAL_TAKES = new Set(["--id-format", "--password", "--socket", "--window"])
// agent's subcommands that talk to a session rather than open one.
const AGENT_TALK = new Set(["hibernate", "inbox", "message", "messages"])
// respawn-pane's flags that take a value; any other word after it is the command it runs.
const RESPAWN_TAKES = new Set(["--command", "--surface", "--window", "--workspace"])
const REOPENS = new Set(["-c", "-r", "--continue", "--resume"])
// The terminal app's program, matched as a pattern since the cmux boundary test reads a quoted name as a spawn of it.
const TERMINAL = /^cmux$/

// herdr 0.9.5's command groups; a program the hook cannot read is judged as herdr when one of these follows it.
const HERDR_HEADS = new Set([
  "agent",
  "api",
  "channel",
  "config",
  "integration",
  "machine",
  "notification",
  "pane",
  "plugin",
  "server",
  "session",
  "tab",
  "terminal",
  "workspace",
  "worktree",
])
// herdr's global options, which take a value and come before its command.
const HERDR_GLOBALS = new Set(["--machine", "--remote", "--remote-keybindings", "--session"])
// herdr's reads (from its docs): any group's second word below, or one of the whole commands after it. herdr's socket has no access control, so every other call is refused.
const HERDR_READ_VERBS = new Set([
  "current",
  "edges",
  "get",
  "layout",
  "list",
  "neighbor",
  "process-info",
  "read",
  "status",
])
const HERDR_READS = new Set([
  "agent explain",
  "agent wait",
  "api schema",
  "api snapshot",
  "channel show",
  "integration status",
  "pane wait-output",
  "plugin action list",
  "plugin log list",
  "server agent-manifests",
  "status",
  "terminal session observe",
])
// A path to one of herdr's sockets, its default herdr.sock or any .sock under a herdr folder.
const HERDR_SOCKET = /herdr[^\s'"]*\.sock\b/
// The programs that can open a Unix socket; any of them naming a herdr socket writes to it past the allow-list.
const CONNECTS = /^(?:bun|curl|deno|nc|ncat|netcat|node|perl|php|python[\d.]*|ruby|socat)$/
const UNIX = /\b(?:curl|nc|ncat|netcat|socat)\b/
// The Unix socket a connecting program is pointed at: nc's target after a U in any short-flag cluster or ncat's --unixsock, any socat address (its types take any case, and a bare path is a socket too), curl's --unix-socket or --abstract-unix-socket; a variable assigned before it loses where it came from, so one the hook cannot read is refused.
function unixTarget(name: string, args: Word[]): Word | undefined {
  const positional = args.filter((a) => !a.value.startsWith("-") || a.value === "-")
  const unix = (v: string) => /^-[A-Za-z0-9]*U/.test(v) || v === "--unixsock"
  if (/^(?:nc|ncat|netcat)$/.test(name) && args.some((a) => unix(a.value))) return positional.at(-1)
  if (name === "socat") return positional.find((a) => a.unknown || a.reads?.length)
  if (name === "curl") {
    const k = args.findIndex((a) => ["--abstract-unix-socket", "--unix-socket"].includes(a.value))
    return k >= 0 ? args[k + 1] : undefined
  }
}
const EXPORTS = new Set(["declare", "export", "local", "readonly", "typeset"])

const refuse = (what: string) =>
  `no-raw-spawn hook refuses ${what}: a factory session starts another only through ${SPAWN}, which refuses unless the machine has room, its gate naming the reading that failed. Run it instead (worker, runner, column, manager, resume or restore; with no arguments it prints how).`

const refuseHerdr = (what: string) =>
  `no-raw-spawn hook refuses ${what}: herdr's socket has no access control, so a factory session runs only herdr's reads (current, edges, get, layout, list, neighbor, process-info, read and status, agent explain, agent wait, api snapshot, pane wait-output and the like) on herdr's own socket. Talk to another session with SendMessage; start, resume or restore one only through ${SPAWN} (with no arguments it prints how).`

const beforeDashes = (args: Word[]) => {
  const dashes = args.findIndex((a) => a.value === "--")
  return dashes === -1 ? args : args.slice(0, dashes)
}

const reopens = (args: Word[]) =>
  beforeDashes(args).some((a) => REOPENS.has(a.value) || /^--(?:resume|continue)=/.test(a.value))

// claude, or a program the hook cannot read, which could be claude.
const findsClaude: Visit = async (_cmd, { first, name }) =>
  name === "claude" || (first && (first.unknown || marked(first.value))) ? "claude" : undefined

// A flag's values, as `--flag <value>` or `--flag=<value>`.
function flagValues(args: Word[], flag: string): Word[] {
  const found: Word[] = []
  args.forEach((a, k) => {
    if (a.value === flag && args[k + 1]) found.push(args[k + 1])
    else if (a.value.startsWith(`${flag}=`)) found.push(slice(a, flag.length + 1))
  })
  return found
}

// Words joined as the shell hands them on, as one command line.
function joined(words: Word[]): Word[] {
  if (words.length === 0) return []
  const unknown = words.find((w) => unreadable(w)) ? "a word it cannot read" : undefined
  return [{ quoted: true, unknown, value: words.map((w) => w.value).join(" ") }]
}

// The command respawn-pane runs from its trailing words.
function trailing(args: Word[], from: number): Word[] {
  const words: Word[] = []
  for (let k = from; k < args.length; k++) {
    const v = args[k].value
    if (RESPAWN_TAKES.has(v)) k++
    else if (!v.startsWith("--")) words.push(args[k])
  }
  return joined(words)
}

const namesClaude = (w: Word) =>
  w.value === "claude" || /^--(?:agent|provider)=claude$/.test(w.value)

// Whether a call that opens an agent opens Claude, or may: it names claude, holds a word the hook cannot read, or names no other agent (`fork --surface` forks whatever the surface held).
const mayOpenClaude = (words: Word[]) =>
  words.some((w) => namesClaude(w) || unreadable(w)) ||
  !words.some((w) => OTHER_AGENTS.has(w.value) || /^--agent=(?!claude$)/.test(w.value))

// The words that are not flags, skipping the values of cmux's global options, so `--id-format both restore-session` names restore-session.
function positionals(words: Word[]): string[] {
  const found: string[] = []
  for (let k = 0; k < words.length; k++) {
    const v = words[k].value
    if (GLOBAL_TAKES.has(v)) k++
    else if (!v.startsWith("-")) found.push(v)
  }
  return found
}

function judgeOpener(head: string, second: string | undefined, words: Word[]): string | undefined {
  const what = `a cmux ${head}`
  if (head === "claude-teams" || head === "omc" || head === "restore-session")
    return refuse(`${what}, which starts or restores Claude sessions`)
  if (head === "recover" && flagValues(words, "--session").length > 0)
    return refuse("a cmux recover --session, which opens a saved session")
  if (head === "session" && second === "restore")
    return refuse("a cmux session restore, which restores saved sessions")
  if ((head === "restore" || head === "fork") && mayOpenClaude(words))
    return refuse(`${what} that may open a Claude session`)
  if (head === "vault" && second === "fork" && mayOpenClaude(words))
    return refuse("a cmux vault fork that may open a Claude session")
  if ((head === "agent" || head === "agent-hibernation") && second === "wake")
    return refuse(`${what} wake, which resumes a session`)
  if (head === "agent" && !AGENT_TALK.has(second ?? "") && mayOpenClaude(words))
    return refuse("a cmux agent that may open a Claude session")
  if (head === "new-surface") {
    const provider = flagValues(words, "--provider")
    if (provider.some((p) => unreadable(p) || p.value === "claude"))
      return refuse("a cmux new-surface that opens a Claude agent session")
  }
}

async function judgeCmux(args: Word[], env: Env): Promise<string | undefined> {
  const words = beforeDashes(args)
  if (words.some((w) => w.value === "--help" || w.value === "-h")) return
  const [head, second] = positionals(words)
  if (!head) return
  const opened = judgeOpener(head, second, words)
  if (opened) return opened
  const what = `a cmux ${head}`
  // A layout's surfaces each run their own command or open an agent session, so any mention of claude in it counts.
  for (const layout of flagValues(words, "--layout")) {
    if (unreadable(layout)) return refuse(`${what} whose layout it cannot read`)
    if (/\bclaude\b/i.test(layout.value)) return refuse(`${what} whose layout starts claude`)
  }
  const commands = [
    ...flagValues(words, "--command"),
    ...flagValues(words, "--shell"),
    ...(head === "surface" ? joined(args.slice(words.length + 1)) : []),
    ...(head === "respawn-pane"
      ? trailing(words, words.findIndex((w) => w.value === head) + 1)
      : []),
  ]
  for (const command of commands) {
    if (unreadable(command)) return refuse(`${what} whose command it cannot read`)
    const inner: Env = { ...env, files: new Map(), vars: new Map() }
    if (await run(lex(command.value, env.known), inner, findsClaude))
      return refuse(`${what} that starts claude`)
  }
}

// herdr's words up to any `--`, skipping its global options and their values.
function herdrArgs(args: Word[]): string[] {
  const found: string[] = []
  const words = beforeDashes(args)
  for (let k = 0; k < words.length; k++) {
    if (HERDR_GLOBALS.has(words[k].value)) k++
    else found.push(words[k].value)
  }
  return found
}
const herdrWords = (args: Word[]) => herdrArgs(args).filter((v) => !v.startsWith("-"))
const HELP = new Set(["--help", "-h"])

// The groups that only talk to the server a socket names; the rest reach the binary, ~/.config/herdr, ~/.claude or a named session.
const SCRATCH_GROUPS = new Set([
  "agent",
  "api",
  "notification",
  "pane",
  "server",
  "status",
  "tab",
  "workspace",
  "worktree",
])
// herdr's global options that move a call off the socket HERDR_SOCKET_PATH names (--session wins over it, measured on 0.9.5).
const MOVES = /^--(?:machine|remote|session)(?:=|$)/
// claude in any case, as a program, a --kind=claude or a package such as @anthropic-ai/claude-code, but not the .claude folder (a worktree's path) or a longer word such as claudette
const STARTS_CLAUDE = /(?<![.\w])claude(?!\w)/i

// A scratch herdr world of the session's own: a call carrying both HERDR_SESSION and HERDR_SOCKET_PATH runs when the socket is a literal path under the session's TMPDIR and the session a word that names no factory server, with no global option that moves it, in a socket group, starting no claude; undefined when it carries neither or one, else true, or the reason it is refused.
function scratchWorld(args: Word[], local: Map<string, Text>, env: Env): string | true | undefined {
  const session = local.get("HERDR_SESSION")
  const socket = local.get("HERDR_SOCKET_PATH")
  if (!session || !socket) return
  const tmp = env.process.TMPDIR
  const path = socket.value
  if (
    !tmp?.startsWith("/") ||
    unreadable(socket) ||
    !path.startsWith("/") ||
    !resolve(path).startsWith(resolve(tmp) + sep)
  )
    return `a scratch herdr call whose HERDR_SOCKET_PATH is not a literal path under your TMPDIR (${tmp ?? "unset"}), where a scratch server's socket goes`
  const servers = (env.process.PLAYGROUND_HERDR_SESSIONS ?? "").split(",")
  if (
    unreadable(session) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(session.value) ||
    ["default", "factory", "probes", ...servers].includes(session.value)
  )
    return "a scratch herdr call whose HERDR_SESSION is not a word of its own: herdr keeps a server's state under ~/.config/herdr/sessions/<name>, so default and the factory's servers (factory, probes) stay theirs"
  if (args.some((a) => MOVES.test(a.value)))
    return "a scratch herdr call with --session, --machine or --remote, which moves it off the scratch socket"
  const [head] = herdrWords(args)
  if (!SCRATCH_GROUPS.has(head ?? ""))
    return `a scratch herdr ${head ?? "call with no command"}, which is not one of the groups that only talk to its server (${[...SCRATCH_GROUPS].join(", ")})`
  if (args.some((a) => unreadable(a) || STARTS_CLAUDE.test(a.value)))
    return "a scratch herdr call that may start claude, which only spawn.sh starts"
  return true
}

function judgeHerdr(
  args: Word[],
  local: Map<string, Text>,
  env: Env,
  program?: Text,
): string | undefined {
  // herdr sends a command whose arguments are given even with a help or version word after them (measured, 0.9.5), so help reads only after a group and a verb alone, and a version only on its own.
  const given = herdrArgs(args)
  const options = given.filter((v) => v.startsWith("-"))
  if (options.length && options.every((v) => HELP.has(v)) && given.length - options.length <= 2)
    return
  if (given.length === 1 && (given[0] === "--version" || given[0] === "-V")) return
  // a program it cannot read is no herdr it can vouch for, so only herdr itself takes the carve-out
  const scratch = program ? undefined : scratchWorld(args, local, env)
  if (scratch === true) return
  if (scratch) return refuseHerdr(scratch)
  const carried = ["HERDR_SESSION", "HERDR_SOCKET_PATH"].find((v) => local.has(v))
  if (carried)
    return refuseHerdr(`a herdr call carrying ${carried}, which moves it off its own socket`)
  const command = herdrWords(args)
  const [head, second] = command
  if (!head) return refuseHerdr("a bare herdr, which starts or attaches to a server")
  // server's verbs act on the server itself, so only its reads in HERDR_READS run.
  if (HERDR_HEADS.has(head) && head !== "server" && HERDR_READ_VERBS.has(second)) return
  if (command.some((_, k) => HERDR_READS.has(command.slice(0, k + 1).join(" ")))) return
  const verb = command.slice(0, 2).join(" ")
  if (program)
    return refuseHerdr(
      `\`${verb}\` whose program is ${program.unknown ?? "a word it cannot read"}, which it cannot tell from herdr; type the program by its literal name, such as \`agent-browser\` or \`herdr\`, so the hook can read it`,
    )
  return refuseHerdr(`a herdr ${verb}, which is not one of its reads`)
}

const visit: Visit = async (cmd, { args, first, local, name }, env) => {
  const texts = [...args, ...cmd.redirects.flatMap((r) => [r.target ?? [], r.body ?? []].flat())]
  // herdr sets HERDR_SOCKET_PATH in every pane it opens, so a word expanding it names a herdr socket too, and a relative .sock path is read from the folder the command runs in.
  const socket = (t: Text) => {
    if (HERDR_SOCKET.test(t.value) || t.variable === "HERDR_SOCKET_PATH") return true
    const path = t.value.replace(/^[A-Za-z-]+:/, "")
    if (!path.includes(".sock") || path.startsWith("/")) return false
    const full = pathOf({ ...t, value: path }, env)
    return !full || HERDR_SOCKET.test(full)
  }
  if ((CONNECTS.test(name) || first?.unknown) && texts.some(socket))
    return refuseHerdr(`a ${name || "program"} that names a herdr socket`)
  const target = unixTarget(name, args)
  if (target?.unknown || target?.reads?.length)
    return refuseHerdr(`a ${name} to a Unix socket the hook cannot read, which may be herdr's`)
  // herdr exports both into every pane, so a plain assignment moves the next call as an export does.
  if (name === "" && (local.has("HERDR_SESSION") || local.has("HERDR_SOCKET_PATH")))
    return refuseHerdr(
      "an assignment of HERDR_SESSION or HERDR_SOCKET_PATH, which points herdr at another session",
    )
  if (EXPORTS.has(name) && args.some((a) => /^HERDR_(?:SESSION|SOCKET_PATH)=/.test(a.value)))
    return refuseHerdr(
      `a ${name} of HERDR_SESSION or HERDR_SOCKET_PATH, which points herdr at another session`,
    )
  if (args.some((a) => a.value === "herdrdev/herdr"))
    return refuseHerdr("herdr's agent skill, which teaches typing into other panes")
  if (TERMINAL.test(name)) return judgeCmux(args, env)
  // herdr sets HERDR_BIN_PATH in every pane it opens, so a program word expanding it is herdr whatever follows.
  if (name === "herdr" || first?.variable === "HERDR_BIN_PATH") return judgeHerdr(args, local, env)
  if (first && (first.unknown || marked(first.value))) {
    if (HERDR_HEADS.has(herdrWords(args)[0] ?? "")) return judgeHerdr(args, local, env, first)
    const [head] = positionals(beforeDashes(args))
    return head && HEADS.has(head) ? judgeCmux(args, env) : undefined
  }
  if (name === "claude" && reopens(args)) return refuse("a claude --resume or --continue")
}

const BARE = (command: string) => command.replace(/[\\'"]/g, "")
const OPENS = new RegExp(
  `\\b(?:cmux|herdr|HERDR_BIN_PATH|HERDR_SESSION|HERDR_SOCKET_PATH|${[...HEADS, ...HERDR_HEADS].join("|")})\\b`,
)
const REOPEN = /\bclaude\b[\s\S]*(?:\s-[cr]\b|--resume|--continue)/

// The cheap first look: a cmux or herdr call, a word that names one, or a claude resume, with quotes gone; $'...' can spell any word, so it always counts.
const candidate = (command: string): boolean =>
  command.includes("$'") ||
  OPENS.test(BARE(command)) ||
  REOPEN.test(BARE(command)) ||
  UNIX.test(BARE(command))

const spawnCall = (command: string): boolean =>
  /\b(?:herdr|HERDR_BIN_PATH|HERDR_SESSION|HERDR_SOCKET_PATH)/.test(BARE(command)) ||
  (/\bcmux\b/.test(BARE(command)) &&
    /\b(?:claude|claude-teams|omc|recover|wake|restore|restore-session|fork)\b/.test(
      BARE(command),
    )) ||
  REOPEN.test(BARE(command))

function commandOf(raw: string): string | undefined {
  try {
    const { tool_input: toolInput, tool_name: tool } = JSON.parse(raw) as {
      tool_input?: { command?: unknown }
      tool_name?: unknown
    }
    return tool === "Bash" && typeof toolInput?.command === "string" ? toolInput.command : undefined
  } catch {
    return undefined
  }
}

async function inspect(raw: string, environment: Record<string, string | undefined>) {
  const {
    cwd,
    tool_input: toolInput,
    tool_name: tool,
  } = JSON.parse(raw) as {
    cwd?: unknown
    tool_input?: { command?: unknown }
    tool_name?: unknown
  }
  if (tool !== "Bash" || typeof toolInput?.command !== "string") return
  const { command } = toolInput
  if (!candidate(command)) return
  const directory = typeof cwd === "string" ? cwd : undefined
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known: knownVariables(command, environment, directory),
    process: environment,
    vars: new Map(),
  }
  return run(lex(command, env.known), env, visit, true)
}

// Fails closed only on a call that reads as a spawn: an error on any other call lets it run, so a parser bug cannot block every Bash command.
export async function check(
  raw: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  try {
    return await inspect(raw, environment)
  } catch (error) {
    const command = commandOf(raw)
    if (!command || !spawnCall(command)) return
    return `no-raw-spawn hook could not read this call (${error}), which reads as a session spawn, so it refuses it. ${refuse("it")}`
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
