import { stat } from "node:fs/promises"

import { folderName } from "@packages/config/console"
import {
  getSessionNames,
  kindOfName,
  managerKindOfName,
  type RosterKind,
  setSessionNames,
} from "@packages/config/kinds"
import { env } from "@packages/env/api-hono"
import { dataDir } from "@packages/env/data-dir"
import { readSessionNames } from "@packages/settings"

import { herdrAlone, runJson } from "@/lib/dashboard/cmux"
import { readsLive } from "@/lib/dashboard/fixture"
import {
  herdrRecords,
  type HerdrWait,
  herdrWorkspaces,
  isHerdrSurface,
  isHerdrWorkspace,
  readHerdr,
  readStates,
  type ServerRead,
  withHerdrState,
} from "@/lib/dashboard/herdr"
import {
  processStarts,
  readRegistry,
  registeredSessionsOf,
  type Registry,
  registryOf,
} from "@/lib/dashboard/peers"
import { readRoster, type Roster, type RosterAgent } from "@/lib/dashboard/roster"
import type { HostedMode } from "@/lib/dashboard/sdk"
import {
  clip,
  HEAD_BYTES,
  NO_FACTS,
  type OpenCall,
  type Pickers,
  readSession,
  readTask,
  shownTasks,
  type SessionFacts,
  type SessionRead,
  type SessionTask,
} from "@/lib/dashboard/transcript"
import {
  type Blocked,
  blockedSessions,
  type Held,
  readUnstick,
  UNSTICK_STALE_MS,
  type UsageLimit,
  usageLimitOf,
} from "@/lib/dashboard/unstick"
import { everySession } from "@/lib/sessions/own"
import { projectsDir } from "@/lib/sessions/paths"
import { readUsage, type Usage } from "@/lib/usage/window"

// A light is the board's one-glance state: needs-you (a picker or prompt waits on the owner), working, or idle.
export type Light = "idle" | "needs-you" | "working"

export type Question = { multiSelect: boolean; options: string[]; prompt: string }

export type FeedOption = { description: string | null; label: string }

export type FeedQuestion = {
  header: string | null
  multiSelect: boolean
  options: FeedOption[]
  prompt: string
}

// A pending item a session left in cmux's Feed, as the dashboard shows and answers it: a picker's questions, a tool it asks to run, or a plan it asks to start. requestId is what a reply names. A permission's detail is what the tool would act on (the command or path itself), input every field it was given, and description the session's own account of it when that is a line of text; clipped says detail or input was cut short. A plan's clipped says its text was. Text a format character could disguise (a right-to-left override, a zero-width space) shows each one as its code point. whole says all of it can be shown, so it may be approved from a card; the card and the API both read it.
export type FeedItem =
  | {
      at: string
      clipped: boolean
      kind: "plan"
      plan: string
      requestId: string
      whole: boolean
    }
  | {
      at: string
      clipped: boolean
      description: string | null
      detail: string
      input: string
      kind: "permission"
      requestId: string
      tool: string
      whole: boolean
    }
  | { at: string; kind: "question"; questions: FeedQuestion[]; requestId: string }

// The dispatcher runs the dashboard rather than one task, so its first ask (from a long-resumed session) says nothing about what it does now. The planner, the builder, ops and the optimizer are managers under it, by the roster's kind or else by their sessions.names names, an alias in sessions.aliases, or `optimizer`, as is any agent the roster lists with the manager role. The factory names the rest by role: `runner-<sin>` is a dedicated long-running session (one keeps the dashboard on the newest canary), `worker-<sin>` a bounded chore, and `reviewer-<sin>` and `tester-<sin>` the sessions that check a worker's pull request, which the sidebar nests under it; the roster's runner or worker role places a session of any name. A `probe-<what>` is a throwaway test, and a session with any other name is outside the factory: both are other.
export type Role = "dispatcher" | "manager" | "other" | "runner" | "worker"

// The machine's managers' names (sessions.names and sessions.aliases), set before any name is placed or the dispatcher named.
setSessionNames(readSessionNames(dataDir()))

// PLAYGROUND_DISPATCHER renames it for a test stack; it defaults to sessions.names' dispatcher.
export const DISPATCHER = env.PLAYGROUND_DISPATCHER || getSessionNames().names.dispatcher

// Pure: the second dispatcher's name, the one set, else the primary's with -2, so a test stack that names only its probe as the primary never reaches the real second dispatcher.
export const secondaryOf = (primary: string, set?: string): string => set || `${primary}-2`

// The second dispatcher, running beside the first on another model, with its own chat (#i520); PLAYGROUND_DISPATCHER_SECONDARY renames it.
export const DISPATCHER_SECONDARY = secondaryOf(DISPATCHER, env.PLAYGROUND_DISPATCHER_SECONDARY)

// Every name the dispatcher role goes to, the primary first, whose chat is the Dashboard's home and holds the Inbox; a secondary that repeats the primary adds none.
export const DISPATCHERS: readonly string[] = [...new Set([DISPATCHER, DISPATCHER_SECONDARY])]

// Pure: how many dispatcher rows the sidebar's header draws, by the web's dispatchersOf rule: the primary's always, each other one's while a session of its name is shown (registered or on the roster). /api/health carries it, so a stored sidebar's header holds that many rows and the board's arrival moves nothing below it (verify cls).
export const dispatcherSlots = (names: readonly string[], shown: ReadonlySet<string>): number =>
  names.filter((name, i) => i === 0 || shown.has(name)).length

