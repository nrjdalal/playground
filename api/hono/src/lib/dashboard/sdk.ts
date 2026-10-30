import "@packages/env/aliases"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  query,
  type CanUseTool,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"
import { PERMISSION_MODE_LABELS } from "@packages/config/console"
import { dashboardMessageSummary, type ActivityActor, type ActivityEvent } from "@packages/db"
import { env } from "@packages/env/api-hono"
import { dataDirOf } from "@packages/env/data-dir"

import { claudeBinary } from "@/lib/claude-binary"
import { withAttachments } from "@/lib/dashboard/attachments"
import type { FeedReply } from "@/lib/dashboard/cmux"
import {
  deliverDeps,
  normalize,
  refusal,
  type Delivery,
  type DeliveryResult,
} from "@/lib/dashboard/deliver"
import {
  answerDeps,
  answerSummary,
  canApprove,
  replyFor,
  type FeedAnswering,
  type FeedResult,
} from "@/lib/dashboard/feed"
import { feedItemOf, hostSessions, type FeedItem, type Worker } from "@/lib/dashboard/workers"
import { SESSION_FILE } from "@/lib/sessions/own"
import { transcriptPath } from "@/lib/sessions/paths"

// The dashboard's second way to reach a session, beside the cmux one: a session it hosts itself on the Claude Agent SDK, which runs the installed `claude` on this user's own login. Phase 1 hosts one throwaway session, probe-sdk, in the folder PLAYGROUND_SDK_PROBE_DIR names. A message goes in as a user message on its input stream, never typed into a terminal, and its replies reach the dashboard from its transcript, as every other session's do. What it asks (a tool to run, a picker, a plan) waits on its canUseTool callback, shown as a NeedsYou card and answered by the card's Submit.
export const SDK_PROBE = "probe-sdk"

export { SESSION_FILE }

// A prompt nobody answers is refused after this long, so the session never hangs on a card no one will answer (a permission or plan card is read-only while PLAYGROUND_APPROVALS_ENABLED is off). The cards say 10 minutes too: the read-only footer in needs-you-card.tsx and both clipped-card lines in needs-you.ts.
export const PROMPT_TIMEOUT_MS = 10 * 60_000

export const TIMED_OUT = "No answer came from the dashboard in time, so this was not allowed."

// The modes the composer's picker offers for the hosted session, as Claude Code's own Shift+Tab cycles them (its auto and dontAsk modes stay out). PLAYGROUND_SDK_PERMISSION_MODE in packages/env names the one it starts in, bypassPermissions as the factory's terminal sessions do.
export const HOSTED_MODES = ["acceptEdits", "bypassPermissions", "default", "plan"] as const

export type HostedMode = (typeof HOSTED_MODES)[number]

const isHostedMode = (mode: unknown): mode is HostedMode =>
  HOSTED_MODES.includes(mode as HostedMode)

type Pending = {
  input: Record<string, unknown>
  item: FeedItem
  settle: (result: PermissionResult) => void
}

// What the hosted session takes from the API's environment: the user's shell basics and Claude Code's config folder, nothing else, plus PLAYGROUND_ROLE=probe, which makes it a factory probe for the factory's hooks. The API's environment holds its .env (the database URL, auth secrets, PLAYGROUND_SDK_PROBE_DIR) and the Claude Code session or cmux terminal it runs under; none of it reaches the session, and with no API key it runs on the login alone.
const HOSTED_ENV = [
  "CLAUDE_CONFIG_DIR",
  "HOME",
  "LANG",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
]

export const hostedEnv = (
  from: Record<string, string | undefined> = process.env,
): Record<string, string> => {
  const env: Record<string, string> = {}
  for (const key of HOSTED_ENV) {
    const value = from[key]
    if (value !== undefined) env[key] = value
  }
  return { ...env, PLAYGROUND_ROLE: "probe" }
}

