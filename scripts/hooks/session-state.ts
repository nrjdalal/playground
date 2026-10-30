// Notification, PermissionDenied, PermissionRequest, PostToolUse, PostToolUseFailure, SessionEnd, Stop, StopFailure and UserPromptSubmit hook: writes the session's state to the file ops-session-resume reads and the Dashboard is to read, the data folder's session-state/<session id>.json, in the shape packages/config/src/session-state.ts checks, and inside herdr reports it as herdr's own state, handing the pane back when the session ends. A stuck or failed record also queues one alert to the session's manager (packages/scripts/src/stuck-alert.ts). Every session writes it, the owner's own included, since the Dashboard is to show them all. It never blocks: whatever fails, the hook exits 0.
import { open } from "node:fs/promises"
import { join } from "node:path"

import type { SessionState } from "../../packages/config/src/session-state"
import { dataDir } from "../../packages/env/src/data-dir"
import { alertFor } from "../../packages/scripts/src/stuck-alert"
import { writeAtomic } from "../../packages/scripts/src/write-atomic"
import { loadNames } from "./role"

type Environment = Record<string, string | undefined>
type Input = Record<string, unknown>

// zod cannot load here (bun keeps it in the packages that depend on it), so the folder is spelled out and a test holds it to sessionStateDir.
export const statePath = (environment: Environment, sessionId: string): string =>
  join(dataDir(environment), "session-state", `${sessionId}.json`)

const PROMPTS: Record<string, string> = { AskUserQuestion: "question", ExitPlanMode: "plan" }
const NOTICES: Record<string, Pick<SessionState, "reason" | "state">> = {
  elicitation_dialog: { reason: "elicitation", state: "stuck" },
  idle_prompt: { state: "idle" },
  permission_prompt: { reason: "permission", state: "stuck" },
}
const USAGE_LIMIT = /usage limit reached|hit your [\w -]*limit|limit will reset/i
// GLM prints its reset in UTC+8 (16 Oct: "reset at 2026-10-16 19:00:02" still printed at 10:09Z, on a 5-hour window).
const GLM_RESET = /limit will reset at (\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)/
const TAIL_BYTES = 256 * 1024
// The events that end a tool call: it ran, it failed once it ran, or its permission was denied.
const TOOL_ENDS = new Set(["PermissionDenied", "PostToolUse", "PostToolUseFailure"])

const text = (value: unknown): string => (typeof value === "string" ? value : "")

// Claude's own limit line in the transcript carries the reset as epoch seconds, on quotaLimits or apiErrorParams.rate_limit_info.
async function transcriptReset(path: string): Promise<string | undefined> {
  const file = await open(path, "r").catch(() => null)
  if (!file) return undefined
  try {
    const { size } = await file.stat()
    const start = Math.max(0, size - TAIL_BYTES)
    const { buffer, bytesRead } = await file.read(
      Buffer.alloc(size - start),
      0,
      size - start,
      start,
    )
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n").reverse()
    for (const line of lines) {
      if (!line.includes('"isApiErrorMessage":true')) continue
      try {
        const entry = JSON.parse(line) as {
          apiErrorParams?: { rate_limit_info?: { resetsAt?: unknown } }
          quotaLimits?: { resetsAt?: unknown }
        }
        const at = entry.quotaLimits?.resetsAt ?? entry.apiErrorParams?.rate_limit_info?.resetsAt
        if (typeof at === "number") return new Date(at * 1000).toISOString()
      } catch {}
      return undefined
    }
  } finally {
    await file.close()
  }
}

async function resetOf(input: Input): Promise<string | undefined> {
  const glm = GLM_RESET.exec(text(input.last_assistant_message))
  if (glm) {
    const at = Date.parse(`${glm[1]}T${glm[2]}+08:00`)
    return Number.isNaN(at) ? undefined : new Date(at).toISOString()
  }
  return transcriptReset(text(input.transcript_path))
}

async function failureOf(
  input: Input,
): Promise<Pick<SessionState, "reason" | "resetsAt" | "state">> {
  const error = text(input.error) || "unknown"
  if (error === "authentication_failed") return { reason: "login", state: "stuck" }
  if (error === "rate_limit" && USAGE_LIMIT.test(text(input.last_assistant_message))) {
    const resetsAt = await resetOf(input)
    return { reason: error, ...(resetsAt ? { resetsAt } : {}), state: "usage-limit" }
  }
  return { reason: error, state: "failed" }
}

// The record an event writes, or null for one that says nothing about the session's state.
export async function recordOf(input: Input, now = new Date()): Promise<SessionState | null> {
  const sessionId = text(input.session_id)
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return null
  const event = text(input.hook_event_name)
  const head = { at: now.toISOString(), event, sessionId }
  const agentId = text(input.agent_id)
  const agent = agentId ? { agentId } : {}
  switch (event) {
    case "UserPromptSubmit":
      return { ...head, state: "working" }
    case "PermissionDenied":
    case "PostToolUse":
    case "PostToolUseFailure": {
      const tool = text(input.tool_name)
      return { ...head, ...agent, state: "working", ...(tool ? { tool } : {}) }
    }
    case "Stop":
      return { ...head, state: "idle" }
    case "PermissionRequest": {
      const tool = text(input.tool_name)
      return {
        ...head,
        ...agent,
        reason: PROMPTS[tool] ?? "permission",
        state: "stuck",
        ...(tool ? { tool } : {}),
      }
    }
    case "Notification": {
      const notice = NOTICES[text(input.notification_type)]
      return notice ? { ...head, ...agent, ...notice } : null
    }
    case "StopFailure":
      return { ...head, ...(await failureOf(input)) }
    default:
      return null
  }
}

