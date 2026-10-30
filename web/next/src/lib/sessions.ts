import type { EntryKind, SessionKind } from "@api/hono"
import { folderName } from "@packages/config/console"
import type { InferResponseType } from "hono/client"

import { agentLabel } from "@/lib/agent-label"
import { apiClient, unwrap } from "@/lib/api/client"
import { LIGHT_LABELS } from "@/lib/dashboard"
import { fullTime } from "@/lib/time"

export type SessionSummary = InferResponseType<
  typeof apiClient.v1.sessions.$get
>["data"]["sessions"][number]

export type SessionDetail = InferResponseType<(typeof apiClient.v1.sessions)[":id"]["$get"]>["data"]

export type LogEntry = InferResponseType<
  (typeof apiClient.v1.sessions)[":id"]["entries"]["$get"]
>["data"]["entries"][number]

// Keyed by the API's own kind type, so a kind added there fails to compile here until it has a label, and the Kind filter lists every kind the labels do.
export const KIND_LABELS: Record<SessionKind, string> = {
  fork: "Fork",
  headless: "Headless",
  interactive: "Interactive",
  subagent: "Subagent",
}

export const SESSION_KINDS = Object.keys(KIND_LABELS) as SessionKind[]

// What the log shows by default: what was asked, what was said and what was done. The rest (tool output, thinking, hook and system lines, bookkeeping) is one switch away.
export const STEP_KINDS = [
  "assistant",
  "human",
  "peer",
  "prompt",
  "tool",
] as const satisfies readonly EntryKind[]

export const ENTRY_PAGE = 200

// Where Sessions is reached: the user menu, for the owner rung its pages and API require.
export const sessionsMenuLinks = (allowed: boolean) =>
  allowed ? [{ href: "/dashboard/sessions", label: "Sessions" }] : []

// A session as people read it: its name, else the title Claude Code gave it, else what a subagent was sent to do or its type, else the folder it ran in, else its id's first eight characters.
export const sessionLabel = (session: {
  agentType?: string | null
  aiTitle: string | null
  cwd: string | null
  description?: string | null
  id: string
  name: string | null
}): string => {
  if (session.name) return agentLabel(session.name)
  const folder = folderName(session.cwd)
  return (
    session.aiTitle ||
    session.description ||
    session.agentType ||
    (folder ? agentLabel(folder) : `Session ${session.id.slice(0, 8)}`)
  )
}

export const kindLabel = (kind: string | null): string =>
  kind && kind in KIND_LABELS ? KIND_LABELS[kind as keyof typeof KIND_LABELS] : "Unknown"

// Whether a session runs now, in the dashboard's words: a subagent's (null) the registry cannot tell.
export const statusLabel = (session: { live: boolean | null; status: string | null }): string =>
  session.live === null
    ? "-"
    : !session.live
      ? "Ended"
      : session.status === "busy"
        ? LIGHT_LABELS.working
        : session.status === "idle"
          ? LIGHT_LABELS.idle
          : "Live"

type SessionStart = SessionDetail["start"]

type ChainSession = NonNullable<SessionDetail["chain"]>["sessions"][number]

// How a session began: only a /clear or a handover note carries on from the session before it; a fresh start under a reused name is listed beside it, not linked to it.
export const startLabel = (start: SessionStart): string =>
  start.kind === "clear"
    ? "Continues after /clear"
    : start.kind === "handover"
      ? `Continues from ${start.note}`
      : "Fresh start"

export const RELATION_LABELS: Record<ChainSession["relation"], string> = {
  after: "After",
  alongside: "Ran alongside",
  before: "Before",
}

// A chain row's link name: the relation and the start that tells its row apart, since every session in a chain shares one name.
export const chainLinkName = (
  relation: ChainSession["relation"],
  startedAt: string | null,
): string =>
  startedAt ? `${RELATION_LABELS[relation]} · ${fullTime(startedAt)}` : RELATION_LABELS[relation]

// The Sessions list holding every session of one name, which a chain links to when it lists only the nearest.
export const sessionsNamed = (name: string): string =>
  `/dashboard/sessions?session=${encodeURIComponent(name)}`

export const formatCost = (usd: number | null): string =>
  usd === null ? "-" : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`

const COMPACT = new Intl.NumberFormat("en", { maximumFractionDigits: 1, notation: "compact" })

export const formatCount = (value: number): string => COMPACT.format(value)

// A tool step's first line is its one-line summary; the input it ran with follows on the next.
export const firstLine = (text: string): string => text.split("\n", 1)[0] ?? ""

export async function fetchSession(id: string) {
  const { data, error } = await unwrap(apiClient.v1.sessions[":id"].$get({ param: { id } }))
  if (error) throw new Error(error.message)
  return data
}

export async function fetchEntries(id: string, before: number | null, everything: boolean) {
  const { data, error } = await unwrap(
    apiClient.v1.sessions[":id"].entries.$get({
      param: { id },
      query: {
        before: before === null ? undefined : `${before}`,
        kind: everything ? undefined : STEP_KINDS.join(","),
        limit: `${ENTRY_PAGE}`,
      },
    }),
  )
  if (error) throw new Error(error.message)
  return data
}
