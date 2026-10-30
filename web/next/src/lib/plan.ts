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

// Pure: a moment in India's time, as the plan is read from there (Wed 01:21); "-" for none.
export function istTime(value: string | null | undefined): string {
  if (!value) return "-"
  return new Date(value).toLocaleString("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    weekday: "short",
  })
}

// Pure: a pull request's link text, its number.
export const prLabel = (url: string): string => `#${url.split("/").pop()}`