// Pure: what the session asks, as the card that shows it. A picker is AskUserQuestion's questions; ExitPlanMode is a plan; anything else is a tool it asks to run, shown with its whole input. Clipping and hidden characters follow the Feed's own rules.
export function askOf(
  tool: string,
  input: Record<string, unknown>,
  requestId: string,
  at: string,
): FeedItem | null {
  const base = { created_at: at, request_id: requestId }
  if (tool === "AskUserQuestion") {
    const questions = Array.isArray(input.questions) ? input.questions : []
    return feedItemOf({
      ...base,
      kind: "question",
      questions: questions.map((q: Record<string, unknown>) => ({
        header: q.header,
        multi_select: q.multiSelect === true,
        options: q.options,
        prompt: q.question,
      })),
    })
  }
  if (tool === "ExitPlanMode") return feedItemOf({ ...base, kind: "exitPlan", plan: input.plan })
  return feedItemOf({ ...base, kind: "permissionRequest", tool_input: input, tool_name: tool })
}

// Pure: the card's answer as the callback's result. A picker is allowed with its answers by question; a tool runs with the input it asked with; a plan starts, or goes back with the note.
export function resultOf(
  item: FeedItem,
  input: Record<string, unknown>,
  reply: FeedReply,
): PermissionResult {
  if (item.kind === "question" && reply.kind === "question") {
    const answers = Object.fromEntries(
      item.questions.map((q, i) => [q.prompt, reply.selections[i] ?? ""]),
    )
    return { behavior: "allow", updatedInput: { ...input, answers } }
  }
  if (reply.kind === "permission" && reply.mode === "once") {
    return { behavior: "allow", updatedInput: input }
  }
  if (reply.kind === "plan" && reply.mode === "manual") {
    return { behavior: "allow", updatedInput: input }
  }
  if (reply.kind === "plan") {
    return {
      behavior: "deny",
      message: reply.feedback ?? "The plan was sent back from the dashboard.",
    }
  }
  return { behavior: "deny", message: "Denied from the dashboard." }
}

// Pure: where Claude Code writes this session's transcript, under the login's own config folder.
export const transcriptOf = (
  cwd: string,
  sessionId: string,
  config = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
): string => transcriptPath(config, cwd, sessionId)

// The factory's own settings, which every factory session is started with (its hooks: no-playground-leak, no-stash and the rest), linked by scripts/link-skills.sh.
export const FACTORY_SETTINGS = join(dataDirOf({}), "factory-settings.json")

// The settings the hosted session runs with: the factory's, when this machine has them, and crossSessionInbound "accept", since the factory's sessions run in bypass mode and a peer's SendMessage would otherwise wait for approval here.
export function hostedSettings(path = FACTORY_SETTINGS): Record<string, unknown> {
  const factory = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>)
    : {}
  return { ...factory, crossSessionInbound: "accept" }
}

export type HostDeps = {
  exists: (path: string) => boolean
  now: () => Date
  query: typeof query
  timeoutMs: number
}

const hostDeps: HostDeps = {
  exists: existsSync,
  now: () => new Date(),
  query,
  timeoutMs: PROMPT_TIMEOUT_MS,
}

// One hosted session: its input stream, its prompts waiting on a card, and whether a turn is running.
export class SdkHost {
  private inbox: SDKUserMessage[] = []
  private wake: (() => void) | null = null
  private pending = new Map<string, Pending>()
  private listeners = new Set<() => void>()
  private working = false
  private cwd = ""
  private startedAt: string | null = null
  private session: Query | null = null
  private mode: HostedMode = "default"
  sessionId: string | null = null
  transcript: string | null = null

  constructor(private readonly deps: HostDeps = hostDeps) {}

  // Starts the session in dir with the installed claude in the given mode, and says whether it picked up a session an earlier run started, resuming the one SESSION_FILE names once it has a transcript: a session writes none until its first message, and resuming an id with none fails, so until then the id starts afresh. Bypass is allowed from the start whatever the mode, so the picker can switch to it later; only changeHostedMode() switches, behind the owner and PLAYGROUND_APPROVALS_ENABLED.
  start(dir: string, claude: string, mode: HostedMode): { resumed: boolean } {
    const file = join(dir, SESSION_FILE)
    const known = existsSync(file) ? readFileSync(file, "utf8").trim() : ""
    const id = known || randomUUID()
    if (!known) writeFileSync(file, `${id}\n`)
    this.cwd = dir
    this.sessionId = id
    this.transcript = transcriptOf(dir, id)
    const resume = Boolean(known) && this.deps.exists(this.transcript)
    this.startedAt = this.deps.now().toISOString()
    this.mode = mode
    const stream = this.deps.query({
      options: {
        allowDangerouslySkipPermissions: true,
        canUseTool: this.ask,
        cwd: dir,
        env: hostedEnv(),
        extraArgs: { name: SDK_PROBE },
        includePartialMessages: true,
        pathToClaudeCodeExecutable: claude,
        permissionMode: mode,
        settingSources: ["user", "project", "local"],
        settings: hostedSettings(),
        systemPrompt: { preset: "claude_code", type: "preset" },
        tools: { preset: "claude_code", type: "preset" },
        ...(resume ? { resume: id } : { sessionId: id }),
      },
      prompt: this.input(),
    })
    this.session = stream
    void this.read(stream)
    return { resumed: Boolean(known) }
  }

