"use client"

import {
  unstable_createAdapterProvider as createAdapterProvider,
  type unstable_AdapterInterface as AdapterInterface,
} from "nuqs/adapters/custom"
import { createContext, useContext, useMemo, useRef, useState, type ComponentType } from "react"

import { PlanView } from "@/app/(protected)/dashboard/apps/plan/components/plan-view"
import { PreviewsView } from "@/app/(protected)/dashboard/apps/previews/components/previews-view"
import { UsageView } from "@/app/(protected)/dashboard/apps/usage/components/usage-view"
import type { DashboardAppId } from "@/lib/apps"
import { AsideUrl } from "@/lib/aside-url"
import { PLUGIN_VIEWS } from "@/plugins/registry"

// Each app's view, the one its own page draws.
const VIEWS: Record<DashboardAppId, ComponentType> = {
  changelog: PLUGIN_VIEWS.changelog,
  plan: PlanView,
  previews: PreviewsView,
  usage: UsageView,
}

const Memory = createContext<AdapterInterface | null>(null)

const MemoryAdapter = createAdapterProvider(() => {
  const adapter = useContext(Memory)
  if (!adapter) throw new Error("MemoryAdapter needs MemoryUrl")
  return adapter
})

// A URL of the pane's own, kept in memory while the pane is drawn, so an app's picks never rewrite the page's address.
function MemoryUrl({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useState(() => new URLSearchParams())
  const latest = useRef(searchParams)
  const adapter = useMemo<AdapterInterface>(
    () => ({
      getSearchParamsSnapshot: () => latest.current,
      searchParams,
      updateUrl: (search) => {
        latest.current = new URLSearchParams(search)
        setSearchParams(latest.current)
      },
    }),
    [searchParams],
  )
  return (
    <Memory.Provider value={adapter}>
      <MemoryAdapter>{children}</MemoryAdapter>
    </Memory.Provider>
  )
}

// An app opened from its square in the aside (#i787), beside the page as the Inbox and the chat are: its own page's view, with its URL state kept to the pane.
export function AppPane({ id }: { id: DashboardAppId }) {
  const View = VIEWS[id]
  return (
    <MemoryUrl>
      <AsideUrl.Provider value="aside-">
        <View />
      </AsideUrl.Provider>
    </MemoryUrl>
  )
}
