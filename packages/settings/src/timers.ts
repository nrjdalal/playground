import { z } from "zod"

// By relative path, as settings.ts imports, since tests outside the package import this file.
import { defineSettings } from "./settings"

const fieldOf = (field: string, min: number, max: number): Set<number> | null => {
  const values = new Set<number>()
  for (const part of field.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const from = m[1] === "*" ? min : Number(m[2])
    const to = m[1] === "*" ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : from
    const step = m[4] ? Number(m[4]) : 1
    if (from < min || to > max || from > to || step < 1) return null
    for (let n = from; n <= to; n += step) values.add(n)
  }
  return values
}

// Whether a 5-field cron names this minute, read in machine wall time, as CronCreate read the old crons; day of month and day of week must both match, where standard cron takes either.
export function cronMatches(cron: string, at: Date): boolean {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`not a 5-field cron: ${cron}`)
  const sets = fields.map((field, i) =>
    fieldOf(field, [0, 0, 1, 1, 0][i]!, [59, 23, 31, 12, 6][i]!),
  )
  if (sets.some((set) => set === null)) throw new Error(`unreadable cron: ${cron}`)
  const now = [at.getMinutes(), at.getHours(), at.getDate(), at.getMonth() + 1, at.getDay()]
  return sets.every((set, i) => set!.has(now[i]!))
}

const readable = (cron: string) => {
  try {
    cronMatches(cron, new Date(0))
    return true
  } catch {
    return false
  }
}

const timerSchema = z
  .object({
    cron: z.string().refine(readable, "a 5-field cron, as ops-tick reads it"),
    name: z.string().min(1),
    text: z.string().min(1),
    to: z.string().regex(/^[a-z0-9-]+$/, "a session name or manager kind, as notify.sh takes it"),
  })
  .strict()

// The lines ops-tick's timers beat sends at their crons: each row's text, whole, to its session.
export const timerSettings = defineSettings({
  timers: {
    default: [],
    description:
      "Rows of { cron, name, text, to }: each minute ops-tick's timers beat sends the text of each row whose 5-field cron names that minute, whole, to the to session or manager kind, through the ops relay. The cron reads in the machine's local time, and day of month and day of week must both match, where standard cron takes either. A line break in the text arrives as a space, since the relay sends one line.",
    schema: z
      .array(timerSchema)
      .refine(
        (rows) => new Set(rows.map((row) => row.name)).size === rows.length,
        "a timer's name is in the list once",
      ),
  },
})