// The header's dispatcher slot count from Claude's registry and the roster, two file reads, so /api/health never asks cmux; a crashed session's leftover file can count one row the board then drops. A stack that reads this machine without the opt-in to every session (own.ts) counts the roster's alone, where every session Playground starts lands, since the registry names every session on the machine; one that opts in reads the registry even while the launcher keeps it on herdr alone.
export const readDispatcherSlots = async (): Promise<number> => {
  const [files, { roster }] = await Promise.all([
    everySession() ? readRegistry() : null,
    readRoster(),
  ])
  const shown = [
    ...registeredSessionsOf(files).map((session) => session.name),
    ...(roster?.agents ?? []).map((agent) => agent.name),
  ]
  return dispatcherSlots(DISPATCHERS, new Set(shown))
}

// A probe is a throwaway test session (probe-<what>, or <id>-probe by kindOfName): whatever it waits on is its spawner's to answer, never the owner's.
export const isProbe = (name: string): boolean => kindOfName(name) === "probe"

// What the roster says places a session: its kind, and its role.
export type RosterPlace = Pick<RosterAgent, "kind" | "role">

// The group each kind sits in. The dispatcher's own role still goes by DISPATCHERS' names, so a dispatcher kind under any other name reads as a manager until 966's PR 6 moves the dispatcher.
const ROLE_OF_KIND: Record<RosterKind, Role> = {
  builder: "manager",
  dispatcher: "manager",
  ops: "manager",
  optimizer: "manager",
  planner: "manager",
  probe: "other",
  researcher: "worker",
  reviewer: "worker",
  runner: "runner",
  tester: "worker",
  worker: "worker",
}

// The roster's kind places a session first, whatever its name says; with none, its manager or runner role outranks the kind its name gives (`kindOfName`: an old name's prefix or an `<id>-<kind>` name's last word, so a kindless `b7k2mq-reviewer` is a worker), since the dispatcher sets it on purpose (a headless job Ops runs under another name is still a runner), and its worker role places a name that gives no kind. A probe is other whatever the roster says.
export const roleOf = (name: string, roster?: RosterPlace): Role =>
  DISPATCHERS.includes(name)
    ? "dispatcher"
    : isProbe(name)
      ? "other"
      : roster?.kind
        ? ROLE_OF_KIND[roster.kind]
        : roleByName(name, roster?.role)

const roleByName = (name: string, rosterRole?: RosterAgent["role"]): Role => {
  const kind = kindOfName(name)
  return managerKindOfName(name) || rosterRole === "manager"
    ? "manager"
    : rosterRole === "runner"
      ? "runner"
      : kind
        ? ROLE_OF_KIND[kind]
        : rosterRole === "worker"
          ? "worker"
          : "other"
}

// What a session is: the roster's kind first, else what its name gives (a dispatcher's or a manager's own name, an old name's prefix); null for a session outside the factory.
export const kindOf = (name: string, roster?: RosterPlace): RosterKind | null =>
  roster?.kind ??
  (DISPATCHERS.includes(name) ? "dispatcher" : (managerKindOfName(name) ?? kindOfName(name)))

// The roster's kind and role for a session by its name, or for one launched under its bare sin (`greed`) by the roster's `worker-greed` or `runner-greed`, as the dashboard pairs them.
export const rosterRoleOf = (
  roles: Map<string, RosterPlace>,
  name: string,
): RosterPlace | undefined =>
  roles.get(name) ?? roles.get(`worker-${name}`) ?? roles.get(`runner-${name}`)

// The dispatchers first, the primary leading, then the managers, then everyone else; the web orders the managers among themselves (byManagerOrder).
const rankOf = (worker: { name: string; role: Role }): number => {
  if (worker.role === "dispatcher") return DISPATCHERS.indexOf(worker.name) - DISPATCHERS.length
  return worker.role === "manager" ? 0 : 1
}

export type Worker = {
  cwd: string
  // The reasoning effort its newest reply ran with, as its transcript records it (low, medium, high, xhigh, max); null when none is known.
  effort: string | null
  // When it expects its chore done, as the roster last recorded it; null when the roster has none.
  eta: string | null
  // Its newest reply is an API error, so its turn ended failing rather than asking anything.
  failed: boolean
  // What it waits on in cmux's Feed, oldest first; for a herdr session, the prompt its transcript and hooks show (herdrFeed).
  feed: FeedItem[]
  // Set on a session herdr runs, whose picker cards are answered by keys into its pane (answerHerdr() in feed.ts) and whose permission and plan cards are answered in its terminal alone.
  herdr?: true
  // Set on a session the dashboard hosts itself on the Agent SDK (sdk.ts): it has no terminal, and the composer writes to it.
  hosted?: true
  // When its transcript last changed, the last thing it did (an idle session writes nothing); null when that cannot be read.
  lastActiveAt: string | null
  lifecycle: string
  light: Light
  // Set while its Claude login has expired, as its transcript's API error or ops-unstick's read of its pane says: Add account, then a restart, clears it.
  loginExpired?: true
  // The model id its newest reply came from (claude-opus-5-5); null when none is known.
  model: string | null
  name: string
  // A hosted session's permission mode, as its composer's picker shows it and the owner changes it.
  permissionMode?: HostedMode
  questions: Question[]
  role: Role
  sessionId: string
  startedAt: string | null
  // The surface the session runs on, as cmux's tree names it (surface:<n>) or herdr's pane (herdr:<server>:<pane id>), so a roster entry can pair with it whatever else shares the workspace; null when neither names one.
  surface?: string | null
  task: string | null
  // Its subagents and background processes, running first, then those that ended in the last half hour.
  tasks: SessionTask[]
  title: string | null
  updatedAt: string | null
  // Set while the account's usage limit alone holds it (ops-unstick's usage-limit kind): it waits on the reset, not on a person.
  usageLimit?: UsageLimit
  workspace: { ref: string; title: string | null } | null
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const str = (value: unknown): string => (typeof value === "string" ? value : "")

const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isRecord) : [])

// The name a session was started with: `claude -n <name>` or `--name <name>`.
export const nameOf = (args: unknown): string => {
  const argv = Array.isArray(args) ? args.map(str) : []
  for (const [i, arg] of argv.entries()) {
    if ((arg === "-n" || arg === "--name") && argv[i + 1]) return argv[i + 1] ?? ""
    if (arg.startsWith("--name=")) return arg.slice("--name=".length)
  }
  return ""
}