  // Switches the running session's mode as Shift+Tab does in a terminal; the row shows the new mode once the session has taken it.
  async setMode(mode: HostedMode): Promise<void> {
    if (!this.session) throw new Error(`${SDK_PROBE} is not running`)
    await this.session.setPermissionMode(mode)
    this.mode = mode
    this.changed()
  }

  currentMode(): HostedMode {
    return this.mode
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed() {
    for (const listener of this.listeners) listener()
  }

  private async *input(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const next = this.inbox.shift()
      if (next) yield next
      else await new Promise<void>((resolve) => (this.wake = resolve))
    }
  }

  // The session's own messages say when a turn runs; its replies reach the dashboard from its transcript. When its process ends, the dashboard lists it no more.
  private async read(stream: AsyncIterable<SDKMessage>) {
    try {
      for await (const message of stream) {
        // the session says its mode at each turn's start and when it changes it itself, as leaving plan mode does
        const reported = message.type === "system" && "permissionMode" in message
        if (
          reported &&
          isHostedMode(message.permissionMode) &&
          message.permissionMode !== this.mode
        ) {
          this.mode = message.permissionMode
          this.changed()
        }
        if (message.type === "result" && this.working) {
          this.working = false
          this.changed()
        } else if (message.type === "assistant" && !this.working) {
          // a turn the session starts itself (a peer's SendMessage) runs too
          this.working = true
          this.changed()
        }
      }
    } catch (error) {
      console.error(`${SDK_PROBE} stopped:`, error instanceof Error ? error.message : error)
    } finally {
      this.session = null
      this.sessionId = null
      this.working = false
      this.changed()
    }
  }

  // Puts text on the session's input as the user's own message: its transcript records it as a person's, as it does a prompt typed in a terminal, so the stream shows it as his.
  send(text: string): void {
    this.inbox.push({
      message: { content: text, role: "user" },
      origin: { kind: "human" },
      parent_tool_use_id: null,
      type: "user",
    })
    this.working = true
    this.wake?.()
    this.wake = null
    this.changed()
  }

  readonly ask: CanUseTool = (tool, input, { signal }) => {
    const requestId = randomUUID()
    const item = askOf(tool, input, requestId, this.deps.now().toISOString())
    if (!item)
      return Promise.resolve({ behavior: "deny", message: "The dashboard cannot show this." })
    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(
        () => this.settle(requestId, { behavior: "deny", message: TIMED_OUT }),
        this.deps.timeoutMs,
      )
      const settle = (result: PermissionResult) => {
        clearTimeout(timer)
        this.pending.delete(requestId)
        this.changed()
        resolve(result)
      }
      this.pending.set(requestId, { input, item, settle })
      signal.addEventListener("abort", () => settle({ behavior: "deny", message: "Cancelled." }))
      this.changed()
    })
  }

  // Whether a card waits on an answer.
  waiting(): boolean {
    return this.pending.size > 0
  }

  pendingItem(requestId: string): Pending | null {
    return this.pending.get(requestId) ?? null
  }

  // Answers one waiting prompt; false when it no longer waits.
  settle(requestId: string, result: PermissionResult): boolean {
    const waiting = this.pending.get(requestId)
    if (!waiting) return false
    waiting.settle(result)
    return true
  }

  // The session as the dashboard lists it. A probe's prompts are its spawner's, so it reads working or idle, never waiting on you; its cards still show in its stream.
  worker(): Worker | null {
    if (!this.sessionId) return null
    const feed = [...this.pending.values()]
      .map((p) => p.item)
      .sort((a, b) => a.at.localeCompare(b.at))
    return {
      cwd: this.cwd,
      effort: null,
      eta: null,
      failed: false,
      feed,
      hosted: true,
      lastActiveAt: null,
      lifecycle: this.working ? "running" : "idle",
      light: this.working ? "working" : "idle",
      model: null,
      name: SDK_PROBE,
      permissionMode: this.mode,
      questions: [],
      role: "other",
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      task: null,
      tasks: [],
      title: null,
      updatedAt: null,
      workspace: null,
    }
  }
}

