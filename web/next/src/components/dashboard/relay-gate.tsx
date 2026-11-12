"use client"

import type { RelayStatus } from "@api/hono"
import { RELAY_PREFIX } from "@packages/message"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useState } from "react"

import { unwrap } from "@/lib/api/client"
import { config } from "@/lib/config"
import {
  confirmedStatus,
  gateView,
  RELAY_STATUS_KEY,
  RELAY_STATUS_MS,
  whenVisible,
} from "@/lib/relay"

// a hand fetch, since `/status` sits outside AppType and apiClient points at the relay itself
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

// The hosted build's dashboard draws only while the owner's Mac holds the relay; otherwise its one line says since when the Mac is offline, with a link to Yard's own pages, whose channels read with no Mac. A tab that comes back reads the status again at once, and an offline answer counts only once a second read confirms it.
export function RelayGate({ children }: { children: React.ReactNode }) {
  const [visibleAt, setVisibleAt] = useState(0)
  const { data, dataUpdatedAt, error, errorUpdatedAt, refetch } = useQuery({
    queryFn: () => confirmedStatus(readRelayStatus),
    queryKey: RELAY_STATUS_KEY,
    refetchInterval: RELAY_STATUS_MS,
    refetchOnWindowFocus: false,
  })
  useEffect(
    () =>
      whenVisible(document, (at) => {
        setVisibleAt(at)
        void refetch()
      }),
    [refetch],
  )
  const view = gateView({
    data,
    error,
    readAt: Math.max(dataUpdatedAt, errorUpdatedAt),
    visibleAt,
  })
  if (view === "dashboard") return children
  if (view === "wait") return null
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <p className="text-muted-foreground text-sm">
        {view.line} ·{" "}
        <Link className="underline" href="/yard">
          Open Yard
        </Link>
      </p>
    </main>
  )
}