// A Feed item names no session; its workstream_id ends in the asking session's id, base64-encoded.
export const sessionOfWorkstream = (workstreamId: string): string => {
  const encoded = workstreamId.split(":").at(-1) ?? ""
  try {
    return Buffer.from(encoded, "base64").toString("utf8")
  } catch {
    return ""
  }
}

export const questionsBySession = (feed: unknown): Map<string, Question[]> => {
  const out = new Map<string, Question[]>()
  for (const item of list(isRecord(feed) ? feed.items : undefined)) {
    if (item.kind !== "question") continue
    const session = sessionOfWorkstream(str(item.workstream_id))
    if (!session) continue
    const questions = list(item.questions).map((q) => ({
      multiSelect: q.multi_select === true,
      options: list(q.options).map((o) => str(o.label)),
      prompt: str(q.prompt),
    }))
    out.set(session, [...(out.get(session) ?? []), ...questions])
  }
  return out
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// What a tool would act on, taken from its input rather than the session's description, so a card asking for approval shows the command itself.
const DETAIL_KEYS = ["command", "file_path", "path", "url", "pattern", "query", "notebook_path"]

const DETAIL_LIMIT = 2000
const INPUT_LIMIT = 6000
const PLAN_LIMIT = 8000

// A tool's name as Claude Code gives it (Bash, Write, mcp__server__tool); anything else is not trusted to name one.
const TOOL_NAME = /^[\w.-]+$/

// A Feed field cmux sends as JSON text, or already parsed.
const jsonField = (value: unknown): unknown =>
  typeof value === "string" ? parseJson(value) : value

const asText = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "")

// A format character (bidi controls, zero-width marks), a line or paragraph separator, or a control character other than tab and newline (an escape sequence, a backspace), shown as its code point, so text on a card reads as the characters it holds rather than as they would render.
const visible = (text: string): string =>
  text.replace(
    /[\p{Cf}\u2028\u2029]|(?![\t\n])\p{Cc}/gu,
    (ch) => `<U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}>`,
  )

const cut = (text: string, limit: number): { clipped: boolean; text: string } => {
  const shown = visible(text)
  return { clipped: shown.length > limit, text: clip(shown, limit) }
}

export const feedItemOf = (item: Json): FeedItem | null => {
  const requestId = str(item.request_id)
  if (!requestId || (item.status !== undefined && item.status !== "pending")) return null
  const at = str(item.created_at)
  if (item.kind === "question") {
    const questions = list(item.questions).map((q) => ({
      header: str(q.header) || null,
      multiSelect: q.multi_select === true,
      // An option is chosen by its label, so one with no label, or a label already offered, is not offered.
      options: list(q.options)
        .filter(
          (o, i, all) =>
            str(o.label).trim() && all.findIndex((x) => str(x.label) === str(o.label)) === i,
        )
        .map((o) => ({ description: str(o.description) || null, label: str(o.label) })),
      prompt: str(q.prompt),
    }))
    return questions.length ? { at, kind: "question", questions, requestId } : null
  }
  if (item.kind === "permissionRequest") {
    const name = str(item.tool_name)
    const input = jsonField(item.tool_input)
    const fields = isRecord(input) ? input : {}
    const key = DETAIL_KEYS.find((k) => fields[k] != null && asText(fields[k]).trim())
    const detail = cut(
      key ? asText(fields[key]) : asText(input ?? item.tool_input ?? ""),
      DETAIL_LIMIT,
    )
    // Every field, the description included, since for some tools it is the substance (an issue's body), not a gloss.
    const all = cut(
      isRecord(input) ? JSON.stringify(input, null, 2) : asText(input ?? ""),
      INPUT_LIMIT,
    )
    const clipped = detail.clipped || all.clipped
    const description = typeof fields.description === "string" ? fields.description : ""
    return {
      at,
      clipped,
      description: description && !/[\r\n]/.test(description) ? visible(description) : null,
      detail: detail.text,
      input: all.text,
      kind: "permission",
      requestId,
      tool: TOOL_NAME.test(name) ? name : "",
      whole: !clipped && Boolean(all.text.trim() || detail.text.trim()),
    }
  }
  if (item.kind === "exitPlan") {
    const parsed = jsonField(item.plan)
    const plan = cut(isRecord(parsed) ? str(parsed.plan) : str(item.plan), PLAN_LIMIT)
    return {
      at,
      clipped: plan.clipped,
      kind: "plan",
      plan: plan.text,
      requestId,
      whole: !plan.clipped && Boolean(plan.text.trim()),
    }
  }
  return null
}

// The tool that raises each kind of prompt a herdr session's hooks name, but a permission, which any tool raises.
const PROMPT_TOOLS: Record<string, string> = { plan: "ExitPlanMode", question: "AskUserQuestion" }

// Pure: the hooks' stuck record as withHerdrState() put it on a herdr record, or null.
const waitOf = (value: unknown): HerdrWait | null =>
  isRecord(value)
    ? {
        agentId: str(value.agentId) || null,
        reason: str(value.reason) || null,
        tool: str(value.tool) || null,
      }
    : null

