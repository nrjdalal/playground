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
