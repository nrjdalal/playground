import type { z } from "zod"

// The per-entry reading the dashboard's file readers share: a file a script outside the repo writes is read one entry at a time, so one bad entry costs only itself.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const issuesOf = (error: z.ZodError, at: (string | number)[]): string =>
  error.issues.map((issue) => `${[...at, ...issue.path].join(".")}: ${issue.message}`).join("; ")

const optionalKeys = (schema: z.ZodObject): Set<string> =>
  new Set(
    Object.entries(schema.shape)
      .filter(([, field]) => (field as z.ZodType).safeParse(undefined).success)
      .map(([key]) => key),
  )

// Each entry checked on its own, as roster.ts checks each agent: one whose only faults are in keys it can do without keeps its row without them, one with a bad required key is dropped, and so is one whose key (when keyOf gives one) is listed already; each is named in problems.
export function entries<T>(
  schema: z.ZodObject,
  raw: unknown,
  at: (string | number)[],
  problems: string[],
  keyOf: ((row: T) => string) | null = null,
  seen = new Set<string>(),
): T[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    problems.push(`${at.join(".")}: not a list (ignored)`)
    return []
  }
  const optional = optionalKeys(schema)
  const kept: T[] = []
  for (const [i, value] of raw.entries()) {
    let parsed = schema.safeParse(value)
    const faults = parsed.success ? [] : parsed.error.issues.map((issue) => String(issue.path[0]))
    if (!parsed.success && isRecord(value) && faults.every((key) => optional.has(key))) {
      problems.push(`${issuesOf(parsed.error, [...at, i])} (ignored)`)
      parsed = schema.safeParse(
        Object.fromEntries(Object.entries(value).filter(([key]) => !faults.includes(key))),
      )
    }
    if (!parsed.success) {
      problems.push(issuesOf(parsed.error, [...at, i]))
      continue
    }
    const row = parsed.data as T
    const key = keyOf?.(row)
    if (key !== undefined && seen.has(key)) {
      problems.push(`${[...at, i].join(".")}: ${key} is listed twice`)
      continue
    }
    if (key !== undefined) seen.add(key)
    kept.push(row)
  }
  return kept
}