// Pure: a herdr session's prompt as a card, herdr having no Feed: the open call in its transcript that raised it, read through feedItemOf() as cmux's Feed item would be. Its hooks' stuck record (wait) names the kind and a permission's tool; with none, the newest open call is the prompt. None for a subagent's prompt (its calls are in its own transcript), an elicitation or a login, or when no open call fits.
export function herdrFeed(calls: OpenCall[], wait: HerdrWait | null): FeedItem[] {
  if (wait?.agentId) return []
  const reason = wait?.reason ?? null
  const fits = (call: OpenCall): boolean => {
    if (reason === null) return true
    if (reason !== "permission") return call.name === PROMPT_TOOLS[reason]
    return wait?.tool ? call.name === wait.tool : !Object.values(PROMPT_TOOLS).includes(call.name)
  }
  const call = calls.findLast(fits)
  if (!call) return []
  const input = isRecord(call.input) ? call.input : {}
  const base = { created_at: call.at, request_id: call.id }
  const item =
    call.name === "AskUserQuestion"
      ? feedItemOf({
          ...base,
          kind: "question",
          questions: list(input.questions).map((q) => ({
            header: q.header,
            multi_select: q.multiSelect === true,
            options: q.options,
            prompt: q.question,
          })),
        })
      : call.name === "ExitPlanMode"
        ? feedItemOf({ ...base, kind: "exitPlan", plan: { plan: str(input.plan) } })
        : feedItemOf({
            ...base,
            kind: "permissionRequest",
            tool_input: call.input,
            tool_name: call.name,
          })
  return item ? [item] : []
}

// Each session's pending Feed items, oldest first.
export const feedBySession = (feed: unknown): Map<string, FeedItem[]> => {
  const out = new Map<string, FeedItem[]>()
  for (const item of list(isRecord(feed) ? feed.items : undefined)) {
    const session = sessionOfWorkstream(str(item.workstream_id))
    const parsed = session ? feedItemOf(item) : null
    if (!parsed) continue
    out.set(session, [...(out.get(session) ?? []), parsed])
  }
  for (const items of out.values()) items.sort((a, b) => a.at.localeCompare(b.at))
  return out
}

const LIGHT_ORDER: Record<Light, number> = { "needs-you": 0, working: 1, idle: 2 }

// A pending Feed item of any kind (a picker, a permission, a plan) waits on the owner as surely as a question does.
export const lightOf = (lifecycle: string, questions: Question[], feed: FeedItem[] = []): Light => {
  if (questions.length > 0 || feed.length > 0 || lifecycle === "needsInput") return "needs-you"
  return lifecycle === "running" ? "working" : "idle"
}

// Pure: whether an answer landed after a prompt cmux stamped at `at` went up. The Feed stamps whole seconds, so a prompt it stamped 12:00:05Z went up before 12:00:06.
const answeredAfter = (answeredAt: string | null, at: string): boolean => {
  const answered = Date.parse(answeredAt ?? "")
  const raised = Date.parse(at)
  if (Number.isNaN(answered) || Number.isNaN(raised)) return false
  return answered > (/\.\d/.test(at) ? raised : raised + 999)
}

// Pure: whether a session's transcript shows every picker it raised by `at` answered: none is still open, and the newest answer landed after that moment. cmux keeps an answered picker in its Feed, and its lifecycle at needsInput, until the session's next hook, which a turn that goes on working holds back for minutes.
export const answeredSince = (pickers: Pickers, at: string): boolean =>
  pickers.open.length === 0 && answeredAfter(pickers.answeredAt, at)

// Pure: cmux's Feed without the pickers each session's transcript shows answered. A session's newest pickers, as many as its transcript holds open, stay whatever their times; an older one goes once an answer landed after it went up. Only a picker goes: a permission or a plan may come from a subagent, whose calls its parent's transcript does not hold.
export function unansweredFeed(feed: unknown, pickersOf: (sessionId: string) => Pickers): unknown {
  if (!isRecord(feed) || !Array.isArray(feed.items)) return feed
  const asked = new Map<string, Json[]>()
  for (const item of feed.items) {
    if (!isRecord(item) || item.kind !== "question") continue
    const session = sessionOfWorkstream(str(item.workstream_id))
    asked.set(session, [...(asked.get(session) ?? []), item])
  }
  const gone = new Set<Json>()
  for (const [session, items] of asked) {
    const pickers = pickersOf(session)
    const older = items
      .toSorted((a, b) => str(b.created_at).localeCompare(str(a.created_at)))
      .slice(pickers.open.length)
    for (const item of older) {
      if (answeredAfter(pickers.answeredAt, str(item.created_at))) gone.add(item)
    }
  }
  return { ...feed, items: feed.items.filter((item) => !(isRecord(item) && gone.has(item))) }
}

export type Live = {
  surfaces: Map<string, string>
  transcripts: Map<string, string>
  workers: Worker[]
}

// What the roster says about each agent, by its full session name (worker-greed, runner-pride, the dispatcher's): its ETA, its kind and role, and its triaged title.
export type RosterFacts = {
  etas: Map<string, string>
  roles: Map<string, RosterPlace>
  titles: Map<string, string>
}

const NO_ROSTER: RosterFacts = { etas: new Map(), roles: new Map(), titles: new Map() }

export const rosterFacts = (roster: Roster | null): RosterFacts => ({
  etas: new Map(
    (roster?.agents ?? []).flatMap((agent) =>
      agent.eta ? [[agent.name, agent.eta] as const] : [],
    ),
  ),
  roles: new Map(
    (roster?.agents ?? []).map((agent) => [agent.name, { kind: agent.kind, role: agent.role }]),
  ),
  titles: new Map(
    (roster?.agents ?? []).flatMap((agent) =>
      agent.title?.trim() ? [[agent.name, agent.title.trim()] as const] : [],
    ),
  ),
})

// What proves a cmux record live, read once per refresh: Claude's registry, when each registered pid's process started (null when ps could not be run), and the transcripts folder of the Claude config that registry belongs to.
export type LiveProof = { projects: string; registry: Registry; starts: Map<number, string> | null }

