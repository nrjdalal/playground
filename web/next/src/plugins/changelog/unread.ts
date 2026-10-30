import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiClient, unwrap } from "@/lib/api/client"
import { isVerifyVisit } from "@/lib/verify-visit"

export const CHANGELOG_QUERY_KEY = ["apps", "changelog"] as const
export const UNREAD_QUERY_KEY = ["apps", "changelog", "unread"] as const

// The sync adds entries every 5 minutes, so the count is read as often, and again whenever the window regains focus.
const UNREAD_REFRESH_MS = 5 * 60 * 1000

// The same shape the API's image ids take (api/hono's plugins/changelog/images.ts), so the page builds a URL only from an id the API would serve.
const IMAGE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:gif|jpg|png|webp)$/

// A screenshot's URL on our own API, or null for an id the API would never give, so the page never loads an image from anywhere else.
export const imageUrl = (id: string): string | null =>
  IMAGE_ID.test(id)
    ? apiClient.v1.apps.changelog.images[":id"].$url({ param: { id } }).toString()
    : null

// The newest arrival among these entries, which the page marks read; null when there are none.
export const newestArrival = (entries: { createdAt: string }[]): string | null =>
  entries.reduce<string | null>(
    (newest, entry) => (newest === null || entry.createdAt > newest ? entry.createdAt : newest),
    null,
  )

// Whether an entry arrived after this viewer's last look; every entry is new before their first.
export const isUnread = (entry: { createdAt: string }, seenAt: string | null): boolean =>
  seenAt === null || entry.createdAt > seenAt

// The arrival a visit marks read: the newest one shown while it is still unread, and none on verify's own visit, which would clear the owner's count minutes after each merge.
export const seenMark = (newest: string | null, seenAt: string | null): string | null =>
  !isVerifyVisit() && newest && isUnread({ createdAt: newest }, seenAt) ? newest : null

async function fetchUnread() {
  const { data, error } = await unwrap(apiClient.v1.apps.changelog.unread.$get())
  if (error) throw new Error(error.message)
  return data.unread
}

// How many changes this viewer has not read, for the aside's Changelog square.
export function useChangelogUnread(enabled: boolean, background = false): number {
  const { data } = useQuery({
    enabled,
    queryFn: fetchUnread,
    queryKey: UNREAD_QUERY_KEY,
    refetchInterval: UNREAD_REFRESH_MS,
    refetchIntervalInBackground: background,
    // a 404 means CHANGELOG_ENABLED turned the plugin off: read it as 0 once, not four times
    retry: false,
  })
  return data ?? 0
}

// Marks the changelog read up to `at` for this viewer, then reads the count again.
export function useMarkSeen() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (at: string) => {
      const { data, error } = await unwrap(apiClient.v1.apps.changelog.seen.$post({ json: { at } }))
      if (error) throw new Error(error.message)
      return data.seenAt
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: UNREAD_QUERY_KEY,
        exact: true,
      }),
  })
}
