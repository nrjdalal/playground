// playground picker <session> allow|deny <key> ["reason"]: a session's manager answers the permission prompt its alert named, allowing what the work needs. Only the session's manager or the primary dispatcher answers, and only the call the alert's key names: a call of the session's still waiting on its result whose callKey() matches. A herdr session's pane gets a key only while its prompt shows that call: 1 (Yes, once) or Escape; a cmux session's pending Feed permission for that call is answered once or denied, as the dashboard's reply() does. A deny carries its reason, which goes to the session as a message through the ops outbox, and every answer is one log line. A dispatcher's own prompt is never answered.
import { appendFile, mkdir } from "node:fs/promises"
import { basename, join } from "node:path"

import { dispatcherOf } from "@packages/config/kinds"
import { configDirOf, dataDir } from "@packages/env/data-dir"

import { herdrDir, serverEnv, sessionsOf } from "../ops-herdr/herdr"
import { herdrPath } from "../ops-herdr/pin"
import {
  callKey,
  callOf,
  liveNames,
  managerFor,
  pendingCalls,
  queueLine,
  reportsToOf,
  rosterAgents,
  transcriptOf,
  transcriptPathOf,
} from "../stuck-alert"

export type PickerDeps = {
  agents: { kind?: unknown; name?: unknown; worker?: unknown }[]
  by: string
  cmux: (args: string[]) => Promise<string>
  herdr: (server: string, args: string[]) => Promise<string>
  live: () => Promise<Map<string, { pid: number; sessionId: string }>>
  log: (line: string) => Promise<void>
  now: () => Date
  queue: (to: string, text: string) => Promise<void>
  reportsTo: (sessionId: string) => Promise<string | undefined>
  servers: string[]
  transcript: (sessionId: string) => Promise<string>
}

const PICKER_USAGE = 'usage: playground picker <session> allow <key> | deny <key> "<reason>"'

// A permission prompt as Claude Code draws it (2.1, read off a herdr pane on 26 Oct): a full rule, its title, then the command between two dashed rules, any warning, its question and the cursor on its first option, Yes.
const QUESTION = /Do you want to (proceed|make this edit|create|allow|run|fetch|use|overwrite)/i
const FIRST_YES = /^\s*[│ ]*❯\s*1\.\s+Yes\b/m
const RULE = /^\s*─{3,}\s*$/
const DASHES = /^\s*╌{3,}\s*$/

// Pure: the permission dialog at a pane's foot, from below its top rule to its question, or null when the pane shows none.
function dialogOf(screen: string): string[] | null {
  const lines = screen.trimEnd().split("\n")
  const question = lines.findLastIndex((line) => QUESTION.test(line))
  if (question < lines.length - 15 || !FIRST_YES.test(lines.slice(question).join("\n"))) return null
  const top = lines.slice(0, question).findLastIndex((line) => RULE.test(line))
  return top < 0 ? null : lines.slice(top + 1, question + 1)
}

// The tools whose child raises its own prompts while the call waits on it: a subagent (Agent, Task), a forked skill (Skill), a workflow's agents (Workflow); so a waiting call of one is never the prompt's own.
const PARENTS = new Set(["Agent", "Skill", "Task", "Workflow"])

// Pure: whether matchOf() can judge a call at all: one with a command, a URL or a file.
const judgeable = (input: Record<string, unknown>): boolean =>
  ["command", "file_path", "url"].some((name) => typeof input[name] === "string")

// Pure: how a dialog matches the call, with whitespace and box borders dropped, since the pane wraps a long one: "strong" when the command is the whole text between its dashed rules, "weak" when the command or URL sits whole in a dialog with no such box or the file's name sits in it, else null.
const BY_HAND =
  "deny it by hand with Escape and SendMessage the session the reason, or take it to the dispatcher"

function matchOf(dialog: string[], input: Record<string, unknown>): "strong" | "weak" | null {
  const flat = (text: string) => text.replace(/[\s│]+/g, "")
  const text = flat(dialog.join(""))
  if (typeof input.command === "string") {
    const [from, to] = dialog.flatMap((line, i) => (DASHES.test(line) ? [i] : []))
    if (from !== undefined && to !== undefined)
      return flat(dialog.slice(from + 1, to).join("")) === flat(input.command) ? "strong" : null
    return flat(input.command) && text.includes(flat(input.command)) ? "weak" : null
  }
  if (typeof input.url === "string")
    return flat(input.url) && text.includes(flat(input.url)) ? "weak" : null
  return typeof input.file_path === "string" && text.includes(flat(basename(input.file_path)))
    ? "weak"
    : null
}

