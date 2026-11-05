import { fullTime } from "@/lib/time"

// What the hosted web reads before it draws the dashboard: whether the owner's Mac holds the relay, and since when it is offline, when the hub saw it go.
export type RelayStatus = { online: boolean; since: string | null }

export const RELAY_STATUS_KEY = ["relay", "status"] as const

// How often the hosted dashboard asks again whether the Mac is there.
export const RELAY_STATUS_MS = 15_000

// Pure: the one line the hosted dashboard shows while the Mac is offline.
export const offlineLine = (since: string | null): string =>
  since ? `Your Mac is offline since ${fullTime(since)}` : "Your Mac is offline"
