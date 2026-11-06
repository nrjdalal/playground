// PreToolUse hook: refuses a prepare-only worker (a session whose roster row reads mode=prepare, which ops-firefighting-start sets) every call that would claim or publish its ticket before the tracker's digest lists it: a Linear or Slack MCP tool that writes, a GitHub MCP pull request create, `gh pr create`, a `gh api` POST to a repo's pulls and a `git push` to any remote, since a pushed branch is a visible write in the org's repo. The job clears the mode when it tells the session to claim, and the same calls then run. Input it cannot read lets the call run.
import "../../packages/env/src/aliases"
import { join } from "node:path"

import { dataDirOf } from "../../packages/env/src/data-dir"
import { gitCommand } from "./no-stash"
import { registryName } from "./role"
import {
  type Command,
  type Env,
  ghApi,
  ghCommand,
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
// A Linear tool that only reads, by its verb; every other Linear tool writes.
const LINEAR_READ = /^(?:extract_|get_|list_|search_|whoami$)/
// A Slack tool that only reads; every other Slack tool posts, edits, reacts, joins or marks.
const SLACK_READ =
  /^(?:conversations_(?:history|list|replies|unreads)$|files_info$|search_|usergroups_(?:list|me)$|users_)/
const PULLS = /^repos\/[^/]+\/[^/]+\/pulls\/?$/

// The session's roster row's mode, read from the data folder's roster by its registry name; undefined when either does not read.
async function modeOf(sessionId: unknown, environment: Environment): Promise<string | undefined> {
  if (typeof sessionId !== "string") return undefined
  const name = await registryName(sessionId, environment)
  if (!name) return undefined
  const roster = (await Bun.file(join(dataDirOf(environment), "roster.json")).json()) as {
    agents?: { mode?: unknown; name?: unknown }[]
  }
  const mode = roster.agents?.find((agent) => agent?.name === name)?.mode
  return typeof mode === "string" ? mode : undefined
}

const refuse = (what: string): string =>
  `no-prepare-write hook refused ${what}: this session is a prepare-only worker (its roster row reads mode=prepare), so its ticket is not ours until the tracker's digest lists it. Work locally alone: the branch, the research, the red test and the draft fix, with no tracker write, no chat post and no PR. ops-firefighting-start tells you "claim <id> now" once the digest lists the ticket and clears the mode, and this call then runs; on "stop <id>", keep the branch local and end.`

function mcp(tool: string): string | undefined {
  const [, server, name] = MCP_TOOL.exec(tool) ?? []
  if (!server || !name) return
  if (/linear/i.test(server) && !LINEAR_READ.test(name)) return refuse(`the Linear tool ${name}`)
  if (/slack/i.test(server) && !SLACK_READ.test(name)) return refuse(`the Slack tool ${name}`)
  if (name === "create_pull_request") return refuse(`the tool ${name}`)
}

const visit: Visit = async (cmd, { args, name }, env) => {
  if (name === "gh") return gh(args, cmd, env)
  if (name === "git") return git(args)
  if (PRINTERS.has(name)) return
  const nested = args.findIndex((a) => ["gh", "git"].includes(program(a.value)))
  if (nested === -1) return
  return program(args[nested]!.value) === "gh"
    ? gh(args.slice(nested + 1), cmd, env)
    : git(args.slice(nested + 1))
}

const git = (args: Word[]): string | undefined =>
  gitCommand(args).sub?.value === "push" ? refuse("git push") : undefined

async function gh(args: Word[], cmd: Command, env: Env): Promise<string | undefined> {
  const { head, rest } = ghCommand(args)
  if (head.join(" ") === "pr create") return refuse("gh pr create")
  if (head[0] !== "api") return
  const request = await ghApi(rest, cmd, env, undefined)
  if (!request || request.method !== "POST") return
  const path = request.endpoint.value
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+/, "")
    .replace(/^api\/v3\//, "")
    .split("?")[0]!
  if (PULLS.test(path)) return refuse(`gh api POST ${path}`)
}

async function inspect(raw: string, environment: Environment): Promise<string | undefined> {
  const {
    cwd,
    session_id: sessionId,
    tool_input: toolInput,
    tool_name: tool,
  } = JSON.parse(raw) as {
    cwd?: unknown
    session_id?: unknown
    tool_input?: Record<string, unknown>
    tool_name?: unknown
  }
  if (typeof tool !== "string") return
  const command = toolInput?.command
  const bash =
    tool === "Bash" && typeof command === "string" && /gh|git/i.test(command.replace(/["'\\]/g, ""))
  if (!bash && !MCP_TOOL.test(tool)) return
  if ((await modeOf(sessionId, environment)) !== "prepare") return
  if (!bash) return mcp(tool)
  const directory = typeof cwd === "string" ? cwd : undefined
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known: knownVariables(command as string, environment, directory),
    process: environment,
    vars: new Map(),
  }
  return run(lex(command as string, env.known), env, visit)
}

// Fails open: a call the hook cannot read runs, so a parser bug or a missing roster never blocks a call.
export async function check(
  raw: string,
  environment: Environment = process.env,
): Promise<string | undefined> {
  try {
    return await inspect(raw, environment)
  } catch {
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
