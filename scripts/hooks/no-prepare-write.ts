// A check for a prepare-only session (its roster row reads mode=prepare, which an org's start job sets at a prepare-only start): it refuses the writes that would reach the org before the session claims its ticket, a tracker issue save (an assign or a state change), a tracker comment, a chat post, a new pull request (`gh pr create` or the GitHub tool) and a `git push`, and lets them run once the mode clears at the claim. guards.ts runs it on Bash and no-playground-leak's process on the MCP tools, so it has no main block of its own. It fails open, since the session's brief is the first bar: a read that fails lets the call run and writes a line to the data folder's ops/no-prepare-write.log.
import "../../packages/env/src/aliases"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { dataDirOf } from "../../packages/env/src/data-dir"
import { registryName } from "./role"
import {
  type Env,
  ghCommand,
  GIT_TAKES,
  knownVariables,
  lex,
  PRINTERS,
  program,
  run,
  type Visit,
  type Word,
} from "./shell"

type Environment = Record<string, string | undefined>

const MCP_TOOL = /^mcp__(.+?)__(.+)$/
// Each MCP server's write tools a prepare-only session waits on, by a word its server's name holds.
const WRITES: [RegExp, Set<string>][] = [
  [/github/i, new Set(["create_pull_request"])],
  [/linear/i, new Set(["save_comment", "save_issue"])],
  [/slack/i, new Set(["chat_post_message"])],
]

const refuse = (what: string): string =>
  `no-prepare-write hook refused ${what}: this session is preparing a ticket it has not claimed (its roster row reads mode=prepare), so nothing reaches the org yet: no tracker write, no chat post, no push and no pull request. Work on the local branch alone. Its waiter clears the mode the moment it prints its Claim line, and this call then runs.`

const log = (environment: Environment, entry: Record<string, unknown>) => {
  try {
    const dir = join(dataDirOf(environment), "ops")
    mkdirSync(dir, { recursive: true })
    appendFileSync(
      join(dir, "no-prepare-write.log"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    )
  } catch {}
}

const mcpWrite = (tool: string): boolean => {
  const [, server, name] = MCP_TOOL.exec(tool) ?? []
  return !!server && !!name && WRITES.some(([word, tools]) => word.test(server) && tools.has(name))
}

const prCreate = (args: Word[]): boolean => {
  const { head } = ghCommand(args)
  return head[0] === "pr" && head[1] === "create"
}

// Whether git's subcommand, past its global options (GIT_TAKES), is push.
const pushes = (args: Word[]): boolean => {
  let k = 0
  for (; k < args.length && args[k].value.startsWith("-"); k++)
    if (GIT_TAKES.has(args[k].value)) k++
  return args[k]?.value === "push"
}

const visit: Visit = async (_cmd, { args, name }) => {
  if (name === "gh") return prCreate(args) ? "gh pr create" : undefined
  if (name === "git") return pushes(args) ? "git push" : undefined
  if (PRINTERS.has(name)) return
  const nested = args.findIndex((a) => program(a.value) === "gh" || program(a.value) === "git")
  if (nested === -1) return
  const rest = args.slice(nested + 1)
  if (program(args[nested].value) === "git") return pushes(rest) ? "git push" : undefined
  return prCreate(rest) ? "gh pr create" : undefined
}

// The write the call makes, named, or undefined for any other call.
async function writeOf(
  tool: string,
  input: Record<string, unknown> | undefined,
  cwd: unknown,
  environment: Environment,
): Promise<string | undefined> {
  if (mcpWrite(tool)) return `the tool ${tool}`
  const command = input?.command
  if (tool !== "Bash" || typeof command !== "string" || !/gh|git/.test(command)) return
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

// Whether the session's roster row reads mode=prepare; a session the registry or the roster does not hold is not marked, and a roster that does not read throws.
async function marked(sessionId: unknown, environment: Environment): Promise<boolean> {
  if (typeof sessionId !== "string") return false
  const name = await registryName(sessionId, environment)
  if (!name) return false
  const roster = (await Bun.file(join(dataDirOf(environment), "roster.json")).json()) as {
    agents?: { mode?: unknown; name?: unknown }[]
  }
  return roster.agents?.find((agent) => agent?.name === name)?.mode === "prepare"
}

export async function check(
  raw: string,
  environment: Environment = process.env,
): Promise<string | undefined> {
  let input: {
    cwd?: unknown
    session_id?: unknown
    tool_input?: Record<string, unknown>
    tool_name?: unknown
  }
  try {
    input = JSON.parse(raw)
  } catch {
    return
  }
  const { cwd, session_id: session, tool_input: toolInput, tool_name: tool } = input
  if (typeof tool !== "string") return
  let write: string | undefined
  try {
    write = await writeOf(tool, toolInput, cwd, environment)
    if (!write) return
    return (await marked(session, environment)) ? refuse(write) : undefined
  } catch (error) {
    log(environment, { error: String(error), session, tool, write })
    return
  }
}