const HERDR_STATE: Record<SessionState["state"], string> = {
  failed: "blocked",
  idle: "idle",
  stuck: "blocked",
  "usage-limit": "blocked",
  working: "working",
}

// herdr's documented route for a custom reporter (Add Herdr support § Report state): a source of our own and a seq that only rises, or herdr drops the report. The agent is claude, the kind the pane runs, though the docs ask a reporter for its own name: a reporter's agent outranks the process herdr detects, and agent.prompt types only into a kind it knows, so a name of our own left every session unpromptable (agent_not_ready). With no record the session has ended, and release-agent hands the pane back to herdr's own detection of claude, which keeps reading it while claude runs and clears it once claude exits, so a pane that outlives claude never keeps our last report.
export function herdrArgs(
  record: SessionState | null,
  environment: Environment,
  seq: number,
): string[] | null {
  const { HERDR_BIN_PATH: bin, HERDR_ENV: inside, HERDR_PANE_ID: pane } = environment
  if (inside !== "1" || !bin || !pane) return null
  const source = ["--source", "custom:playground", "--agent", "claude"]
  return record
    ? [
        bin,
        "pane",
        "report-agent",
        pane,
        ...source,
        "--state",
        HERDR_STATE[record.state],
        "--seq",
        String(seq),
      ]
    : [bin, "pane", "release-agent", pane, ...source, "--seq", String(seq)]
}

// A detached child sends the report with a 2s timeout, so herdr never holds the session up.
function report(args: string[] | null): void {
  if (args)
    Bun.spawn([process.execPath, import.meta.path, "--report", ...args], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    }).unref()
}

// Microseconds of the wall clock, which every hook process shares, so two reports in one millisecond still rise.
const seqNow = (): number => Math.floor((performance.timeOrigin + performance.now()) * 1000)

const HELD = new Set<string>(["failed", "stuck", "usage-limit"])

// Pure: whether a record replaces the one the session's file holds. A tool that ran, failed once it ran, or was denied ends the prompt it waited on, one asked by the same agent about the same tool (PermissionRequest carries no tool_use_id, and a picker's PostToolUse input adds the answers), and a main-agent tool after a Stop or a StopFailure means the turn went on (a Stop hook continued it: the inbox gate, the ticket skill's keep-going; or a line the session was sent), so it reads working again, while a login stays stuck until a prompt; a subagent's tool after a Stop is a background run, the session itself still idle. Otherwise it writes nothing, so the hook that runs after every tool stays one file read, and one write per continued turn. A notice only restates what an event already wrote: the permission notice lands about 6s after the PermissionRequest that names the prompt's tool, so after that prompt's tool has run too, and the idle notice 60s after a turn ends, a turn on a usage limit included. So a notice never replaces a record that says why the session waits, and the permission notice never replaces the record of the tool that ran.
export function replaces(record: SessionState, held: Partial<SessionState> | null): boolean {
  if (TOOL_ENDS.has(record.event))
    return (
      (!record.agentId &&
        (held?.state === "idle" || held?.state === "failed" || held?.state === "usage-limit")) ||
      (held?.state === "stuck" &&
        held.reason !== "login" &&
        held.agentId === record.agentId &&
        (!held.tool || held.tool === record.tool))
    )
  if (record.event === "Notification")
    return (
      !(held?.state && HELD.has(held.state)) &&
      !(record.reason === "permission" && TOOL_ENDS.has(held?.event ?? ""))
    )
  return true
}

export async function run(
  raw: string,
  environment: Environment = process.env,
  now = new Date(),
): Promise<void> {
  try {
    const input = JSON.parse(raw) as Input
    if (input.hook_event_name === "SessionEnd")
      return report(herdrArgs(null, environment, seqNow()))
    const record = await recordOf(input, now)
    if (!record) return
    const path = statePath(environment, record.sessionId)
    if (record.event === "Notification" || TOOL_ENDS.has(record.event)) {
      const held = (await Bun.file(path)
        .json()
        .catch(() => null)) as Partial<SessionState> | null
      if (!replaces(record, held)) return
    }
    await writeAtomic(path, `${JSON.stringify(record)}\n`)
    report(herdrArgs(record, environment, seqNow()))
    if (record.state === "stuck" || record.state === "failed") {
      await loadNames(environment)
      await alertFor(input, record, environment, now)
    }
  } catch {}
}

if (import.meta.main) {
  if (process.argv[2] === "--report") {
    const [bin = "", ...rest] = process.argv.slice(3)
    const child = Bun.spawn([bin, ...rest], { stderr: "ignore", stdout: "ignore", timeout: 2000 })
    await child.exited
  } else await run(await Bun.stdin.text())
}
