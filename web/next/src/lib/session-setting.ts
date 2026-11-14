import type { Worker } from "@api/hono"
import { SESSION_EFFORTS, SESSION_MODELS } from "@packages/config/console"

import { apiClient, unwrap } from "@/lib/api/client"
import { MODEL_FAMILIES } from "@/lib/model-label"

export type SessionModel = (typeof SESSION_MODELS)[number]
export type SessionEffort = (typeof SESSION_EFFORTS)[number]
export type SessionSetting = { model: SessionModel } | { effort: SessionEffort }

// Each model by its family's word, as the session's row names it.
export const MODEL_LABELS = Object.fromEntries(
  SESSION_MODELS.map((alias) => [alias, MODEL_FAMILIES[alias] ?? alias]),
) as Record<SessionModel, string>

// In the order Claude Code's /effort takes them, least to most.
export const EFFORT_LABELS: Record<SessionEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

export const isModel = (value: unknown): value is SessionModel =>
  SESSION_MODELS.some((alias) => alias === value)

export const isEffort = (value: unknown): value is SessionEffort =>
  SESSION_EFFORTS.some((level) => level === value)

// Pure: the alias a model id runs as (claude-opus-5-5 is opus), or null for one none of the aliases names, such as another provider's.
export const modelAlias = (model: string | null): SessionModel | null =>
  SESSION_MODELS.find((alias) => model?.split(/[-/.]/).includes(alias)) ?? null

// Pure: the model and effort the session's row reports, each null when its newest reply named none the pickers know.
export const reportedSetting = (
  worker: Pick<Worker, "effort" | "model">,
): { effort: SessionEffort | null; model: SessionModel | null } => ({
  effort: isEffort(worker.effort) ? worker.effort : null,
  model: modelAlias(worker.model),
})

// A pick not yet on the session's row: the value picked, and the value the row showed when it was picked; a dispatcher's row takes a new model or effort only from its next reply, while the hosted session's shows it at once.
export type Pending<T> = { from: T | null; to: T }

// Pure: the value a picker shows: a pick from the moment it is made until the row reports a value other than the one it was picked over.
export const shownValue = <T>(pending: Pending<T> | null, reported: T | null): T | null =>
  pending && reported === pending.from ? pending.to : reported

// Pure: whether the API's refusal is a dispatcher holding an effort pick (QUEUED, as while it compacts), which Claude Code runs once free, so the pick stays shown rather than failing.
export const heldPick = (error: object | null): boolean =>
  error !== null && "delivery" in error && error.delivery === "QUEUED"

// Sets a dispatcher's, the assistant's or the hosted session's model or effort through the API, which sets it on the session and records it in the console's activity; the pick's own id lets a dispatcher that holds an effort pick while it compacts read QUEUED.
export async function changeSetting(sessionId: string, setting: SessionSetting) {
  return unwrap(
    apiClient.v1.workers[":sessionId"].setting.$post({
      json: { ...setting, id: crypto.randomUUID() },
      param: { sessionId },
    }),
  )
}
