// PreToolUse hook for every session run from this repo, registered in both settings files: refuses an agent-desktop call that carries --headed, that targets an app on the desktop-owner-apps guard list, or whose target it cannot read, as scripts/hooks/README.md's section states; it reads the list and nothing else, so no setting or file a session writes frees a call.
import "../../packages/env/src/aliases"
import { guardList, isStrings } from "./lists"
import {
  type Env,
  examine,
  lex,
  parse,
  program,
  readPath,
  run,
  SHELLS,
  shellOperand,
  unreadable,
  type Visit,
  type Word,
} from "./shell"

type Environment = Record<string, string | undefined>

const GUARD = "no-desktop-owner-app"
const TOOL = /^agent-desktop(?:@.*)?$/
const MENTION = /agent-desktop/
const LAUNCHERS = new Set(["bun", "bunx", "find", "npm", "npx", "pnpm", "pnpx", "yarn"])
const INTERPRETERS = new Set([
  "bun",
  "deno",
  "node",
  "osascript",
  "perl",
  "python",
  "python3",
  "ruby",
])
const TAKES = new Set([
  "--agent-id",
  "--screenshot",
  "--session",
  "--trace",
  "--wait-for",
  "--wait-for-gone",
  "--wait-timeout",
  "-w",
])
const FRONT = new Set([
  "dismiss-all-notifications",
  "dismiss-notification",
  "find",
  "focus-window",
  "list-notifications",
  "list-surfaces",
  "maximize",
  "minimize",
  "move-window",
  "press",
  "resize-window",
  "restore",
  "screenshot",
  "snapshot",
])
const ROOTED = new Set(["find", "snapshot"])
const TARGETED = new Set(["close-app", "launch"])

const OWNER =
  "ask the owner to run it with the ! prefix in the owner's own pane, which runs outside the hooks"

const headed = () =>
  `${GUARD} hook refused this agent-desktop call: it carries --headed, whose physical input moves the owner's own pointer and focus. --headed is the owner's alone, so ${OWNER}.`

const listed = (app: string) =>
  `${GUARD} hook refused this agent-desktop call: it targets ${app}, an app on the desktop-owner-apps guard list of the owner's own apps. Leave it alone; when the task needs it, ${OWNER}, or ask the owner to take ${app} off the list in the owner's login extension with a ! command Ops prepares.`

const unread = (what: string) =>
  `${GUARD} hook refused this agent-desktop call: it cannot read ${what} before the command runs, so it cannot tell whether the call carries --headed or targets an app on the desktop-owner-apps list. Write the agent-desktop command's every word literally as a command of its own, or ${OWNER}.`

const front = (sub: string) =>
  `${GUARD} hook refused this agent-desktop call: ${sub} with no --app acts on the app in front, which may be one of the owner's own. Name the app with --app <App>, or act on a ref a snapshot of that app gave.`

const SCRIPT_IN_CALL =
  "a script file in a call that names agent-desktop, since the call may change it"

