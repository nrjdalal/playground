"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { config } from "@/lib/config"
import { channelHref, landingChannel } from "@/lib/yard"
import { useYardChannels } from "@/lib/yard-api"

// /yard opens the sidebar's first row; with none yet, it says so.
export function YardHome() {
  const { data } = useYardChannels()
  const router = useRouter()
  const first = data ? landingChannel(data) : null
  useEffect(() => {
    if (first) router.replace(channelHref(first, config.hosted))
  }, [first, router])
  if (!data || first) return null
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>No channels yet</EmptyTitle>
        <EmptyDescription>A channel you join shows in the sidebar.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
