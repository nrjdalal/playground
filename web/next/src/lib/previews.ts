import type { Preview } from "@api/hono"

import { apiClient, unwrap } from "@/lib/api/client"

export const PREVIEWS_QUERY_KEY = ["apps", "previews"] as const

export async function fetchPreviews() {
  const { data, error } = await unwrap(apiClient.v1.apps.previews.$get({ query: {} }))
  if (error) throw new Error(error.message)
  return data
}

// The pages a session's Pages tab lists: those it made or that were made for it, every page on the primary dispatcher's.
export async function fetchPages(session: string) {
  const { data, error } = await unwrap(apiClient.v1.apps.previews.$get({ query: { session } }))
  if (error) throw new Error(error.message)
  return data
}

// Pure: where a preview is served, on the API's own origin.
export const previewUrl = (apiUrl: string, name: string): string =>
  `${apiUrl}/api/v1/apps/previews/${encodeURIComponent(name)}`

// Pure: an address the Inbox's Preview frame may load: a page from Previews, or a local stack (https or http on a .localhost host).
export const loadable = (address: string, apiUrl: string): boolean => {
  if (address.startsWith(previewUrl(apiUrl, ""))) return true
  try {
    const url = new URL(address)
    return /^https?:$/.test(url.protocol) && url.hostname.endsWith(".localhost")
  } catch {
    return false
  }
}

// Pure: the address the Preview frame opens on: the one kept for this browser while it is loadable, else the first stack's root, else none.
export const startAddress = (
  kept: string | null,
  stacks: readonly { url: string }[],
  apiUrl: string,
): string => {
  if (kept && loadable(kept, apiUrl)) return kept
  const first = stacks[0]
  return first ? `${first.url}/` : ""
}

// Pure: each topic once, in the order its newest preview comes (the list is newest first), with how many previews it holds.
export function topicCounts(previews: Preview[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const preview of previews) counts.set(preview.topic, (counts.get(preview.topic) ?? 0) + 1)
  return counts
}

// Pure: the previews grouped by topic, newest topic first and newest first within each, kept to the topics picked (all of them when none is); a picked topic the folder lacks shows nothing.
export function topicGroups(
  previews: Preview[],
  picked: readonly string[] = [],
): { previews: Preview[]; topic: string }[] {
  const groups = new Map<string, Preview[]>()
  for (const preview of previews) {
    if (picked.length && !picked.includes(preview.topic)) continue
    groups.set(preview.topic, [...(groups.get(preview.topic) ?? []), preview])
  }
  return [...groups].map(([topic, items]) => ({ previews: items, topic }))
}
