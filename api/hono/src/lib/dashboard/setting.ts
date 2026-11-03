import { SESSION_EFFORTS, SESSION_MODELS } from "@packages/config/console"
import { dashboardSettingSummary } from "@packages/db"
import { z } from "zod"

// One model or one effort, each from its fixed list; nothing else rides along, so no request's words reach a session as a command.
export const settingSchema = z.union([
  z.strictObject({ model: z.enum(SESSION_MODELS) }),
  z.strictObject({ effort: z.enum(SESSION_EFFORTS) }),
])

export type SessionSetting = z.infer<typeof settingSchema>
export type SessionEffort = (typeof SESSION_EFFORTS)[number]

// Pure: the one slash command a setting types, built from the lists alone.
export const settingCommand = (setting: SessionSetting): string =>
  "model" in setting ? `/model ${setting.model}` : `/effort ${setting.effort}`

// Pure: the setting's dashboard.setting row.
export const settingSummary = (to: string, setting: SessionSetting): string =>
  "model" in setting
    ? dashboardSettingSummary(to, "model", setting.model)
    : dashboardSettingSummary(to, "effort", setting.effort)
