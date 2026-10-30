import type { Spend, WindowView } from "@api/hono"

import { apiClient, unwrap } from "@/lib/api/client"

export const USAGE_QUERY_KEY = ["apps", "usage"] as const

export async function fetchUsage() {
  const { data, error } = await unwrap(apiClient.v1.apps.usage.$get())
  if (error) throw new Error(error.message)
  return data
}

export type Period = "today" | "week"

// Pure: the rows that spent in a period, costliest first, at most `limit` of them; the API sends the top of both periods, so each view cuts to its own.
export const topFor = <T extends Record<Period, Spend>>(
  rows: T[],
  period: Period,
  limit = Number.POSITIVE_INFINITY,
): T[] =>
  rows
    .filter((row) => row[period].calls > 0)
    .sort((a, b) => b[period].usd - a[period].usd)
    .slice(0, limit)

// Dollars to the cent, and to a tenth of a cent below a dollar, so a cheap session does not read as free.
export const usdLabel = (usd: number): string =>
  usd.toLocaleString("en-US", {
    currency: "USD",
    maximumFractionDigits: usd > 0 && usd < 1 ? 3 : 2,
    minimumFractionDigits: 2,
    style: "currency",
  })

// Tokens as K, M or B with one decimal where it helps (12.3M, 450K).
export const tokensLabel = (tokens: number): string =>
  tokens.toLocaleString("en-US", { maximumFractionDigits: 1, notation: "compact" })

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })

const day = (iso: string, now: Date): string => {
  const date = new Date(iso)
  return date.toDateString() === now.toDateString()
    ? clock(iso)
    : `${date.toLocaleDateString("en-US", { weekday: "short" })} ${clock(iso)}`
}

// Pure: what the burn so far says about a window: the rate, when it runs out and whether that comes before it resets.
export function forecastLine(window: WindowView, now: Date): string {
  const { forecast, resetsAt } = window
  if (!forecast || !resetsAt) return "No reset time to forecast against"
  if (!forecast.runsOutAt) return `Nothing used yet; resets ${day(resetsAt, now)}`
  const rate = `${forecast.perHour.toFixed(1)}% an hour`
  return forecast.beforeReset
    ? `At ${rate} it runs out ${day(forecast.runsOutAt, now)}, before it resets ${day(resetsAt, now)}`
    : `At ${rate} it lasts until it resets ${day(resetsAt, now)}`
}

// Pure: minutes as hours and minutes (1h 25m, 40m).
export const wallLabel = (minutes: number | null): string => {
  if (minutes === null) return "-"
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}
