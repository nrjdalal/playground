import type { InferResponseType } from "hono/client"

import { apiClient } from "@/lib/api/client"
import { config } from "@/lib/config"
import { refusalOf } from "@/lib/onboard"
import { EFFORT_LABELS, isEffort } from "@/lib/session-setting"

export type TemplateRow = InferResponseType<
  (typeof apiClient.v1.sessions.templates)["$get"],
  200
>["data"][number]

export const TEMPLATES_QUERY_KEY = ["session-templates"] as const

const TEMPLATES_URL = `${config.api.url}/api/v1/sessions/templates`

export async function readTemplates(): Promise<TemplateRow[]> {
  const response = await fetch(TEMPLATES_URL, { credentials: "include" })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(refusalOf(body, response.status))
  return (body as { data: TemplateRow[] }).data
}

// Starts a template's session, or throws the API's words whole: spawn.sh's last line on a refusal.
export async function startTemplate(id: string): Promise<string> {
  const response = await fetch(`${TEMPLATES_URL}/${encodeURIComponent(id)}/start`, {
    credentials: "include",
    method: "POST",
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(refusalOf(body, response.status))
  return (body as { data: { name: string } }).data.name
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