// Pure: whether a cmux record is a Claude session running now. cmux keeps a record after its session ends and only checks that some process holds the pid it stored, which macOS hands to the next process that starts (a record whose session ended yesterday read live as another program's pid, a needsInput row with a red light). Claude writes a registry file at its pid while it runs, naming its session and when its process started; a clean exit removes the file, a crash leaves it. So the record is live only when the file at its pid names its session and that pid's process started when the file says, which a reused pid's never did. A file mid-rewrite, a registry or ps that cannot be read (proof null with neither), or a session under another Claude config, whose registry this one cannot see, leaves cmux's word standing.
export function isLiveRecord(record: Json, proof: LiveProof | null): boolean {
  const sessionId = str(record.session_id)
  if (!sessionId || record.stored_pid_exists !== true || record.agent !== "claude") return false
  if (!proof || proof.registry === null) return true
  const transcript = str(record.transcript_path)
  if (transcript && !transcript.startsWith(`${proof.projects}/`)) return true
  const pid = Number(record.pid)
  const entry = proof.registry.get(pid)
  if (entry === undefined) return false
  if (entry === null) return true
  if (entry.sessionId !== sessionId) return false
  if (entry.procStart === null || proof.starts === null) return true
  return proof.starts.get(pid) === entry.procStart
}

declare const LIVE: unique symbol

// cmux's session list with every record that is not a live Claude session left out. Only liveRecords() makes one, so a read that takes it (composeWorkers, tasksFor, sessionsRead) cannot be handed cmux's raw list.
export type LiveRecords = { readonly [LIVE]: true; sessions: Json[] }

// Pure: cmux's session list as LiveRecords. A null proof takes cmux's word for every record, as with no registry to read.
export const liveRecords = (sessions: unknown, proof: LiveProof | null): LiveRecords =>
  ({
    sessions: list(isRecord(sessions) ? sessions.sessions : undefined).filter((record) =>
      isLiveRecord(record, proof),
    ),
  }) as LiveRecords

// Pure: cmux's tree in, each terminal surface by the UUID a session record names, with its ref (surface:<n>) and its own title, so a session in a shared workspace can be named and paired from its own pane rather than the workspace's. Surfaces with no UUID or a malformed ref are left out.
export const surfacesOf = (tree: unknown): Map<string, { ref: string; title: string | null }> => {
  const out = new Map<string, { ref: string; title: string | null }>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const value of node) walk(value)
      return
    }
    if (!isRecord(node)) return
    for (const surface of list(node.surfaces)) {
      const id = str(surface.id)
      const ref = str(surface.ref)
      if (id && /^surface:\d+$/.test(ref)) out.set(id, { ref, title: str(surface.title) || null })
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(tree)
  return out
}

// Pure: cmux's session records, workspace list and pending Feed items in, one row per live Claude session out, the ones that need the owner first.
export function composeWorkers(
  sessions: LiveRecords,
  workspaces: unknown,
  feed: unknown,
  tasks: Map<string, string | null>,
  names: Map<string, string | null> = new Map(),
  roster: RosterFacts = NO_ROSTER,
  facts: Map<string, SessionFacts | null> = new Map(),
  now = Date.now(),
  activity: Map<string, string | null> = new Map(),
  tree: unknown = null,
): Live {
  const surfacesById = surfacesOf(tree)
  const spaces = new Map(
    list(isRecord(workspaces) ? workspaces.workspaces : undefined).map((w) => [
      str(w.id),
      { ref: str(w.ref), title: str(w.custom_title) || str(w.title) || null },
    ]),
  )
  const open = unansweredFeed(feed, (id) => (facts.get(id) ?? NO_FACTS).pickers)
  const asked = questionsBySession(open)
  const pending = feedBySession(open)
  const records = sessions.sessions
  // A session cmux did not launch, on a terminal surface where one it did launch is live, is a run nested inside that worker (a headless `claude -p` a skill trial starts), not a worker of its own.
  const launchedSurfaces = new Set(
    records
      .filter((r) => r.launch_backed === true && str(r.surface_id))
      .map((r) => str(r.surface_id)),
  )
  const shown = records.filter(
    (r) => r.launch_backed === true || !launchedSurfaces.has(str(r.surface_id)),
  )
  const perSpace = new Map<string, number>()
  for (const r of shown) {
    const id = str(r.workspace_id)
    perSpace.set(id, (perSpace.get(id) ?? 0) + 1)
  }
  const surfaces = new Map<string, string>()
  const transcripts = new Map<string, string>()
  const workers: Worker[] = []
  for (const record of shown) {
    const sessionId = str(record.session_id)
    const workspace = spaces.get(str(record.workspace_id)) ?? null
    const read = facts.get(sessionId) ?? NO_FACTS
    // An answer resumes the session before cmux hears of it; Esc and an interrupt leave it at its prompt, with no Stop hook to say so.
    const reported = str(record.agent_lifecycle) || "unknown"
    const lifecycle =
      reported === "needsInput" && answeredSince(read.pickers, str(record.updated_at))
        ? read.pickers.interrupted
          ? "idle"
          : "running"
        : reported
    const questions = asked.get(sessionId) ?? []
    const path = str(record.transcript_path)
    if (path) transcripts.set(sessionId, path)
    const surface = str(record.surface_id)
    if (surface) surfaces.set(sessionId, surface)
    const herdr = isHerdrSurface(surface)
    const feed = herdr
      ? lifecycle === "needsInput"
        ? herdrFeed(read.calls, waitOf(record.herdr_wait))
        : []
      : (pending.get(sessionId) ?? [])
    const own = surfacesById.get(surface)
    // A session is renamed while it runs (worker-wrath, runner-pride) with /rename, which its transcript records; its `claude -n` launch name never changes. So the transcript's newest name leads, then the launch name, then the session's own surface's title, then the title of a workspace that holds the session alone (in a shared one a session launched without a name is named for its folder rather than borrow another's role), and by its id only when it has no folder.
    const alone = perSpace.get(str(record.workspace_id)) === 1
    const name =
      [
        names.get(sessionId),
        nameOf(record.launch_arguments),
        own?.title,
        alone ? workspace?.title : null,
        folderName(str(record.cwd)),
      ]
        .map((candidate) => (candidate ?? "").trim())
        .find(Boolean) ?? `session ${sessionId.slice(0, 8)}`
    const role = roleOf(name, rosterRoleOf(roster.roles, name))
    workers.push({
      cwd: str(record.cwd),
      effort: read.effort,
      eta: roster.etas.get(name) ?? null,
      failed: read.failed,
      feed,
      ...(herdr && { herdr: true as const }),
      lastActiveAt: activity.get(sessionId) ?? null,
      lifecycle,
      ...(read.loginExpired && { loginExpired: true as const }),
      // a probe's prompts are its spawner's, so it never reads as waiting on the owner
      light:
        role === "other" && isProbe(name)
          ? lightOf(lifecycle === "needsInput" ? "idle" : lifecycle, [])
          : lightOf(lifecycle, questions, feed),
      model: read.model,
      name,
      questions,
      role,
      sessionId,
      startedAt: str(record.started_at) || null,
      surface: own?.ref ?? (herdr ? surface : null),
      task: role === "dispatcher" ? null : (tasks.get(sessionId) ?? null),
      tasks: shownTasks(read.tasks, now),
      title: roster.titles.get(name) ?? null,
      updatedAt: str(record.updated_at) || null,
      ...(isRecord(record.usage_limit) && { usageLimit: record.usage_limit as UsageLimit }),
      workspace,
    })
  }
  // Of two or more live sessions named for one dispatcher, the oldest by startedAt keeps the role and the later ones read as other, so a send to the name reaches the oldest instead of refusing (the dispatcher's pick); each dispatcher's name keeps its own. A time that does not parse never wins, and a tie breaks on the session id, so the keeper is the same whatever order the read met them in, and the board is sorted only once the roles are settled.
  const oldest = new Map<string, { at: number; worker: Worker }>()
  for (const w of workers) {
    if (w.role !== "dispatcher") continue
    const parsed = w.startedAt ? Date.parse(w.startedAt) : Number.NaN
    const at = Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
    const kept = oldest.get(w.name)
    if (!kept || at < kept.at || (at === kept.at && w.sessionId < kept.worker.sessionId))
      oldest.set(w.name, { at, worker: w })
  }
  for (const w of workers) {
    if (w.role === "dispatcher" && w !== oldest.get(w.name)?.worker) {
      w.role = "other"
      w.task = tasks.get(w.sessionId) ?? null
    }
  }
  workers.sort(
    (a, b) =>
      rankOf(a) - rankOf(b) ||
      LIGHT_ORDER[a.light] - LIGHT_ORDER[b.light] ||
      a.name.localeCompare(b.name),
  )
  return { surfaces, transcripts, workers }
}