const HOST = Symbol.for("playground.dashboard.sdk.host")
const held = globalThis as { [HOST]?: SdkHost }

// One host for the process: a reload under bun --hot keeps the running session rather than starting a second one.
export const sdkHost = (held[HOST] ??= new SdkHost())

// Starts the probe when PLAYGROUND_SDK_PROBE_DIR names its folder, in the mode PLAYGROUND_SDK_PERMISSION_MODE names, and only on the installed claude (the SDK would otherwise run a copy of its own); a reload under bun --hot runs this again with the session still running, so the session is listed again and the host kept. A restart that picks up the session an earlier run started puts it back in that mode, whatever was picked before, so the console's activity says so (the pick itself comes back later).
export function startSdkProbe(
  dir = env.PLAYGROUND_SDK_PROBE_DIR,
  host: SdkHost = sdkHost,
  claude = claudeBinary(),
  mode: HostedMode = env.PLAYGROUND_SDK_PERMISSION_MODE,
  record: (event: ActivityEvent) => Promise<void> = (event) =>
    answerDeps.record(event, async () => {}),
): void {
  if (!dir) return
  hostSessions(() => {
    const worker = host.worker()
    return worker ? [{ transcript: host.transcript, worker }] : []
  })
  if (host.sessionId) return
  if (!existsSync(dir)) return void console.error(`PLAYGROUND_SDK_PROBE_DIR ${dir} does not exist`)
  if (!claude) return void console.error(`${SDK_PROBE} needs claude on PATH`)
  // Claude Code names the transcript's folder from the real working folder, so a trailing slash, a relative path or a symlink is resolved first
  const { resumed } = host.start(realpathSync(dir), claude, mode)
  if (!resumed) return
  const event: ActivityEvent = {
    action: "dashboard.mode",
    actor: { label: "Dashboard" },
    summary: `Reset ${SDK_PROBE}'s permission mode to ${PERMISSION_MODE_LABELS[mode]} after a restart`,
  }
  record(event).catch((error) =>
    console.error(
      `${SDK_PROBE}: could not record its mode reset:`,
      error instanceof Error ? error.message : error,
    ),
  )
}

// Whether the dashboard hosts this session itself, so its messages and answers go through here rather than cmux.
export const hosts = (sessionId: string, host: SdkHost = sdkHost): boolean =>
  host.sessionId !== null && host.sessionId === sessionId

export type SendDeps = {
  delivered: (id: string) => Promise<Date | null>
  host: SdkHost
  now: () => Date
  record: (event: ActivityEvent, sending: () => Promise<void>) => Promise<void>
}

const sendDeps: SendDeps = {
  delivered: deliverDeps.delivered,
  host: sdkHost,
  now: () => new Date(),
  record: deliverDeps.record,
}

// The composer's message to the hosted session, judged by the same rules as a typed one (no command, nothing empty or too long, nothing while a card waits) and recorded the same way, its size and never its words, under the composer's id so a retry sends nothing twice. Nothing reads the session's screen: the message joins its input stream, and a session busy with a turn takes it after (from the session's own queue, which goes if the API stops first).
export async function sendToHosted(
  delivery: Delivery,
  deps: SendDeps = sendDeps,
): Promise<DeliveryResult> {
  const sessionId = deps.host.sessionId
  if (delivery.to !== SDK_PROBE || !sessionId) {
    return {
      code: "NOT_FOUND",
      ok: false,
      reason: `The dashboard hosts no session named ${delivery.to}.`,
    }
  }
  const attachments = delivery.attachments ?? []
  const words = normalize(delivery.text)
  const refused = refusal(words, attachments.length)
  if (refused) return refused
  const at = delivery.id ? await deps.delivered(delivery.id) : null
  if (at) return { at: at.toISOString(), ok: true, sessionId }
  if (deps.host.waiting()) {
    return {
      code: "ON_PICKER",
      ok: false,
      reason: `${SDK_PROBE} is waiting on a card. Answer that first: the message goes once it is answered.`,
    }
  }
  const event: ActivityEvent = {
    action: "dashboard.message",
    actor: delivery.actor,
    id: delivery.id,
    summary: dashboardMessageSummary(
      SDK_PROBE,
      words,
      attachments.map((file) => file.size),
    ),
  }
  await deps.record(event, async () => deps.host.send(withAttachments(words, attachments)))
  return { at: deps.now().toISOString(), ok: true, sessionId }
}

