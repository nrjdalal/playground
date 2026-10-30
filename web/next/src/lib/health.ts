import { cache } from "react"

import { config } from "@/lib/config"

// The API's /api/health body, read once per server render for the layout's Test data badge, and the user menu's machine name. A read that fails or is slow is undefined.
export const readHealth = cache(async (): Promise<unknown> => {
  try {
    const response = await fetch(`${config.api.internalUrl || config.api.url}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    })
    return response.ok ? await response.json() : undefined
  } catch {
    return undefined
  }
})

// Pure: the dispatcher rows the sidebar's header will draw, as /api/health names them, so a stored sidebar holds that many; the primary's alone when the read failed or the count is not a whole number of 1 or more.
export const dispatcherSlotsOf = (health: unknown): number => {
  const slots = (health as { data?: { dispatcherSlots?: unknown } } | null)?.data?.dispatcherSlots
  return typeof slots === "number" && Number.isInteger(slots) && slots >= 1 ? slots : 1
}