// Pure: why picker presses no key for this call on a pane showing this screen, or "" when the prompt is the call's own.
export function refusalOf(name: string, screen: string, transcript: string, key: string): string {
  const call = pendingCalls(transcript).find((input) => callKey(input) === key)
  if (!call) return `${name} has no call waiting with key ${key}; nothing was pressed`
  const dialog = dialogOf(screen)
  if (!dialog) return `${name}'s pane shows no permission prompt; nothing was pressed`
  const match = matchOf(dialog, call)
  if (!match) return `${name}'s prompt is not for the call with key ${key}; nothing was pressed`
  // Only a strong match rules out a waiting parent's own prompt, which draws no dashed box.
  const others = pendingCalls(
    transcript,
    match === "strong" ? (tool) => !PARENTS.has(tool as string) : undefined,
  )
  return others.some(
    (other) => callKey(other) !== key && (!judgeable(other) || matchOf(dialog, other)),
  )
    ? `${name}'s prompt may be another waiting call's (a subagent's file or URL prompt always is, while its parent waits); nothing was pressed: ${BY_HAND}`
    : ""
}

// Pure: the key picker answers the prompt on this screen by, a waiting call's, subagents' included, else null.
export const promptKey = (screen: string, transcript: string): string | null =>
  pendingCalls(transcript)
    .map(callKey)
    .find((key) => !refusalOf("", screen, transcript, key)) ?? null

type Pane = { pane: string; server: string }

const json = (text: string): Record<string, any> => {
  try {
    return JSON.parse(text) as Record<string, any>
  } catch {
    return {}
  }
}

async function paneOf(pid: number, deps: PickerDeps): Promise<Pane | null> {
  for (const server of deps.servers) {
    const panes = await deps
      .herdr(server, ["pane", "list"])
      .then((out) => (json(out).result?.panes ?? []) as { pane_id?: string }[])
      .catch(() => [])
    for (const { pane_id: pane } of panes) {
      if (!pane) continue
      const info = json(
        await deps.herdr(server, ["pane", "process-info", "--pane", pane]).catch(() => ""),
      )
      const processes = (info.result?.process_info?.foreground_processes ?? []) as {
        name?: string
        pid?: number
      }[]
      if (processes.some((p) => p.name === "claude" && p.pid === pid)) return { pane, server }
    }
  }
  return null
}

// cmux's Feed gives a tool's input as a JSON string, as the dashboard's jsonField() reads it.
const feedInput = (input: unknown): unknown => (typeof input === "string" ? json(input) : input)

const sessionOfWorkstream = (workstream: string): string =>
  Buffer.from(workstream.split(":").at(-1) ?? "", "base64").toString("utf8")

