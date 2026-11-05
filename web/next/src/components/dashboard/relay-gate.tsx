"use client"

import { RELAY_PREFIX } from "@packages/message"
import { useQuery } from "@tanstack/react-query"

import { unwrap } from "@/lib/api/client"
import { config } from "@/lib/config"
import { offlineLine, RELAY_STATUS_KEY, RELAY_STATUS_MS, type RelayStatus } from "@/lib/relay"

async function readRelayStatus(): Promise<RelayStatus> {
  const { data, error } = await unwrap(
    fetch(`${config.api.url}${RELAY_PREFIX}/status`, { credentials: "include" }) as Promise<{
      ok: boolean
      json: () => Promise<{ data: RelayStatus }>
    }>,
  )
  if (error) throw new Error(error.message)
  return data
}

// The hosted build's dashboard draws only while the owner's Mac holds the relay; otherwise its one line says since when the Mac is offline, and nothing else.
export function RelayGate({ children }: { children: React.ReactNode }) {
  const { data, error } = useQuery({
    queryFn: readRelayStatus,
    queryKey: RELAY_STATUS_KEY,
    refetchInterval: RELAY_STATUS_MS,
  })
  if (data?.online) return children
  if (!data && !error) return null
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <p className="text-muted-foreground text-sm">
        {data ? offlineLine(data.since) : "Your Mac cannot be reached"}
      </p>
    </main>
  )
}
