// PreToolUse hook, acting for a factory session alone (role.ts): refuses a Bash command that signals processes chosen by name, pattern or port (pkill, killall, fuser -k, or kill in a call that searches with pgrep, pidof, lsof, ps or fuser, the words after run-slot.sh's -- read as the command), since a pattern matches the live dashboard and every worker's stack (31 Oct: a session ran pkill -f on its own watcher). A kill given a literal pid, $! or a pid file's contents passes, as does every search alone and `ps -p <pid>`.

import { fromFactory } from "./role"
import {
  examine,
  lex,
  parse,
  program,
  run,
  shellSlot,
  SHELLS,
  slotWords,
  UNKNOWN,
  type Command,
  type Visit,
  type Word,
} from "./shell"

const BY_NAME = new Set(["killall", "pkill"])
const SEARCHES = new Set(["fuser", "lsof", "pgrep", "pidof", "ps"])
const READS_ONLY = new Set(["--help", "--version", "-V", "-h"])

const WAY_OUT =
  "Stop a background task with TaskStop, a dev stack with bun run dev:stop in its worktree, and a process you spawned with kill <pid> on the pid you hold ($! or its pid file)."

const refuse = (what: string, beside = "") =>
  `no-kill-by-name hook refuses ${what}: a name, pattern or port matches the live dashboard and every worker's stack, not only your own process. ${WAY_OUT}${beside}`

// `command -v pkill` and `pkill --help` only read; `command -v` counts only before the program, since pkill's own -v inverts its match
const readsOnly = (cmd: Command, first: Word | undefined, args: Word[]) => {
  const before = cmd.words.slice(0, first ? cmd.words.indexOf(first) : 0)
  return (
    before.some(
      (w, i) => program(w.value) === "command" && /^-[vV]$/.test(before[i + 1]?.value ?? ""),
    ) ||
    (args.length > 0 && args.every((a) => READS_ONLY.has(a.value)))
  )
}

// ps given a pid (-p, -q, --pid, --quick-pid) checks that one process, which is the way out's own liveness check
const isSearch = (name: string, args: Word[]) =>
  SEARCHES.has(name) &&
  !(
    name === "ps" && args.some((a) => /^-[A-Za-z]*[pq]$|^-[pq]\d|^--(?:quick-)?pid\b/.test(a.value))
  )

async function inspect(raw: string) {
  const { tool_input: toolInput, tool_name: tool } = JSON.parse(raw) as {
    tool_input?: { command?: unknown }
    tool_name?: unknown
  }
  if (tool !== "Bash" || typeof toolInput?.command !== "string") return
  // quotes and backslashes go first, since the shell reads p"k"ill and \pkill as pkill; a word of 2 or more back-to-back variable reads (`$P$Q`) passes too, since the reader joins the program name they hold where no literal kill token shows
  const bare = toolInput.command.replace(/["'\\]/g, "")
  if (!/\b(?:fuser|kill|killall|pkill)\b/.test(bare) && !/(?:\$\{?\w+\}?){2,}/.test(bare)) return
  const lexed = lex(toolInput.command)
  const fresh = () => ({ files: new Map(), known: {}, process: {}, vars: new Map() })
  // the whole call is read for a search first, since a loop's `done < <(pgrep …)` is read after the kill it feeds
  let search: string | undefined
  const find: Visit = async (cmd, parsed, env) => {
    const slot = slotWords(parsed)
    if (slot?.length) return examine({ ...cmd, words: slot }, env, find, false)
    if (isSearch(parsed.name, parsed.args)) search ??= parsed.name
    return undefined
  }
  await run(lexed, fresh(), find)
  // a pid xargs hands a shell it starts arrives as the -I string (`xargs -I{} sh -c 'kill {}'`)
  const handed = lexed.commands.flatMap((c) => parse(c).xargs?.replace || [])
  const visit: Visit = async (cmd, parsed, env) => {
    // run-slot.sh, typed bare or as a shell's script, runs the words after its -- as the command, with the input an xargs running run-slot hands that command alone
    const slot =
      slotWords(parsed) ??
      (SHELLS.has(parsed.name) ? shellSlot(parsed.args, parsed.name) : undefined)
    if (slot?.length) {
      const slotted = { ...cmd, words: slot }
      return examine(
        slotted,
        env,
        (c, p, e) => visit(c, c === slotted ? { ...p, xargs: p.xargs ?? parsed.xargs } : p, e),
        false,
      )
    }
    const { args, first, name, xargs } = parsed
    if (BY_NAME.has(name) && !readsOnly(cmd, first, args)) return refuse(name)
    if (name === "fuser" && args.some((a) => /^-\w*k|^--kill\b/.test(a.value)))
      return refuse("fuser -k")
    if (name !== "kill" || !search) return
    const fed =
      xargs ||
      args.some((a) => a.value.includes(UNKNOWN) || handed.some((h) => a.value.includes(h)))
    if (fed)
      return refuse(
        `a kill in a call that searches with ${search}`,
        ` Run a kill of a pid you hold in a Bash call of its own, apart from the search.`,
      )
  }
  return run(lexed, { ...fresh(), visitShells: true }, visit)
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