export async function runPicker(
  args: string[],
  deps: PickerDeps,
): Promise<{ code: number; out: string }> {
  const [name = "", answer = "", key = "", ...words] = args
  const reason = words.join(" ").trim()
  const refuse = (out: string) => ({ code: 1, out })
  if (!name || !/^[0-9a-f]{8}$/.test(key) || (answer !== "allow" && answer !== "deny"))
    return refuse(PICKER_USAGE)
  if (answer === "deny" && !reason)
    return refuse(`a deny carries its reason, the simpler shape ${name} is to use: ${PICKER_USAGE}`)
  const live = await deps.live()
  const session = live.get(name)
  if (!session) return refuse(`no live session is named ${name}`)
  const manager = managerFor(
    name,
    deps.agents,
    await deps.reportsTo(session.sessionId).catch(() => undefined),
    new Set(live.keys()),
  )
  if (!manager) return refuse(`${name} has no manager: its prompts are the owner's to answer`)
  if (deps.by !== manager && deps.by !== dispatcherOf(deps.agents, 1))
    return refuse(`only ${name}'s manager, ${manager}, answers its prompts; you are ${deps.by}`)
  const transcript = await deps.transcript(session.sessionId).catch(() => "")
  const call = pendingCalls(transcript).find((input) => callKey(input) === key)
  let via: "cmux" | "herdr"
  let judged: unknown = call
  const pane = await paneOf(session.pid, deps)
  if (pane) {
    const screen = await deps.herdr(pane.server, ["pane", "read", pane.pane, "--source", "visible"])
    const refusal = refusalOf(name, screen, transcript, key)
    if (refusal) return refuse(refusal)
    await deps.herdr(pane.server, [
      "pane",
      "send-keys",
      pane.pane,
      answer === "allow" ? "1" : "esc",
    ])
    via = "herdr"
  } else {
    const feed = async () =>
      (json(await deps.cmux(["rpc", "feed.list", '{"pending_only":true}'])).items ?? []) as {
        kind?: string
        request_id?: string
        tool_input?: unknown
        workstream_id?: string
      }[]
    const items = await feed()
    const item = items.find(
      (i) =>
        i.kind === "permissionRequest" &&
        sessionOfWorkstream(i.workstream_id ?? "") === session.sessionId &&
        callKey(feedInput(i.tool_input)) === key,
    )
    if (!item?.request_id) return refuse(`${name} has no pending permission prompt with key ${key}`)
    await deps.cmux([
      "rpc",
      "feed.permission.reply",
      JSON.stringify({ mode: answer === "allow" ? "once" : "deny", request_id: item.request_id }),
    ])
    if ((await feed()).some((i) => i.request_id === item.request_id))
      return refuse(`${name}'s Feed still holds the prompt after the reply: ${BY_HAND}`)
    via = "cmux"
    judged = feedInput(item.tool_input)
  }
  const what = callOf(judged).replace(/\s+/g, " ").slice(0, 120)
  const at = deps
    .now()
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
  const line = `${at} ${deps.by} ${answer} ${name} via ${via}: ${what}${reason ? ` (${reason})` : ""}`
  await deps.log(line)
  if (answer === "deny")
    await deps.queue(name, `${deps.by} denied your permission prompt (${what}): ${reason}`)
  return { code: 0, out: line }
}

const run = async (argv: string[], env: Record<string, string>): Promise<string> => {
  const proc = Bun.spawn(argv, { env, stderr: "pipe", stdout: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0)
    throw new Error(`${argv[0]} ${argv.slice(1, 3).join(" ")}: ${err.trim() || out.trim()}`)
  return out
}

// The calling session's name: the registry's entry for the nearest claude among this process's parents.
async function callerName(live: Map<string, { pid: number }>): Promise<string> {
  const pids = new Map([...live].map(([name, { pid }]) => [pid, name]))
  let pid = process.ppid
  for (let i = 0; i < 8 && pid > 1; i++) {
    const found = pids.get(pid)
    if (found) return found
    pid = Number((await run(["ps", "-o", "ppid=", "-p", String(pid)], {}).catch(() => "")).trim())
  }
  return "unknown"
}

// The real deps: the roster, herdr's CLI on each factory server, cmux's rpc, Claude's registry, the transcript, ops/picker.log and the ops outbox.
export async function pickerDeps(
  env: Record<string, string | undefined> = process.env,
): Promise<PickerDeps> {
  const live = await liveNames(env)
  const dir = herdrDir(env)
  const bin = env.HERDR_BIN_PATH || herdrPath(env)
  const ops = join(dataDir(env), "ops")
  return {
    agents: await rosterAgents(env),
    by: await callerName(live),
    cmux: (args) => run(["cmux", ...args], env as Record<string, string>),
    herdr: (server, args) => run([bin, ...args], serverEnv(env, dir, server)),
    live: async () => live,
    log: async (line) => {
      await mkdir(ops, { recursive: true })
      await appendFile(join(ops, "picker.log"), `${line}\n`)
    },
    now: () => new Date(),
    queue: (to, text) => queueLine(env, "picker", to, text),
    reportsTo: async (sessionId) =>
      reportsToOf(await transcriptPathOf(configDirOf(env), sessionId)),
    servers: sessionsOf(env),
    transcript: (sessionId) => transcriptOf(configDirOf(env), sessionId),
  }
}
