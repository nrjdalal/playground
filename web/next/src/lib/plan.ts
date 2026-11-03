import { apiClient, unwrap } from "@/lib/api/client"

export const PLAN_QUERY_KEY = ["apps", "plan"] as const

export async function fetchPlan() {
  const { data, error } = await unwrap(apiClient.v1.apps.plan.$get())
  if (error) throw new Error(error.message)
  return data
}

// The planner writes a status as a code in capitals (READY, WAITS ON #<n>); the page shows it in plain words, sentence case, keeping whatever follows the code as written.
const STATUS_WORDS = [
  "BLOCKED",
  "DONE",
  "IN FLIGHT",
  "IN REVIEW",
  "MERGED",
  "PARKED",
  "READY",
  "WAITS ON",
]

// Pure: a status as the page shows it (Waits on #<n>, Ready); one the list does not know reads as written.
export function statusLabel(status: string | null | undefined): string {
  if (!status) return "-"
  const code = STATUS_WORDS.find((word) => status === word || status.startsWith(`${word} `))
  if (!code) return status
  const words = code.charAt(0) + code.slice(1).toLowerCase()
  return `${words}${status.slice(code.length)}`
}

// The zone's own short name (IST, UTC, EDT) over a GMT offset where one locale has it, as the dashboard's ownerTime names it.
const zoneName = (at: Date, zone: string): string => {
  const names = ["en-US", "en-IN"].map(
    (locale) =>
      new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "short" })
        .formatToParts(at)
        .find((part) => part.type === "timeZoneName")?.value ?? zone,
  )
  return names.find((name) => !name.startsWith("GMT")) ?? names[0]!
}

// Pure: a moment in the owner's zone, the clock.ownerZone setting, named by that zone (Wed 01:21 IST); "-" for none or a zone not yet read.
export function zoneTime(value: string | null | undefined, zone: string | undefined): string {
  if (!value || !zone) return "-"
  const at = new Date(value)
  const time = at.toLocaleString("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: zone,
    weekday: "short",
  })
  return `${time} ${zoneName(at, zone)}`
}

// Pure: a pull request's link text, its number.
export const prLabel = (url: string): string => `#${url.split("/").pop()}`
