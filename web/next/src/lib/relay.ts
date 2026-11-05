import type { RelayStatus } from "@api/hono"
import { RELAY_PREFIX } from "@packages/message"

import { fullTime } from "@/lib/time"

export const RELAY_STATUS_KEY = ["relay", "status"] as const

// How often the hosted dashboard asks again whether the Mac is there.
export const RELAY_STATUS_MS = 15_000

// Pure: the one line the hosted dashboard shows while the Mac is offline.
export const offlineLine = (since: string | null): string =>
  since ? `Your Mac is offline since ${fullTime(since)}` : "Your Mac is offline"

// Pure: where the dashboard's reads go: on the hosted build through the relay to the owner's Mac, at the relay's prefix plus their own path; the API's own routes, the session read among them, stay on base.
export const relayedBase = (base: string, hosted: boolean): string =>
  hosted ? `${base}${RELAY_PREFIX}` : base

// The one line the hosted dashboard shows where a composer or a write button would be, and the reason on a message it drops: the relay carries reads alone.
export const READ_ONLY_LINE = "Read-only on Yard: send from your Mac"

// How long the hosted dashboard waits before it reads the status again, after a read that says offline or fails.
export const RELAY_CONFIRM_MS = 1000

// The status the hosted dashboard trusts: one read, and when it says offline or fails, a second read confirmMs later, so a single offline answer from an instance that is still connecting never reads as offline.
export async function confirmedStatus(
  read: () => Promise<RelayStatus>,
  confirmMs = RELAY_CONFIRM_MS,
): Promise<RelayStatus> {
  try {
    const first = await read()
    if (first.online) return first
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, confirmMs))
  return read()
}

export type GateView = "dashboard" | "wait" | { line: string }

// Pure: what the hosted dashboard's gate draws: the dashboard while the Mac is online, nothing while the first read or a read since the tab came back is on its way, so an offline answer from before the tab was hidden never shows, and otherwise the offline line.
export function gateView({
  data,
  error,
  readAt,
  visibleAt,
}: {
  data: RelayStatus | undefined
  error: unknown
  readAt: number
  visibleAt: number
}): GateView {
  if (data?.online) return "dashboard"
  if ((!data && !error) || readAt < visibleAt) return "wait"
  return { line: data ? offlineLine(data.since) : "Your Mac cannot be reached" }
}

type VisibleDocument = Pick<
  Document,
  "addEventListener" | "removeEventListener" | "visibilityState"
>

// Calls onVisible with the time each time the tab becomes visible again, and returns what stops it.
export function whenVisible(doc: VisibleDocument, onVisible: (at: number) => void): () => void {
  const listener = () => {
    if (doc.visibilityState === "visible") onVisible(Date.now())
  }
  doc.addEventListener("visibilitychange", listener)
  return () => doc.removeEventListener("visibilitychange", listener)
}