// A list refusal's reason alone, without the fix it names, since only the owner's own ! command changes the list.
const reasonOf = (refusal: string) =>
  refusal.split(/: ask Ops for the owner to seed the guards'|\. Restore the file/)[0]

const appName = (value: string) =>
  (value.split("/").filter(Boolean).pop() ?? "")
    .replace(/\.app$/i, "")
    .trim()
    .toLowerCase()

// The verdict on agent-desktop's own words, the program name excluded.
function judge(words: Word[], viaXargs: boolean, apps: Set<string>): string | undefined {
  if (viaXargs) return unread("the words xargs appends")
  const hidden = words.find((w) => unreadable(w))
  if (hidden) return unread(hidden.unknown ? `a word built from ${hidden.unknown}` : "a word")
  const values = words.map((w) => w.value)
  if (values.some((v) => v === "--headed" || v.startsWith("--headed="))) return headed()
  let sub = ""
  let at = -1
  for (let k = 0; k < values.length; k++) {
    if (TAKES.has(values[k])) k++
    else if (!values[k].startsWith("-")) {
      sub = values[k]
      at = k
      break
    }
  }
  if (sub === "batch") return unread("the commands a batch's JSON holds; run each on its own")
  if (sub === "notification-action") return unread("which app a notification index belongs to")
  if (values.some((v) => v === "--window-id" || v.startsWith("--window-id=")))
    return unread("which app a --window-id belongs to")
  const named: string[] = []
  values.forEach((v, k) => {
    if (v === "--app" && values[k + 1] !== undefined) named.push(values[k + 1])
    else if (v.startsWith("--app=")) named.push(v.slice("--app=".length))
  })
  if (TARGETED.has(sub)) named.push(...values.slice(at + 1).filter((v) => !v.startsWith("-")))
  const hit = named.find((v) => apps.has(appName(v)))
  if (hit) return listed(hit)
  const rooted = ROOTED.has(sub) && values.some((v) => v === "--root" || v.startsWith("--root="))
  if (FRONT.has(sub) && named.length === 0 && !rooted) return front(sub)
}

// The guard list's apps, read once per call and only for a call that runs agent-desktop.
function lister(environment: Environment) {
  let loaded: Promise<{ apps?: Set<string>; refusal?: string }> | undefined
  return () =>
    (loaded ??= guardList(GUARD, "desktop-owner-apps", isStrings, [], environment).then((l) =>
      l.refusal
        ? {
            refusal: `${reasonOf(l.refusal)}. The list changes only by the owner's own ! command: ask your lead to have Ops prepare it for the owner, then run the call again.`,
          }
        : { apps: new Set((l.list ?? []).map(appName)) },
    ))
}

async function judgeText(
  text: string,
  cwd: string | undefined,
  apps: ReturnType<typeof lister>,
  depth: number,
): Promise<string | undefined> {
  const lexed = lex(text)
  const mention = MENTION.test(text.replace(/["'\\]/g, ""))
  const env: Env = { cwd, files: new Map(), known: {}, process: {}, vars: new Map() }
  for (const cmd of lexed.commands) {
    const { args, name } = parse(cmd)
    if (!SHELLS.has(name)) continue
    const { inline, operand } = shellOperand(args)
    if (operand && !inline) {
      const verdict = await script(operand, env, mention, apps, depth)
      if (verdict) return verdict
    }
  }
  const visit: Visit = async (cmd, parsed, here) => {
    const { args, first, name, xargs } = parsed
    if (name === "run-slot.sh") {
      const at = args.findIndex((a) => a.value === "--")
      const inner = { ...cmd, words: at === -1 ? [] : args.slice(at + 1) }
      return inner.words.length === 0 ? undefined : examine(inner, here, visit, false)
    }
    let words: Word[] | undefined
    if (TOOL.test(name)) words = args
    else if (LAUNCHERS.has(name)) {
      const at = args.findIndex((a) => TOOL.test(program(a.value)))
      if (at !== -1) words = args.slice(at + 1)
    }
    if (words) {
      const list = await apps()
      return list.refusal ?? judge(words, xargs !== undefined, list.apps ?? new Set())
    }
    if (!mention) {
      const path = name === "source" || name === "." ? args[0] : undefined
      return path || first?.value.includes("/")
        ? script(path ?? (first as Word), here, false, apps, depth)
        : undefined
    }
    if (first && unreadable(first))
      return unread(
        `the program it runs (it comes from ${first.unknown ?? "a word it cannot read"})`,
      )
    if (INTERPRETERS.has(name) && args.some((a) => MENTION.test(a.value)))
      return unread(`what ${name} runs`)
    if (name === "source" || name === "." || first?.value.includes("/"))
      return unread(SCRIPT_IN_CALL)
  }
  return run(lexed, env, visit)
}

// A script file the call runs: judged by its text when it names agent-desktop, refused when the call itself names agent-desktop, since the call may write the file first.
async function script(
  path: Word,
  env: Env,
  mention: boolean,
  apps: ReturnType<typeof lister>,
  depth: number,
): Promise<string | undefined> {
  if (mention) return unread(SCRIPT_IN_CALL)
  const text = await readPath(path, env)
  if (text.unknown || !MENTION.test(text.value) || depth > 2) return
  return judgeText(text.value, env.cwd, apps, depth + 1)
}

export async function check(
  raw: string,
  environment: Environment = process.env,
): Promise<string | undefined> {
  try {
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
    return await judgeText(
      toolInput.command,
      typeof cwd === "string" ? cwd : undefined,
      lister(environment),
      0,
    )
  } catch {
    // Fails open: a call the hook cannot parse runs, so a parser bug never blocks a Bash command.
    return undefined
  }
}

if (import.meta.main) {
  const reason = await check(await Bun.stdin.text())
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
