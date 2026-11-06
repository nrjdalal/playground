import type { Schedule } from "@packages/config/schedule"

import { apiClient, unwrap } from "@/lib/api/client"

export const JOBS_QUERY_KEY = ["settings", "jobs"] as const

const PREFIX = "jobs."

type Listed = {
  keys: { default: unknown; key: string }[]
  rows: { key: string; scope: string; value: unknown }[]
  values: Record<string, unknown>
}

type JobValue = { description?: string; enabled?: boolean; schedule?: Schedule }

export type JobRow = {
  description: string
  enabled: boolean
  key: string
  name: string
  // the row your login's scope holds for the job, which a toggle keeps all but its enabled field of
  row: Record<string, unknown> | undefined
  schedule: Schedule | undefined
  set: boolean
}

// jobs.opsMergeTrain reads as ops-merge-train, the job's own name.
const nameOf = (key: string) =>
  key.slice(PREFIX.length).replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`)

// Pure: each registry job from GET /api/v1/settings, A to Z by name: what it does, when it runs and whether it is on, as your login reads it, and whether a setting sets it rather than its default.
export const jobRows = (listed: Listed, scope: string): JobRow[] =>
  listed.keys
    .filter(({ key }) => key.startsWith(PREFIX))
    .map(({ default: fallback, key }) => {
      const set = key in listed.values
      const job = (set ? listed.values[key] : fallback) as JobValue
      const row = listed.rows.find((each) => each.key === key && each.scope === scope)?.value
      return {
        description: job.description ?? "",
        enabled: job.enabled === true,
        key,
        name: nameOf(key),
        row: row as Record<string, unknown> | undefined,
        schedule: job.schedule,
        set,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

// Pure: what PUT /api/v1/settings/:key takes to turn a job on or off at your login's scope: its enabled field over the row your scope holds, never the registry's fields, so the rest still follow the registry.
export const jobToggleWrite = (job: JobRow, enabled: boolean, scope: string) => ({
  json: {
    by: "Settings",
    reason: `Turned ${job.name} ${enabled ? "on" : "off"} in Settings > Jobs`,
    scope,
    value: { ...job.row, enabled },
  },
  param: { key: job.key },
})

export const readJobs = async (scope: string): Promise<JobRow[]> => {
  const { data, error } = await unwrap(apiClient.v1.settings.$get())
  if (error) throw new Error(error.message)
  return jobRows(data, scope)
}

export const saveJobToggle = async (job: JobRow, enabled: boolean, scope: string) => {
  const { error } = await unwrap(
    apiClient.v1.settings[":key"].$put(jobToggleWrite(job, enabled, scope)),
  )
  if (error) throw new Error(error.message)
}
