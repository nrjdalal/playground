// How long ago, in the reader's own words. Locale-aware through Intl rather than hand-built strings, so a non-English reader gets their own phrasing for free.
// `now` is a parameter rather than read inside, which keeps it pure and testable and stops a clock from leaking into a render.
// No seconds: anything inside a minute is "just now", so "58 sec. ago" can never render.
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["year", 365 * 24 * 60 * 60 * 1000],
]

// Under a minute reads as now in either direction, which is also what keeps the seconds unit unreachable.
const JUST_NOW_MS = 60 * 1000

export function relativeTime(value: Date | string, now: Date, locale?: string): string {
  const then = typeof value === "string" ? new Date(value) : value
  const elapsed = now.getTime() - then.getTime()
  if (Number.isNaN(elapsed)) return ""
  if (Math.abs(elapsed) < JUST_NOW_MS) return "just now"

  // "short" over "narrow" because a table cell reading "2 min. ago" is plainer than "2m ago", and "auto" is what turns yesterday into "yesterday".
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" })
  // The largest unit that still counts at least one, so an hour reads as an hour rather than sixty minutes.
  let [unit, ms] = UNITS[0]
  for (const [candidate, candidateMs] of UNITS) {
    if (Math.abs(elapsed) < candidateMs) break
    unit = candidate
    ms = candidateMs
  }
  // Negative for the past, which is what RelativeTimeFormat expects.
  return format.format(-Math.round(elapsed / ms), unit)
}

// When a message was sent, as a chat shows it: the clock alone today ("7:37 PM"), with the day before it on an earlier one ("Oct 5, 7:37 PM") and the year in an earlier year.
export function messageTime(value: Date | string, now: Date, locale?: string): string {
  const at = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(at.getTime())) return ""
  const clock = at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
  if (at.toDateString() === now.toDateString()) return clock
  // The day and the clock are joined here, since Intl joins them with a word in some locales ("Oct 5 at 7:37 PM").
  const day = at.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  })
  return `${day}, ${clock}`
}

// The whole moment, date and seconds included, for a hover.
export function fullTime(value: Date | string, locale?: string): string {
  const at = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(at.getTime())) return ""
  return at.toLocaleString(locale, { dateStyle: "medium", timeStyle: "medium" })
}