// A session's task never changes once it has one, and a full head with none never gains one, so each head is read until it settles; a session whose first message alone overflows the head (a pasted image) keeps 'No task yet', the price of not re-reading 256KB on every refresh. Ended sessions are dropped.
const taskCache = new Map<string, string | null>()

async function tasksFor(
  sessions: LiveRecords,
  prune: boolean,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const live = new Set<string>()
  await Promise.all(
    sessions.sessions.map(async (record) => {
      const sessionId = str(record.session_id)
      const path = str(record.transcript_path)
      if (!path) return
      live.add(sessionId)
      if (taskCache.has(sessionId)) return void out.set(sessionId, taskCache.get(sessionId) ?? null)
      const task = await readTask(path).catch(() => null)
      if (task || Bun.file(path).size >= HEAD_BYTES) taskCache.set(sessionId, task)
      out.set(sessionId, task)
    }),
  )
  if (prune) for (const id of taskCache.keys()) if (!live.has(id)) taskCache.delete(id)
  return out
}

// A session's name changes only when it is renamed, and it sends a message only by writing it down, both of which append to its transcript, so each refresh reads just the lines appended since the last one.
const sessionCache = new Map<string, SessionRead>()

async function sessionsRead(
  sessions: LiveRecords,
  prune: boolean,
): Promise<Map<string, SessionRead | null>> {
  const out = new Map<string, SessionRead | null>()
  const live = new Set<string>()
  await Promise.all(
    sessions.sessions.map(async (record) => {
      const sessionId = str(record.session_id)
      const path = str(record.transcript_path)
      if (!path) return
      live.add(sessionId)
      const known = sessionCache.get(sessionId) ?? null
      const read = await readSession(path, known).catch(() => known)
      if (read) sessionCache.set(sessionId, read)
      out.set(sessionId, read)
    }),
  )
  if (prune) for (const id of sessionCache.keys()) if (!live.has(id)) sessionCache.delete(id)
  return out
}

// When each live session's transcript last changed.
async function activityOf(sessions: LiveRecords): Promise<Map<string, string | null>> {
  return new Map(
    await Promise.all(
      sessions.sessions
        .filter((record) => str(record.session_id) && str(record.transcript_path))
        .map(
          async (record) =>
            [
              str(record.session_id),
              await stat(str(record.transcript_path)).then(
                (file) => file.mtime.toISOString(),
                () => null,
              ),
            ] as const,
        ),
    ),
  )
}

// Sessions the dashboard hosts itself (sdk.ts registers its own), listed after cmux's: each one's row and transcript.
type Hosted = { transcript: string | null; worker: Worker }

let hosted: () => Hosted[] = () => []

export const hostSessions = (list: () => Hosted[]): void => {
  hosted = list
}

export const hostedNow = (): Hosted[] => hosted()

// Pure: cmux's live list with the hosted sessions added; a hosted session has no terminal, so it has no surface.
export const withHosted = (live: Live, own: Hosted[]): Live =>
  own.length === 0
    ? live
    : {
        ...live,
        transcripts: new Map([
          ...live.transcripts,
          ...own.flatMap(({ transcript, worker }) =>
            transcript ? [[worker.sessionId, transcript] as const] : [],
          ),
        ]),
        workers: [...live.workers, ...own.map(({ worker }) => worker)],
      }

