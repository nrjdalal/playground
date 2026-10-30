"use client"

import { useQuery } from "@tanstack/react-query"

import { apiClient } from "@/lib/api/client"

// An ask's file, fetched with the owner's cookie from the dashboard's own page, since its route takes a trusted Origin, which an <img> never sends, and shown through a blob URL. One fetch a file for the page's life, shared by its thumbnail and its slide; null until it arrives, and while enabled is false (a slide far from the one shown).
export function useAttachmentUrl(id: string, enabled = true): string | null {
  const { data } = useQuery({
    enabled,
    gcTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const url = apiClient.v1.inbox.attachments[":id"].$url({ param: { id } })
      const response = await fetch(url, { credentials: "include" })
      if (!response.ok) throw new Error(`The file did not load (${response.status})`)
      return URL.createObjectURL(await response.blob())
    },
    queryKey: ["inbox-attachment", id],
    staleTime: Number.POSITIVE_INFINITY,
  })
  return data ?? null
}