const GONE = new Error("the prompt stopped waiting")

export type AnswerHostedDeps = Pick<typeof answerDeps, "approvals" | "now" | "record"> & {
  host: SdkHost
}

const answerHostedDeps: AnswerHostedDeps = {
  approvals: answerDeps.approvals,
  host: sdkHost,
  now: answerDeps.now,
  record: answerDeps.record,
}

// A card's answer to a prompt the hosted session waits on, judged as a Feed answer is: canApprove() decides who may answer, permission and plan answers go only while PLAYGROUND_APPROVALS_ENABLED is on, and replyFor() checks the answer fits. The activity row and the answer commit together; the callback hands it straight to the session, so there is nothing to read back.
export async function answerHosted(
  { actor, answer, approver, requestId }: FeedAnswering,
  deps: AnswerHostedDeps = answerHostedDeps,
): Promise<FeedResult> {
  const refused = (code: Extract<FeedResult, { ok: false }>["code"], reason: string) =>
    ({ code, ok: false, reason }) as const
  if (!canApprove(approver)) return refused("FORBIDDEN", "Only the owner answers prompts.")
  if (answer.kind !== "question" && !deps.approvals) {
    return refused("DISABLED", "Answering permission and plan prompts here is off for now.")
  }
  const waiting = deps.host.pendingItem(requestId)
  if (!waiting)
    return refused(
      "NOT_PENDING",
      `No such prompt waits on ${SDK_PROBE}: it may be answered already.`,
    )
  const built = replyFor(waiting.item, answer)
  if ("ok" in built) return built
  const event: ActivityEvent = {
    action: "dashboard.answer",
    actor,
    summary: answerSummary(SDK_PROBE, waiting.item, answer),
  }
  try {
    await deps.record(event, async () => {
      if (!deps.host.settle(requestId, resultOf(waiting.item, waiting.input, built))) throw GONE
    })
  } catch (error) {
    if (error !== GONE) throw error
    return refused(
      "NOT_PENDING",
      `That prompt stopped waiting on ${SDK_PROBE} (it timed out or was cancelled).`,
    )
  }
  return { at: deps.now().toISOString(), ok: true }
}

export type ModeChanging = {
  actor: ActivityActor
  approver: Parameters<typeof canApprove>[0]
  mode: HostedMode
  sessionId: string
}

export type ModeResult =
  | { at: string; mode: HostedMode; ok: true }
  | { code: "DISABLED" | "FORBIDDEN" | "NOT_FOUND"; ok: false; reason: string }

// The owner's pick in the composer's mode picker, judged as a permission answer is, since a mode approves the session's later actions (bypassPermissions all of them): canApprove() decides who may, and it goes only while PLAYGROUND_APPROVALS_ENABLED is on. The activity row names the old and the new mode and commits only once the session has taken the new one; a mode it refuses throws, and nothing is recorded.
export async function changeHostedMode(
  { actor, approver, mode, sessionId }: ModeChanging,
  deps: AnswerHostedDeps = answerHostedDeps,
): Promise<ModeResult> {
  const refused = (code: Extract<ModeResult, { ok: false }>["code"], reason: string) =>
    ({ code, ok: false, reason }) as const
  if (!canApprove(approver)) return refused("FORBIDDEN", "Only the owner changes the mode.")
  if (!deps.approvals) return refused("DISABLED", "Changing the mode here is off for now.")
  if (!hosts(sessionId, deps.host)) {
    return refused("NOT_FOUND", "The dashboard hosts no running session with that id.")
  }
  const event: ActivityEvent = {
    action: "dashboard.mode",
    actor,
    summary: `Changed ${SDK_PROBE}'s permission mode from ${PERMISSION_MODE_LABELS[deps.host.currentMode()]} to ${PERMISSION_MODE_LABELS[mode]}`,
  }
  await deps.record(event, () => deps.host.setMode(mode))
  return { at: deps.now().toISOString(), mode, ok: true }
}