// cmux lists its records newest first and cuts the list at --limit: at 1,000 a session quiet since the day before fell off the board once cmux held 1,873 (9 Oct), so the limit is far past any count it holds.
const sessionRecords = (filter: string[]): Promise<unknown> =>
  runJson(["sessions", "list", ...filter, "--json", "--limit", "1000000"])

// The full read costs the same at any --limit, since cmux builds every record it holds before it cuts the list (2,806 records: 5.2s and 5s of CPU at --limit 50 or 1,000,000, 12 Oct), and the hub ran it back to back under a stream of board moves until cmux timed out. So it is paced: one at a time, the next no sooner than GAP_FACTOR times as long as the last took, at least MIN_GAP_MS on a stack that reads this machine, and twice the last wait after a failure, up to MAX_GAP_MS.
export const MIN_GAP_MS = 10_000
export const MAX_GAP_MS = 120_000
const GAP_FACTOR = 3

// A read that took this long ran far past run()'s 20s timeout, which in practice only a process suspended with the machine does (a CLI slow to die after SIGTERM could too, and starting at once costs nothing there): on 15 Oct the Mac hibernated for ten minutes on 1% battery, the read in flight then failed on waking, and the wait it set (three times its own time, capped at 2 minutes) held the Dashboard on "cmux isn't running" while cmux answered. Such a read says nothing of cmux, so the next starts at once, failed or not.
const SLEPT_MS = 60_000

export const nextGap = (previous: number, took: number, ok: boolean, min = MIN_GAP_MS): number =>
  took >= SLEPT_MS
    ? 0
    : Math.min(MAX_GAP_MS, Math.max(min, GAP_FACTOR * took, ok ? 0 : 2 * previous))

// A caller that names no moment takes records from a read that started this recently, and a board stands on the last good records this long while reads fail.
const SHARED_MS = 2000
const STALE_MS = 5 * 60_000

let good: { records: unknown; startedAt: number } | null = null
let inFlight: { read: Promise<unknown>; startedAt: number } | null = null
let failed: { at: number; read: Promise<unknown>; why: string } | null = null
let gap = 0
let nextAt = 0
const landed = new Set<() => void>()

// Called each time a full read settles, so the hub can show what it read.
export const onRead = (listener: () => void): (() => void) => {
  landed.add(listener)
  return () => void landed.delete(listener)
}

const startRead = () => {
  const startedAt = Date.now()
  const read = sessionRecords([])
  inFlight = { read, startedAt }
  const settle = (records: unknown, error: unknown) => {
    const now = Date.now()
    inFlight = null
    gap = nextGap(gap, now - startedAt, error === null, readsLive() ? MIN_GAP_MS : 0)
    nextAt = now + gap
    if (error === null) good = { records, startedAt }
    failed =
      error === null
        ? null
        : { at: now, read, why: error instanceof Error ? error.message : String(error) }
    if (failed)
      console.warn(`The full sessions read from cmux failed, next in ${gap / 1000}s: ${failed.why}`)
    for (const listener of landed) listener()
  }
  read.then(
    (records) => settle(records, null),
    (error: unknown) => settle(null, error ?? "failed"),
  )
}

// The last good records, while they are young enough for a board to stand on.
const standing = (now = Date.now()) => (good && now - good.startedAt < STALE_MS ? good : null)

// While boards stand on older records because the newest full read failed, so the stale lights are named in the System report rather than silent; past STALE_MS the error frames say it instead.
export const recordsProblem = (now = Date.now()): string | null => {
  const stand = standing(now)
  return failed && stand
    ? `The full sessions read from cmux failed ${Math.round((now - failed.at) / 1000)}s ago (${failed.why}), so boards stand on sessions read ${Math.round((now - stand.startedAt) / 1000)}s ago, for up to ${STALE_MS / 60_000} minutes`
    : null
}

// The sessions of the last whole board, so a read of one workspace still knows the surface and the name another session holds, and the ops-unstick entries that board found conflicting.
let wholeHeld: Held[] = []
let unstickConflicts = { at: 0, lines: [] as string[] }

// Each ops-unstick entry whose surface and name point at two live sessions, so the System report says why neither reads stuck; gone once no board has read it for as long as ops-unstick's own file stays fresh.
export const unstickProblem = (now = Date.now()): string | null =>
  unstickConflicts.lines.length && now - unstickConflicts.at <= UNSTICK_STALE_MS
    ? unstickConflicts.lines.join("; ")
    : null

// The records a board is composed from: a read started at or after `since` when there is one, starting it when the pace allows. `wait` holds for a read in flight (a route), falling back on the last good records if it fails; without it the newest good records serve now (the hub, which readDue and onRead bring back for the newer read), so the Feed, read afresh with every board, shows a prompt at once.
const recordsFor = (since: number, wait: boolean): Promise<unknown> => {
  const current = good !== null && good.startedAt >= since
  if (!current && !inFlight && Date.now() >= nextAt) startRead()
  if (current || ((!wait || !inFlight) && standing())) return Promise.resolve(good?.records)
  if (inFlight)
    return inFlight.read.catch((error: unknown) => standing()?.records ?? Promise.reject(error))
  return failed?.read ?? Promise.reject(new Error("cmux sessions were never read"))
}

// How long until a board can hold the records cmux reported since `since`: null once the newest good read has them, or while a read is in flight (onRead says when it lands), else the wait until the pace lets the next one start.
export const readDue = (since: number): number | null =>
  herdrAlone() || (good && good.startedAt >= since) || inFlight
    ? null
    : Math.max(0, nextAt - Date.now())

