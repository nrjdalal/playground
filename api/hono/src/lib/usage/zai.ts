import { join } from "node:path"

import { z } from "zod"

import { dataDir } from "@/lib/sessions/paths"

// The Z.ai GLM plan's credit windows, written by the ops-zai-usage job (packages/scripts/src/ops-zai-usage) every 5 minutes, temp file then rename. The endpoint is undocumented and can change without notice, so the file is checked here and one that fails its shape is no usage. The dashboard only reads it.
export const zaiPath = (): string => join(dataDir(), "zai-usage.json")

// The job runs every 5 minutes, so a file this old means it has stopped and its numbers are stale.
export const ZAI_STALE_MS = 10 * 60 * 1000

const windowSchema = z.object({
  cap: z.number().positive(),
  resetsAt: z.string().nullable(),
  used: z.number().nonnegative(),
})

const usageSchema = z.object({
  balance: z.object({ empty: z.literal(true), seenAt: z.string() }).optional(),
  windows: z.object({
    fiveHour: windowSchema.nullable(),
    week: windowSchema.nullable(),
  }),
  writtenAt: z.string(),
})

export type ZaiWindow = z.infer<typeof windowSchema>

export type ZaiUsage = {
  fiveHour: ZaiWindow | null
  stale: boolean
  week: ZaiWindow | null
  writtenAt: string
}

// A window spent to its cap, as an empty balance reads.
const spent = (window: ZaiWindow | null): ZaiWindow | null =>
  window && { ...window, used: window.cap }

// Pure: the file's text as the two credit windows, both spent while the job marks the balance empty, or null when it holds neither, no time it was written, a failed read (its error), or a shape the job does not write.
export function zaiUsageOf(text: string, now: Date): ZaiUsage | null {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return null
  }
  if (file && typeof file === "object" && "error" in file) return null
  const parsed = usageSchema.safeParse(file)
  if (!parsed.success) return null
  const empty = parsed.data.balance !== undefined
  const fiveHour = empty ? spent(parsed.data.windows.fiveHour) : parsed.data.windows.fiveHour
  const week = empty ? spent(parsed.data.windows.week) : parsed.data.windows.week
  const { writtenAt } = parsed.data
  const written = Date.parse(writtenAt)
  if (Number.isNaN(written) || (!fiveHour && !week)) return null
  return {
    fiveHour,
    stale: now.getTime() - written > ZAI_STALE_MS,
    week,
    writtenAt: new Date(written).toISOString(),
  }
}

// The report's problem line for a file the job stopped writing; a missing file is no problem, since a machine with no GLM plan has none.
export const zaiProblem = (zai: ZaiUsage | null): string | null =>
  zai?.stale ? `The GLM credit windows are stale: last written ${zai.writtenAt}` : null

const failureSchema = z.object({ error: z.string(), errorAt: z.string() })

// Pure: the report's problem line for a read the job wrote as failed (its error and errorAt), or null; zaiUsageOf reads that file as no usage, so this line is the one trace of it.
export function zaiFailureOf(text: string): string | null {
  try {
    const parsed = failureSchema.safeParse(JSON.parse(text))
    return parsed.success
      ? `The GLM usage read failed at ${parsed.data.errorAt}: ${parsed.data.error}`
      : null
  } catch {
    return null
  }
}

// The file's failed read as zaiFailureOf names it; a missing or unreadable file is none.
export async function readZaiFailure(path = zaiPath()): Promise<string | null> {
  try {
    return zaiFailureOf(await Bun.file(path).text())
  } catch {
    return null
  }
}

// The file as zaiUsageOf reads it; a missing or unreadable one is no usage.
export async function readZaiUsage(path = zaiPath(), now = new Date()): Promise<ZaiUsage | null> {
  try {
    return zaiUsageOf(await Bun.file(path).text(), now)
  } catch {
    return null
  }
}
