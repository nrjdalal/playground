import type { InferResponseType } from "hono/client"

import { apiClient, unwrap } from "@/lib/api/client"
import { EFFORT_LABELS, isEffort } from "@/lib/session-setting"

export type TemplateRow = InferResponseType<
  (typeof apiClient.v1.sessions.templates)["$get"],
  200
>["data"][number]

export const TEMPLATES_QUERY_KEY = ["session-templates"] as const

export async function readTemplates(): Promise<TemplateRow[]> {
  const { data, error } = await unwrap(apiClient.v1.sessions.templates.$get())
  if (error) throw new Error(error.message)
  return data
}

// Starts a template's session, or throws the API's words whole: spawn.sh's last line on a refusal.
export async function startTemplate(id: string): Promise<string> {
  const { data, error } = await unwrap(
    apiClient.v1.sessions.templates[":id"].start.$post({ param: { id } }),
  )
  if (error) throw new Error(error.message)
  return data.name
}

// Pure: a picker row as drawn: its label, then its backend or model and effort, muted, and the reason it is disabled, the API's (no second account, no brief), else a dispatcher template's while the second dispatcher already runs; null when it can start.
export const templateRowView = (
  row: TemplateRow,
  secondRunning: boolean,
): { detail: string; label: string; reason: string | null } => ({
  detail: [
    row.backend === "glm" ? "GLM" : (row.model ?? "Claude"),
    row.effort && isEffort(row.effort) ? EFFORT_LABELS[row.effort] : null,
  ]
    .filter(Boolean)
    .join(" · "),
  label: row.label,
  reason:
    row.refusal ??
    (row.kind === "dispatcher" && secondRunning ? "The second dispatcher is running" : null),
})
