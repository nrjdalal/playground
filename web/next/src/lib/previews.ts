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

// Pure: the address the Preview frame opens on: the one kept for this browser while it is loadable, else the first running stack's root, else none.
export const startAddress = (
  kept: string | null,
  stacks: readonly { url: string | null }[],
  apiUrl: string,
): string => {
  if (kept && loadable(kept, apiUrl)) return kept
  const first = stacks.find((stack) => stack.url)?.url
  return first ? `${first}/` : ""
}

// A stopped worktree's picker value, its path after this prefix, so picking it offers Start.
export const STOPPED = "stopped:"

// Pure: the picker's stacks, one group a project in the list's order (by project, then branch), each running one its URL and a stopped one its path after STOPPED, labelled by its branch, else its name, the session working in it, and a Vibeground started and not serving yet as starting.
export const stackGroups = (
  stacks: readonly {
    branch: string | null
    name: string
    path: string | null
    project: string
    session: string | null
    url: string | null
    vibe?: boolean
  }[],
) => {
  const groups = new Map<string, { label: string; value: string }[]>()
  for (const stack of stacks) {
    const label = [
      stack.branch ?? stack.name,
      stack.session,
      !stack.url && (stack.vibe ? "starting" : "stopped"),
    ]
      .filter(Boolean)
      .join(" · ")
    const items = groups.get(stack.project) ?? []
    items.push({ label, value: stack.url ?? `${STOPPED}${stack.path}` })
    groups.set(stack.project, items)
  }
  return [...groups].map(([project, items]) => ({ items, project }))
}

// The brand's click opens the Inbox's Preview row: the aside turns to the Inbox, and the Inbox, now or once it mounts, opens the row; a click that moves the page also asks the aside, once, for the Inbox at the first address past the one it left, after the move resets its tab.
export const OPEN_PREVIEW = "dashboard:open-preview"
let previewWanted = false
let previewFrom: string | null = null
export const openPreview = (from: string | null): void => {
  previewWanted = true
  previewFrom = from
  window.dispatchEvent(new Event(OPEN_PREVIEW))
}
export const takePreview = (): boolean => {
  const wanted = previewWanted
  previewWanted = false
  return wanted
}
export const takeMove = (at: string): boolean => {
  if (previewFrom === null || at === previewFrom) return false
  previewFrom = null
  return true
}

// Pure: what the brand's click does: a plain click opens the row, leaving the address it is at (from) unless it is already at the link's own address; a modified or other-button click opens a tab, so it opens nothing here (null).
export const previewClick = (
  click: { altKey: boolean; button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  href: string,
  at: { pathname: string; search: string },
): { from: string | null } | null => {
  if (click.button !== 0 || click.altKey || click.ctrlKey || click.metaKey || click.shiftKey) {
    return null
  }
  const search = new URLSearchParams(at.search).toString()
  const from = `${at.pathname}${search ? `?${search}` : ""}`
  return { from: from === href ? null : from }
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
