// PreToolUse hook: refuses a prepare-only worker (a session whose roster row reads mode=prepare, which ops-firefighting-start sets) every call that would claim or publish its ticket before the tracker's digest lists it: a Linear, Slack or GitHub MCP tool that writes, a `gh pr` or `gh issue` call that is not a read, a `gh api` call that is not a GET or a graphql mutation, and a `git push` or `git send-pack` to any remote, since a pushed branch is a visible write in the org's repo. The job clears the mode when it tells the session to claim, and the same calls then run. Input it cannot read lets the call run.
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
  readPath,
  run,
  type Text,
  UNKNOWN,
  type Visit,
  visible,
  type Word,
} from "./shell"

type Environment = Record<string, string | undefined>

const MCP_TOOL = /^mcp__(.+?)__(.+)$/
// A Linear tool that only reads, by its verb; every other Linear tool writes.
const LINEAR_READ = /^(?:extract_|get_|list_|search_|whoami$)/
// A Slack tool that only reads; every other Slack tool posts, edits, reacts, joins or marks.
const SLACK_READ =
  /^(?:conversations_(?:history|list|replies|unreads)$|files_info$|search_|usergroups_(?:list|me)$|users_)/
// A GitHub MCP tool that only reads, by its verb or its _read suffix; every other GitHub tool writes.
const GITHUB_READ = /^(?:get_|list_|search_)|_read$/
// The `gh pr` and `gh issue` verbs that only read.
const GH_READS = new Set(["checks", "diff", "list", "status", "view"])

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
  if (/github/i.test(server) && !GITHUB_READ.test(name)) return refuse(`the GitHub tool ${name}`)
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

const git = (args: Word[]): string | undefined => {
  const sub = gitCommand(args).sub?.value
  return sub === "push" || sub === "send-pack" ? refuse(`git ${sub}`) : undefined
}

async function gh(args: Word[], cmd: Command, env: Env): Promise<string | undefined> {
  const { head, rest } = ghCommand(args)
  if ((head[0] === "pr" || head[0] === "issue") && head[1] && !GH_READS.has(head[1]))
    return refuse(`gh ${head[0]} ${visible(head[1])}`)
  if (head[0] !== "api") return
  const request = await ghApi(rest, cmd, env, undefined)
  if (!request) return
  const path = request.endpoint.value
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+/, "")
    .replace(/^api\/v3\//, "")
    .split("?")[0]!
  if (path === "graphql") {
    // a `$(cat file)` in the query marks where that file's text goes, so each file it reads is read too
    const texts: Text[] = []
    for (const t of [...request.fields.map((f) => f.text), ...request.inputs])
      texts.push(t, ...(await Promise.all((t.reads ?? []).map((r) => readPath(r, env)))))
    if (texts.some((t) => t.unknown || t.value.includes(UNKNOWN) || /mutation/i.test(t.value)))
      return refuse("a gh api graphql mutation, or a query the hook cannot read")
    return
  }
  if (request.method !== "GET") return refuse(`gh api ${request.method} ${visible(path)}`)
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
