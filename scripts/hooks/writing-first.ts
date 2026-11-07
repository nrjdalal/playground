// Hook on PreToolUse (Bash, Edit, MultiEdit, Skill, Write), UserPromptSubmit and SessionStart: refuses a write to an agent-facing doc, a Bash call's direct one included, until the session has loaded writing-for-agents (playbook's **writing** rule).
import { existsSync, readdirSync, realpathSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import { dataDirOf } from "../../packages/env/src/data-dir"
import { UPSTREAM_SKILLS } from "../../packages/scripts/src/vendor-upstream/stage"
import { writeTargets } from "./no-main-checkout"
import { fromFactory } from "./role"
import {
  type Env,
  knownVariables,
  lex,
  pathOf,
  places,
  run,
  stdinOf,
  type Visit,
  type Word,
  withDeadline,
} from "./shell"

export const SKILL = "writing-for-agents"

type Environment = Record<string, string | undefined>
type Input = {
  agent_id?: unknown
  cwd?: unknown
  hook_event_name?: unknown
  prompt?: unknown
  session_id?: unknown
  source?: unknown
  tool_input?: { command?: unknown; file_path?: unknown; skill?: unknown } | null
  tool_name?: unknown
}

const WRITES = new Set(["Edit", "MultiEdit", "Write"])
const ID = /^[\w-]+$/
// the bare name, or a plugin's or a folder's scoped copy (`ws-home:writing-for-agents`)
const LOADS = new RegExp(`^(?:[\\w./-]+:)?${SKILL}$`)
const TYPED = new RegExp(`^\\s*/(?:[\\w./-]+:)?${SKILL}(?:\\s|$)`)
// a checkout is the factory's when it holds the factory's own skill, in core or in either folder an older worktree's branch may have, so a worktree matches and another org's repository does not
const FACTORY_MARKERS = [
  join("extensions", "core", "skills", "playbook", "SKILL.md"),
  ...["playground", "engineering"].map((folder) =>
    join("skills", folder, "playground-factory", "SKILL.md"),
  ),
]

const configDir = (env: Environment) =>
  env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude")
const marks = (env: Environment) => join(dataDirOf(env), "writing-first")

// One mark per session, and per subagent within it: a subagent's hook input carries its parent's session id beside its own agent id (measured on Claude Code 2.1.296, 13 Oct), so a parent's load would otherwise let an unloaded subagent write.
function markOf(input: Input, env: Environment): string | undefined {
  const session = typeof input.session_id === "string" ? input.session_id : ""
  const agent = typeof input.agent_id === "string" ? input.agent_id : ""
  if (!ID.test(session) || (agent && !ID.test(agent))) return
  return join(marks(env), agent ? `${session}.${agent}` : session)
}

// The path as the file system resolves it, following symlinks through the deepest part that exists, so ~/.claude/skills/<name> lands in the checkout it links to.
function real(path: string): string {
  let head = path
  const tail: string[] = []
  while (!existsSync(head)) {
    const parent = dirname(head)
    if (parent === head) return path
    tail.unshift(basename(head))
    head = parent
  }
  return join(realpathSync(head), ...tail)
}

const inside = (path: string, dir: string) => {
  const rel = relative(dir, path)
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

// The nearest folder holding .git, a file in a linked worktree and a folder in a clone.
function repoOf(path: string): string | undefined {
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir
    if (dirname(dir) === dir) return
  }
}

// A ZeroStarter skill (skills/zerostarter, which .agents/skills links to) is ours unless its frontmatter names a tool as its source rather than a repository: agent-browser and portless are vendored, copied verbatim from upstream.
async function vendored(repo: string, name: string): Promise<boolean> {
  const file = Bun.file(join(repo, "skills", "zerostarter", name, "SKILL.md"))
  if (!(await file.exists())) return false
  const source = /^source:\s*(\S+)/m.exec(await file.text())?.[1]
  return source !== undefined && !source.startsWith("https://")
}

// Whether the path is an agent-facing doc of the factory's, by its place in the checkout (symlinks resolved, so .agents/skills arrives as skills/zerostarter): skills and an extension's skills and rules (but vendored ZeroStarter skills and core's upstream skills, which only vendor:upstream writes), the dashboard rules, the guides directly in .agents, the agent guide, the scripts and hooks READMEs and the docs pages; or a handoff.
async function scoped(path: string, env: Environment): Promise<boolean> {
  const handoffs = real(join(dataDirOf(env), "handoffs"))
  if (inside(path, handoffs)) return true
  const repo = repoOf(path)
  if (!repo || !FACTORY_MARKERS.some((marker) => existsSync(join(repo, marker)))) return false
  const rel = relative(repo, path).split(sep).join("/")
  const upstream = /^extensions\/core\/skills\/([^/]+)\//.exec(rel)?.[1]
  if (upstream && UPSTREAM_SKILLS.includes(upstream)) return false
  const zerostarter = /^skills\/zerostarter\/([^/]+)\//.exec(rel)?.[1]
  if (zerostarter) return !(await vendored(repo, zerostarter))
  return (
    rel.startsWith("skills/") ||
    /^extensions\/[^/]+\/(skills|rules)\//.test(rel) ||
    rel.startsWith(".agents/dashboard/") ||
    rel.startsWith("docs/") ||
    /^\.agents\/[^/]+\.md$/.test(rel) ||
    ["AGENTS.md", "CLAUDE.md", "scripts/README.md", "scripts/hooks/README.md"].includes(rel)
  )
}

// each plugin installed and enabled for the user, or installed for the session's project
const plugins = async (env: Environment, cwd: string | undefined): Promise<string[]> => {
  const read = async (file: string): Promise<unknown> => {
    try {
      return await Bun.file(join(configDir(env), file)).json()
    } catch {
      return undefined
    }
  }
  const listed = (await read(join("plugins", "installed_plugins.json"))) as
    | {
        plugins?: Record<
          string,
          { installPath?: unknown; projectPath?: unknown; scope?: unknown }[]
        >
      }
    | undefined
  const enabled = (
    (await read("settings.json")) as { enabledPlugins?: Record<string, unknown> } | undefined
  )?.enabledPlugins
  return Object.entries(listed?.plugins ?? {}).flatMap(([key, installs]) =>
    (Array.isArray(installs) ? installs : []).flatMap((install) => {
      if (typeof install?.installPath !== "string") return []
      const loads =
        install.scope === "user"
          ? enabled?.[key] === true
          : typeof install.projectPath === "string" &&
            !!cwd &&
            !relative(install.projectPath, cwd).startsWith("..")
      return loads ? [install.installPath] : []
    }),
  )
}

const installed = async (env: Environment, cwd: string | undefined) =>
  [configDir(env), ...(cwd ? [join(cwd, ".claude")] : []), ...(await plugins(env, cwd))].some(
    (dir) => existsSync(join(dir, "skills", SKILL, "SKILL.md")),
  )

async function mark(input: Input, env: Environment) {
  const file = markOf(input, env)
  if (file) await Bun.write(file, "")
}

// A compaction drops the skill's text from context, so every mark of the session goes, its subagents' included.
function clear(input: Input, env: Environment) {
  const session = typeof input.session_id === "string" ? input.session_id : ""
  if (!ID.test(session) || !existsSync(marks(env))) return
  for (const name of readdirSync(marks(env)))
    if (name === session || name.startsWith(`${session}.`)) unlinkSync(join(marks(env), name))
}

// The refusal when the session has no mark and the skill is installed, else undefined.
async function refusal(
  input: Input,
  env: Environment,
  target: string,
): Promise<string | undefined> {
  const file = markOf(input, env)
  if (!file || existsSync(file)) return
  const cwd = typeof input.cwd === "string" ? input.cwd : undefined
  if (!(await installed(env, cwd))) return
  const who =
    typeof input.agent_id === "string" && input.agent_id ? "this subagent" : "this session"
  return `writing-first hook refuses this ${String(input.tool_name)} to ${target}: it is an agent-facing doc, and ${who} has not loaded ${SKILL} since its last compaction. Call the Skill tool with skill "${SKILL}", or the scoped name your skill list shows for it (such as "ws-home:${SKILL}"), follow it, then retry this write (playbook's **writing** rule).`
}

async function judge(input: Input, env: Environment): Promise<string | undefined> {
  const target = input.tool_input?.file_path
  if (typeof target !== "string" || !markOf(input, env)) return
  const cwd = typeof input.cwd === "string" ? input.cwd : undefined
  if (!(await scoped(real(resolve(cwd ?? "/", target)), env))) return
  return refusal(input, env, target)
}

// An interpreter of another language, by its name through a version suffix (python3.12, node18)
const INTERPRETER = /^(bun|deno|node|nodejs|perl|python|ruby)[\d.]*$/
// the options whose next word is inline code
const CODE_FLAGS = new Set(["-c", "-e", "-E", "-p", "--eval", "--print"])
// a word of code text that may name a file: one holding a slash, or a .md file's name
const PATHLIKE = /[^\s'"`()[\]{},;:=<>|&$*?!]+/g

// The words an inline interpreter script may write to: each path-like word of its code (an inline -c or -e program, or a heredoc or here-string it reads as its script) and of its arguments; none for a script run by name, which is the repo's own or the caller's file.
async function inlineTargets(
  name: string,
  args: Word[],
  cmd: Parameters<Visit>[0],
  here: Env,
): Promise<string[]> {
  if (!INTERPRETER.test(name)) return []
  const code: string[] = []
  let k = 0
  for (; k < args.length; k++) {
    const v = args[k]!.value
    if (CODE_FLAGS.has(v) && args[k + 1]) code.push(args[++k]!.value)
    else if (!v.startsWith("-") || v === "-") break
  }
  const operand = args[k]?.value
  if (code.length === 0) {
    // a script file or a subcommand by name runs no inline code
    if (operand !== undefined && operand !== "-") return []
    const fed = await stdinOf(cmd, here)
    if (fed.unknown) return []
    code.push(fed.value)
  }
  const words = [
    ...code.flatMap((text) => text.match(PATHLIKE) ?? []),
    ...args.slice(k).map((a) => a.value),
  ]
  return words.filter((w) => w.includes("/") || w.endsWith(".md"))
}

// The first agent-facing doc a Bash call writes directly, as the call names it: a redirect's, tee's, cp's, mv's, install's or an in-place sed's or perl's target, or a path an inline interpreter script names; a target the reader cannot place is passed, since the hook nudges and fails open.
async function bashTarget(input: Input, env: Environment): Promise<string | undefined> {
  const command = input.tool_input?.command
  if (typeof command !== "string") return
  const directory = typeof input.cwd === "string" ? input.cwd : undefined
  const home = env.HOME || homedir()
  const known = knownVariables(command, env, directory)
  const visit: Visit = async (cmd, parsed, at) => {
    const { args, name } = parsed
    for (const here of places(at, directory)) {
      const named = writeTargets(cmd, name, args)
      if (name === "install") named.push(...args.filter((a) => !a.value.startsWith("-")).slice(-1))
      for (const word of named) {
        const path = pathOf(word, here)
        if (path && (await scoped(real(path), env))) return word.value
      }
      if (!here.cwd) continue
      for (const word of await inlineTargets(name, args, cmd, here)) {
        const path = resolve(here.cwd, word.replace(/^~(?=\/)/, home))
        if (await scoped(real(path), env)) return word
      }
    }
  }
  const at: Env = {
    cwd: directory,
    cwdSure: directory,
    files: new Map(),
    known,
    old: { dir: directory },
    process: env,
    vars: new Map(),
  }
  return run(lex(command, known), at, visit, true)
}

// Fails open: input it cannot read, or an error, lets the call run, so a fault here never blocks every write.
export async function check(
  raw: string,
  env: Environment = process.env,
): Promise<string | undefined> {
  try {
    const input = JSON.parse(raw) as Input
    if (typeof input !== "object" || input === null) return
    const event = input.hook_event_name
    if (event === "PreToolUse" && input.tool_name === "Skill") {
      const skill = input.tool_input?.skill
      if (typeof skill === "string" && LOADS.test(skill)) await mark(input, env)
      return
    }
    if (event === "UserPromptSubmit") {
      if (typeof input.prompt === "string" && TYPED.test(input.prompt)) await mark(input, env)
      return
    }
    if (event === "SessionStart") {
      if (input.source === "compact") clear(input, env)
      return
    }
    if (event === "PreToolUse" && WRITES.has(String(input.tool_name)))
      return await judge(input, env)
    if (event === "PreToolUse" && input.tool_name === "Bash") {
      const file = markOf(input, env)
      if (!file || existsSync(file)) return
      // past the walk's deadline the call runs, inside the hook's 15s timeout
      const target = await withDeadline(8_000, () => bashTarget(input, env))
      return target === undefined ? undefined : await refusal(input, env, target)
    }
  } catch {
    return
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
