const MINUTE_MS = 60_000
const HOUR_MIN = 60
const DAY_MIN = 24 * HOUR_MIN

// Whole minutes as the largest two units, a zero second unit dropped: 42m, 3h 12m, 3h, 2d 4h.
const units = (minutes: number): string => {
  if (minutes < HOUR_MIN) return `${minutes}m`
  const [big, small, bigUnit, smallUnit] =
    minutes < DAY_MIN
      ? [Math.floor(minutes / HOUR_MIN), minutes % HOUR_MIN, "h", "m"]
      : [Math.floor(minutes / DAY_MIN), Math.floor((minutes % DAY_MIN) / HOUR_MIN), "d", "h"]
  return small ? `${big}${bigUnit} ${small}${smallUnit}` : `${big}${bigUnit}`
}

// Pure: how long something has been on, exact and with no tilde (42m, 3h 12m, 2d 4h); under a minute, or a length that does not read, is 0m.
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0m"
  return units(Math.floor(ms / MINUTE_MS))
}

// A time ahead, rounded as an ETA deserves: the minute under an hour, five minutes under a day, the hour past it.
const approx = (ms: number): string => {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS))
  if (minutes < HOUR_MIN) return `~${minutes}m`
  const step = minutes < DAY_MIN ? 5 : HOUR_MIN
  return `~${units(Math.round(minutes / step) * step)}`
}

// How a time ahead reads: as time left to an ETA (~20m left), or as time from now to a start or a finish (in ~20m).
export type RemainingStyle = "in" | "left"

const phrase = (text: string, style: RemainingStyle): string =>
  style === "in" ? `in ${text}` : `${text} left`

const parse = (value: string | null | undefined): number => (value ? Date.parse(value) : Number.NaN)

const overdue = (at: number, now: number): string =>
  `overdue ${duration(Math.max(MINUTE_MS, now - at))}`

// Pure: the time left to an ETA, approximate (~20m left, ~2h 30m left), or overdue by an exact length once it has passed (overdue 15m); null for no time or one that does not read.
export function remaining(
  value: string | null | undefined,
  now: number,
  style: RemainingStyle = "left",
): string | null {
  const at = parse(value)
  if (Number.isNaN(at)) return null
  return at <= now ? overdue(at, now) : phrase(approx(at - now), style)
}

// Pure: the time left to an ETA given as a window (~20m to ~1h 10m left). Once its early end has passed it reads as its late end alone, and a missing end leaves the other.
export function remainingRange(
  from: string | null | undefined,
  to: string | null | undefined,
  now: number,
  style: RemainingStyle = "left",
): string | null {
  const early = parse(from)
  const late = parse(to)
  if (Number.isNaN(early)) return remaining(to, now, style)
  if (Number.isNaN(late)) return remaining(from, now, style)
  if (early <= now) return remaining(to, now, style)
  return phrase(`${approx(early - now)} to ${approx(late - now)}`, style)
}
