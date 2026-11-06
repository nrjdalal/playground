"use client"

import { useQuery } from "@tanstack/react-query"

import { apiClient } from "@/lib/api/client"

// What a file the API no longer holds settles to: a 404 (a fixture stack's restart drops the folder it was kept in, or the week's sweep took it) is an answer, kept for the page's life as a file is, so its card asks once and shows it missing rather than retrying.
export const MISSING = "missing"

// The query for one file, shared by its thumbnail, its slide and its open-in-tab square: one fetch a file for the page's life, and while enabled is false (a slide far from the one shown) none. load is fetch, a test's stand-in aside.
export const attachmentQuery = (id: string, enabled = true, load: typeof fetch = fetch) => ({
  enabled,
  gcTime: Number.POSITIVE_INFINITY,
  queryFn: async (): Promise<string> => {
    const url = apiClient.v1.inbox.attachments[":id"].$url({ param: { id } })
    const response = await load(url, { credentials: "include" })
    if (response.status === 404) return MISSING
    if (!response.ok) throw new Error(`The file did not load (${response.status})`)
    return URL.createObjectURL(await response.blob())
  },
  queryKey: ["inbox-attachment", id],
  staleTime: Number.POSITIVE_INFINITY,
})

// An ask's, a draft's, a Slack decision's or a read-only update's file, fetched with the owner's cookie from the dashboard's own page, since its route takes a trusted Origin, which an <img> never sends, and shown through a blob URL: url is null until it arrives, and missing is true once the API answered 404.
export function useAttachment(
  id: string,
  enabled = true,
): { missing: boolean; url: string | null } {
  const { data } = useQuery(attachmentQuery(id, enabled))
  return { missing: data === MISSING, url: data && data !== MISSING ? data : null }
}

// Pure: where a kept file is served as a download, saved under its item's title.
export function attachmentDownloadUrl(id: string): string {
  const url = new URL(apiClient.v1.inbox.attachments[":id"].$url({ param: { id } }))
  url.searchParams.set("download", "1")
  return url.toString()
}
