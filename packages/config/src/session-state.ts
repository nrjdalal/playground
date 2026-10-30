import { z } from "zod"

// A session's state as its own Claude Code hooks last saw it: scripts/hooks/session-state.ts writes one file per session on Notification, PermissionDenied, PermissionRequest, PostToolUse, PostToolUseFailure, Stop, StopFailure and UserPromptSubmit, which ops-session-resume reads and the Dashboard is to read. The hook cannot import zod, so it writes this shape through its type alone and the tests hold the two together.

export const SESSION_STATES = ["failed", "idle", "stuck", "usage-limit", "working"] as const

export type SessionStateName = (typeof SESSION_STATES)[number]

// agentId: the subagent whose prompt it is, when a subagent asked. reason: why a session is stuck (permission, question, plan, elicitation, login) or failed (StopFailure's error). resetsAt: when a usage limit lifts, when the hook could read it. tool: the tool a permission prompt asks about.
export const sessionStateSchema = z.object({
  agentId: z.string().min(1).optional(),
  at: z.iso.datetime(),
  event: z.string().min(1),
  reason: z.string().min(1).optional(),
  resetsAt: z.iso.datetime().optional(),
  sessionId: z.string().min(1),
  state: z.enum(SESSION_STATES),
  tool: z.string().min(1).optional(),
})

export type SessionState = z.infer<typeof sessionStateSchema>

// The folder in the data folder (dataDirOf in @packages/env, which this package cannot import) that holds one <session id>.json per session.
export const sessionStateDir = (dataDir: string): string =>
  `${dataDir.replace(/\/+$/, "")}/session-state`

// Pure: the file's text in, its record out, or null when it does not read.
export function parseSessionState(raw: string): SessionState | null {
  try {
    const parsed = sessionStateSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// Pure: the state a record still speaks for. Working and idle stand until the next hook. Any other state stands only until the session's transcript holds a user or assistant entry stamped after it, since an Escape on a prompt fires no hook (measured on 2.1.302): then the record says nothing and the reader goes by its own reading.
export function stateNow(
  record: SessionState,
  newestTurnAt: string | null | undefined,
): SessionStateName | null {
  if (record.state === "idle" || record.state === "working") return record.state
  if (!newestTurnAt) return record.state
  return Date.parse(newestTurnAt) > Date.parse(record.at) ? null : record.state
}
