// Hook on PreToolUse (Edit, MultiEdit, Skill, Write), UserPromptSubmit and SessionStart: refuses a write to an agent-facing doc until the session has loaded writing-for-agents (playbook's **writing** rule).
import { existsSync, readdirSync, readFileSync, realpathSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import { dataDirOf } from "../../packages/env/src/data-dir"
import { UPSTREAM_SKILLS } from "../../packages/scripts/src/vendor-upstream/stage"
import { fromFactory } from "./role"

export const SKILL = "writing-for-agents"

type Environment = Record<string, string | undefined>
type Input = {
  agent_id?: unknown
  cwd?: unknown
  hook_event_name?: unknown
  prompt?: unknown
  session_id?: unknown
  source?: unknown
  tool_input?: { file_path?: unknown; skill?: unknown } | null
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

// each plugin Claude Code loads here: a user install enabled in the user settings, or a project's install for the folder the session runs in
const plugins = (env: Environment, cwd: string | undefined): { name: string; path: string }[] => {
  const read = (file: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(configDir(env), file), "utf8"))
    } catch {
      return undefined
    }
  }
  const listed = read(join("plugins", "installed_plugins.json")) as
    | {
        plugins?: Record<
          string,
          { installPath?: unknown; projectPath?: unknown; scope?: unknown }[]
        >
      }
    | undefined
  const enabled = (
    read("settings.json") as { enabledPlugins?: Record<string, unknown> } | undefined
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
      return loads ? [{ name: key.split("@")[0], path: install.installPath }] : []
    }),
  )
}

// the name a session loads the skill by, bare for a skills folder's copy, scoped for a plugin's, or none when no copy is installed
const loadable = (env: Environment, cwd: string | undefined): string | undefined => {
  const has = (dir: string) => existsSync(join(dir, "skills", SKILL, "SKILL.md"))
  if ([configDir(env), ...(cwd ? [join(cwd, ".claude")] : [])].some(has)) return SKILL
  const plugin = plugins(env, cwd).find((p) => has(p.path))
  return plugin && `${plugin.name}:${SKILL}`
}

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

async function judge(input: Input, env: Environment): Promise<string | undefined> {
  const target = input.tool_input?.file_path
  const file = markOf(input, env)
  if (typeof target !== "string" || !file) return
  const cwd = typeof input.cwd === "string" ? input.cwd : undefined
  const path = real(resolve(cwd ?? "/", target))
  if (!(await scoped(path, env)) || existsSync(file)) return
  const name = loadable(env, cwd)
  if (!name) return
  const who =
    typeof input.agent_id === "string" && input.agent_id ? "this subagent" : "this session"
  return `writing-first hook refuses this ${String(input.tool_name)} to ${target}: it is an agent-facing doc, and ${who} has not loaded ${SKILL} since its last compaction. Call the Skill tool with skill "${name}", follow it, then retry this write (playbook's **writing** rule).`
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
