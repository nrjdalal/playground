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

// The query for a kept page from Previews, fetched with the owner's cookie into a blob URL as a card's file is (attachmentQuery), once for the page's life, since the HTML view reads its text with a fetch that sends none. load is fetch, a test's stand-in aside.
export const pageQuery = (url: string, load: typeof fetch = fetch) => ({
  gcTime: Number.POSITIVE_INFINITY,
  queryFn: async (): Promise<string> => {
    const response = await load(url, { credentials: "include" })
    if (response.status === 404) return MISSING
    if (!response.ok) throw new Error(`The page did not load (${response.status})`)
    return URL.createObjectURL(await response.blob())
  },
  queryKey: ["aside-page", url],
  staleTime: Number.POSITIVE_INFINITY,
})

// An ask's, a draft's, a Slack decision's or a read-only update's file, fetched with the owner's cookie from the dashboard's own page, since its route takes a trusted Origin, which an <img> never sends, and shown through a blob URL; a kept page from Previews comes from its own address (page) instead. url is null until it arrives, missing is true once the API answered 404, and failed once its fetch failed any other way (another status, a lost connection).
export function useAttachment(
  id: string,
  enabled = true,
  page?: string,
): { failed: boolean; missing: boolean; url: string | null } {
  const { data, isError } = useQuery(
    page ? { ...pageQuery(page), enabled } : attachmentQuery(id, enabled),
  )
  return { failed: isError, missing: data === MISSING, url: data && data !== MISSING ? data : null }
}

// Pure: where a kept file is served as a download, saved under its item's title.
export function attachmentDownloadUrl(id: string): string {
  const url = new URL(apiClient.v1.inbox.attachments[":id"].$url({ param: { id } }))
  url.searchParams.set("download", "1")
  return url.toString()
}