// A read that fails elsewhere waits for its sessions read, since the hub starts its next once this settles. A dashboard that reads herdr alone asks cmux nothing.
export const listLive = ({ since = Date.now() - SHARED_MS, wait = true } = {}): Promise<Live> => {
  if (herdrAlone()) return liveFrom(null, null, readHerdr(), true)
  const read = recordsFor(since, wait)
  return liveFrom(read, runJson(["list-workspaces", "--json"]), readHerdr(), true).catch(
    async (error) => {
      await read.catch(() => null)
      throw error
    },
  )
}

// The board as listLive reads it, kept to the workspace that holds one session, so deliver() checks a session without walking every record cmux holds (0.37s against 2.6s, measured 9 Oct). The workspace's records alone still name its sessions as the whole board does, since a name falls back on a workspace's title only while the workspace holds one session; one with no workspace is read by its id.
export async function listSpace(worker: Worker): Promise<Live> {
  if (worker.workspace && isHerdrWorkspace(worker.workspace.ref)) {
    return liveFrom(null, null, readHerdr(), false)
  }
  const workspaces = await runJson(["list-workspaces", "--json"])
  const space = list(isRecord(workspaces) ? workspaces.workspaces : undefined).find(
    (w) => worker.workspace !== null && str(w.ref) === worker.workspace.ref,
  )
  const id = str(space?.id)
  const filter = id ? ["--workspace", id] : ["--session", worker.sessionId]
  return liveFrom(sessionRecords(filter), Promise.resolve(workspaces), Promise.resolve([]), false)
}

// `whole` is a read of every session, the only one that may drop the transcript reads kept for sessions it does not hold, since one workspace's read would drop every other's and the next board would read them cold. A null `read` is a read of herdr's sessions alone (listSpace for a herdr session), which asks cmux nothing. herdr's servers are read afresh on every board (herdr.ts) and their sessions join cmux's records, so each read below sees both.
async function liveFrom(
  read: Promise<unknown> | null,
  spaces: Promise<unknown> | null,
  herdr: Promise<ServerRead[]>,
  whole: boolean,
): Promise<Live> {
  const asksCmux = read !== null
  const [cmuxRecords, cmuxSpaces, feed, files, tree, servers] = await Promise.all([
    read,
    spaces,
    asksCmux ? runJson(["rpc", "feed.list", '{"pending_only":true}']) : Promise.resolve(null),
    readRegistry(),
    // The tree names each surface (surface:<n>) and holds its own title, what a session in a shared workspace is named and paired by; one that fails leaves the names as they were. A fixture asks cmux nothing.
    asksCmux && readsLive()
      ? runJson(["tree", "--json", "--all", "--id-format", "both"]).catch(() => null)
      : Promise.resolve(null),
    herdr,
  ])
  const registry = registryOf(files)
  const records = {
    sessions: [
      ...list(isRecord(cmuxRecords) ? cmuxRecords.sessions : undefined),
      ...herdrRecords(servers, registry, new Date().toISOString()),
    ],
  }
  const workspaces = {
    workspaces: [
      ...list(isRecord(cmuxSpaces) ? cmuxSpaces.workspaces : undefined),
      ...herdrWorkspaces(servers),
    ],
  }
  const starts = await processStarts(
    [...(registry ?? [])].flatMap(([pid, entry]) => (entry?.procStart ? [pid] : [])),
  )
  // Every read below sees live sessions alone, so an ended session's record never reaches a row, a light, a picker or a needs-you count.
  const proven = liveRecords(records, { projects: projectsDir(), registry, starts })
  const [activity, tasks, reads, roster, blocked, usage, states] = await Promise.all([
    activityOf(proven),
    tasksFor(proven, whole),
    sessionsRead(proven, whole),
    readRoster().catch(() => null),
    readUnstick(),
    readUsage(),
    readStates(
      proven.sessions
        .filter((r) => typeof r.herdr_status === "string")
        .map((r) => str(r.session_id)),
    ),
  ])
  const sessions = withHerdrState(proven, states, (id) => reads.get(id)?.turnAt ?? null)
  const facts = rosterFacts(roster?.roster ?? null)
  const names = new Map([...reads].map(([id, read]) => [id, read?.name ?? null]))
  const live = composeWorkers(
    sessions,
    workspaces,
    feed,
    tasks,
    names,
    facts,
    reads,
    Date.now(),
    activity,
    tree,
  )
  const held = live.workers.map((w) => ({
    name: w.name,
    sessionId: w.sessionId,
    surface: live.surfaces.get(w.sessionId) ?? null,
  }))
  if (whole) wholeHeld = held
  const marked = blockedSessions(
    blocked,
    whole
      ? held
      : [...held, ...wholeHeld.filter((h) => !held.some((s) => s.sessionId === h.sessionId))],
  )
  if (whole) unstickConflicts = { at: Date.now(), lines: marked.conflicts }
  return withHosted(withBlocked(live, marked.sessions, usage), hosted())
}

// Pure: a session ops-unstick finds stuck on a dialog waits on the owner, as one on a picker does, so it reads Waiting on you wherever its light shows and deliver() types nothing into it. One the usage limit alone holds, with no prompt of its own, also carries usageLimit, so its light reads paused rather than stuck. A probe's dialogs are its spawner's, as its pickers are, so it never does.
export const withBlocked = (
  live: Live,
  blocked: Map<string, Blocked[]>,
  usage: Usage | null = null,
): Live =>
  blocked.size === 0
    ? live
    : {
        ...live,
        workers: live.workers.map((w) => {
          const entries = blocked.get(w.sessionId)
          if (!entries || (w.role === "other" && isProbe(w.name))) return w
          const limit = w.light === "needs-you" ? null : usageLimitOf(entries, usage)
          const login = entries.some((entry) => entry.kind === "login") && {
            loginExpired: true as const,
          }
          return limit
            ? { ...w, ...login, light: "needs-you", usageLimit: limit }
            : { ...w, ...login, light: "needs-you" }
        }),
      }
