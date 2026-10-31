// PreToolUse hook, acting for a factory session alone (role.ts): refuses a Bash command that signals processes chosen by name, pattern or port (pkill, killall, fuser -k, or kill fed by pgrep, pidof, lsof, ps or fuser), since a pattern matches the live dashboard and every worker's stack (31 Oct: a session ran pkill -f on its own watcher). A kill given a literal pid, $! or a pid file's contents passes, as does every selector alone.

import { fromFactory } from "./role"
import { lex, run, UNKNOWN, parse, type Command, type Visit } from "./shell"

const BY_NAME = new Set(["killall", "pkill"])
const SELECTORS = new Set(["fuser", "lsof", "pgrep", "pidof", "ps"])

const refuse = (what: string) =>
  `no-kill-by-name hook refuses ${what}: a name, pattern or port matches the live dashboard and every worker's stack, not only your own process. Stop a background task with TaskStop, a dev stack with bun run dev:stop in its worktree, and a process you spawned with kill <pid> on the pid you hold ($! or its pid file).`

// Each producer up a pipe, nearest first, so `pgrep x | xargs kill` reads pgrep as kill's source.
function selects(cmd: Command): string | undefined {
  for (let up = cmd.stdin; up; up = up.stdin) {
    const { name } = parse(up)
    if (SELECTORS.has(name)) return name
  }
}

async function inspect(raw: string) {
  const { tool_input: toolInput, tool_name: tool } = JSON.parse(raw) as {
    tool_input?: { command?: unknown }
    tool_name?: unknown
  }
  if (tool !== "Bash" || typeof toolInput?.command !== "string") return
  // quotes and backslashes go first, since the shell reads p"k"ill and \pkill as pkill
  if (!/\b(?:fuser|kill|killall|pkill)\b/.test(toolInput.command.replace(/["'\\]/g, ""))) return
  // a command substitution runs before the command holding it, so a selector anywhere earlier in the call can feed a kill's unknown pid
  let selected: string | undefined
  const visit: Visit = async (cmd, { args, name, xargs }) => {
    if (BY_NAME.has(name)) return refuse(name)
    if (name === "fuser" && args.some((a) => /^-\w*k/.test(a.value))) return refuse("fuser -k")
    if (SELECTORS.has(name)) selected ??= name
    if (name !== "kill") return
    const source = xargs ? selects(cmd) : undefined
    if (source) return refuse(`kill fed by ${source}`)
    if (selected && args.some((a) => a.value.includes(UNKNOWN)))
      return refuse(`kill fed by ${selected}`)
  }
  const env = { files: new Map(), known: {}, process: {}, vars: new Map() }
  return run(lex(toolInput.command), env, visit)
}

// Fails open: a call the hook cannot read runs, so a parser bug never blocks a Bash command.
export async function check(raw: string): Promise<string | undefined> {
  try {
    return await inspect(raw)
  } catch {
    return undefined
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
