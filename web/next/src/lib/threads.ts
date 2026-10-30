"use client"

import type { Entry } from "@api/hono"
import {
  THREADS_PER_PAGE,
  type Thread,
  type ThreadPatch,
  type ThreadsPage,
} from "@packages/config/threads"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { z } from "zod"

import { apiClient, unwrap } from "@/lib/api/client"
import { findDelivery, type OutboxMessage } from "@/lib/outbox"
import { queryRetry } from "@/lib/query"

export const THREADS_QUERY_KEY = ["dashboard", "threads"] as const

// A message routed to a thread moves it and its count within this long, without a reload.
export const THREADS_REFRESH_MS = 5_000

export async function fetchThreads(page: number): Promise<ThreadsPage> {
  const { data, error } = await unwrap(apiClient.v1.threads.$get({ query: { page: String(page) } }))
  if (error) throw new Error(error.message)
  return data
}

export async function patchThread(id: string, patch: ThreadPatch): Promise<Thread> {
  const { data, error } = await unwrap(
    apiClient.v1.threads[":id"].$patch({ json: patch, param: { id } }),
  )
  if (error) throw new Error(error.message)
  return data
}

export async function fetchThreadMessages(id: string) {
  const { data, error } = await unwrap(apiClient.v1.threads[":id"].messages.$get({ param: { id } }))
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data
}

// A thread that does not exist, or an id in the wrong shape, answers the same on a second try.
const FINAL = ["NOT_FOUND", "VALIDATION_ERROR"]

// One thread's view: the thread and its messages in its own order, read again as the sidebar's rows are, so a message routed to it shows without a reload.
export const useThreadMessages = (id: string) =>
  useQuery({
    queryKey: [...THREADS_QUERY_KEY, "messages", id],
    queryFn: () => fetchThreadMessages(id),
    refetchInterval: THREADS_REFRESH_MS,
    retry: (failures, error) =>
      !FINAL.includes((error as { code?: string }).code ?? "") && queryRetry(failures, error),
  })

// One page of the sidebar's Threads group; the page before stays drawn while the next is read, so the rows never empty as it pages.
export const useThreads = (enabled: boolean, page: number) =>
  useQuery({
    enabled,
    placeholderData: keepPreviousData,
    queryKey: [...THREADS_QUERY_KEY, page],
    queryFn: () => fetchThreads(page),
    refetchInterval: THREADS_REFRESH_MS,
  })

// Pure: whether the sidebar waits on the threads' read before it draws, so the group arriving never pushes the rows below it: the first try alone, so a read that fails and retries never keeps the sessions off the page.
export const holdsForThreads = (read: { failureCount: number; isPending: boolean }): boolean =>
  read.isPending && read.failureCount === 0

// Pure: the group label's pager, or null at five threads or fewer.
export const threadPager = (data: ThreadsPage) =>
  data.total > THREADS_PER_PAGE
    ? {
        hasNext: data.hasNextPage,
        hasPrevious: data.page > 1,
        page: data.page,
        pages: Math.ceil(data.total / THREADS_PER_PAGE),
      }
    : null

// Pure: the page to show instead when this one came back empty past the first (its last thread archived), else null.
export const pageAfterEmpty = (data: ThreadsPage): number | null =>
  data.threads.length === 0 && data.page > 1
    ? Math.max(1, Math.ceil(data.total / THREADS_PER_PAGE))
    : null

// Pure: where a row opens: the thread's own view, at a URL of its own so a row opens in a new tab too.
export const threadHref = (thread: Pick<Thread, "id">): string =>
  `/dashboard/threads/${encodeURIComponent(thread.id)}`

// Pure: a thread's view in reading order: what you asked first, when you wrote its first message, then each message someone else wrote stamped after lastReadAt (every one while it is null), then the rest, yours included, which the view folds away, then everything stamped after openedAt (the moment the view opened), in order, so a reply sent from the view stays in sight. The API's unread count is the same rule.
export const threadSections = (
  entries: Entry[],
  lastReadAt: string | null,
  openedAt = Infinity,
): { asked: Entry | null; history: Entry[]; latest: Entry[]; unread: Entry[] } => {
  const asked = entries[0]?.kind === "human" ? entries[0] : null
  const rest = asked ? entries.slice(1) : entries
  const read = lastReadAt === null ? null : Date.parse(lastReadAt)
  const isLatest = (entry: Entry) => Date.parse(entry.at) > openedAt
  const isUnread = (entry: Entry) =>
    entry.kind !== "human" && (read === null || Date.parse(entry.at) > read)
  const before = rest.filter((entry) => !isLatest(entry))
  return {
    asked,
    history: before.filter((entry) => !isUnread(entry)),
    latest: rest.filter(isLatest),
    unread: before.filter(isUnread),
  }
}

// How long a message the session has taken shows as on its way before it is routed to the thread: ingest's next read of the transcript, and some.
const FILING_MS = 90_000

// Pure: the messages sent from a thread's view still on their way to it: queued, sending or failed, or taken by the session within FILING_MS and not yet among the thread's messages, matched as the full chat matches a message to its entry (findDelivery: its words and its files).
export const pendingIn = (
  entries: Entry[],
  messages: OutboxMessage[],
  threadId: string,
  now: number,
): OutboxMessage[] =>
  messages.filter((message) => {
    if (message.threadId !== threadId) return false
    if (message.state === "failed" || message.state === "queued" || message.state === "sending")
      return true
    if (message.state !== "typed" || !message.typedAt) return false
    if (now - Date.parse(message.typedAt) > FILING_MS) return false
    return !findDelivery(message, entries, new Set())
  })

// Pure: a row menu's items in order, each with the change it sends; Rename's waits for the new title.
export const threadActions = (
  thread: Pick<Thread, "pinnedAt" | "unread">,
): { label: string; patch: ThreadPatch | null }[] => [
  thread.unread > 0
    ? { label: "Mark as read", patch: { read: true } }
    : { label: "Mark as unread", patch: { read: false } },
  { label: "Rename", patch: null },
  thread.pinnedAt
    ? { label: "Unpin", patch: { pinned: false } }
    : { label: "Pin", patch: { pinned: true } },
  { label: "Archive", patch: { archived: true } },
]

type Action = ReturnType<typeof threadActions>[number]

// A row menu's item: its change, or Rename's box for the new title.
export const runAction = (
  thread: Thread,
  action: Action,
  to: { patch: (thread: Thread, patch: ThreadPatch) => void; rename: (thread: Thread) => void },
): void => (action.patch ? to.patch(thread, action.patch) : to.rename(thread))

// Rename's field, held to the API's title: 1 to 200 characters once trimmed.
export const renameSchema = z.object({
  title: z.string().trim().min(1, "Give the thread a title").max(200, "Keep it to 200 characters"),
})

// Pure: Rename's change, the title trimmed, or null when it is blank or unchanged.
export const renamePatch = (thread: Pick<Thread, "title">, title: string): ThreadPatch | null => {
  const next = title.trim()
  return next && next !== thread.title ? { title: next } : null
}

// Pure: a click that opens the link here, the main button with no modifier; any other opens a new tab or window, which reads the link itself.
export const isPlainClick = (event: {
  altKey: boolean
  button: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}): boolean =>
  event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
