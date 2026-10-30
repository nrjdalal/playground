import { z } from "zod"

import { ID_ALPHABET } from "./kinds"

// The contract of a thread: one thing the owner asked about, followed up until it is done. The API, the routing and the sidebar all read these shapes, and every type comes from them.

// A thread's id: 4 characters of ID_ALPHABET, at least one of them a letter, so an id never reads as a number.
const THREAD_ID_SOURCE = `(?=[2-9]{0,3}[a-z])[${ID_ALPHABET}]{4}`

export const THREAD_ID = new RegExp(`^${THREAD_ID_SOURCE}$`)

export const THREADS_PER_PAGE = 5

export const THREAD_TITLE_MAX = 200

export const threadIdSchema = z.string().regex(THREAD_ID).meta({ example: "k7mq" })

// A message's thread marker: `[thread:<id>]` at the very start of its text, past the `[Image #n]` marks Claude Code puts first, then one space.
const MARKED = new RegExp(`^(\\s*(?:\\[Image #\\d+\\]\\s*)*)\\[thread:(${THREAD_ID_SOURCE})\\] ?`)

// Pure: the words with the marker that routes them to a thread put first.
export const withMarker = (id: string, text: string): string => `[thread:${id}] ${text.trimStart()}`

// Pure: the thread a message's leading marker names, and its text with the marker taken out; id null when it opens with none.
export const markerOf = (text: string): { id: string | null; text: string } => {
  const found = MARKED.exec(text)
  if (!found) return { id: null, text }
  return { id: found[2] ?? null, text: (found[1] ?? "") + text.slice(found[0].length) }
}

// firstMessageId: the uuid of the thread's claude_entry with the lowest threadSeq, the id the chat keys that message by (Entry.id in api/hono/src/lib/dashboard/transcript.ts), null until a route tags one. unread: the thread's messages someone else wrote stamped after lastReadAt, every one of them while lastReadAt is null. updatedAt: its newest routed message's time, the sidebar's order after the pinned threads.
export const threadSchema = z.object({
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  firstMessageId: z.string().nullable(),
  id: threadIdSchema,
  lastReadAt: z.iso.datetime().nullable(),
  pinnedAt: z.iso.datetime().nullable(),
  title: z.string().min(1),
  unread: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
})

export type Thread = z.infer<typeof threadSchema>

// One page of the open threads: pinned first with the newest pin on top (pinnedAt newest first), then updatedAt newest first, id breaking a tie, archived ones left out.
export const threadsPageSchema = z.object({
  threads: z.array(threadSchema),
  hasNextPage: z.boolean(),
  page: z.number().int().positive(),
  total: z.number().int().nonnegative(),
})

export type ThreadsPage = z.infer<typeof threadsPageSchema>

// Each field is one change and at least one is given: archived and pinned set or clear their time, read true marks every message read now and false marks every one unread again, title renames the thread.
export const threadPatchSchema = z
  .object({
    archived: z.boolean().optional(),
    pinned: z.boolean().optional(),
    read: z.boolean().optional(),
    title: z.string().trim().min(1).max(THREAD_TITLE_MAX).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Give at least one field",
  })

export type ThreadPatch = z.infer<typeof threadPatchSchema>
