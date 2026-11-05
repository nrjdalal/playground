import type { InboxItem } from "@api/hono"
import { useSyncExternalStore } from "react"

// The inbox item Playground's composer is replying to, named in its words as re #iN; the list marks it until it is sent.
export type Reply = Pick<InboxItem, "ref" | "title">

// One value React reads and the composer sets whenever the item its words name changes, notifying only on a change.
let value: Reply | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setTypedReply(next: Reply | null) {
  if (next?.ref === value?.ref && next?.title === value?.title) return
  value = next
  for (const listener of listeners) listener()
}

export const useTypedReply = (): Reply | null =>
  useSyncExternalStore(
    subscribe,
    () => value,
    () => null,
  )

// The words that name an item (`re #iN`), as the composer sends and the list reads; the API's REPLY_RE holds the same pattern (a test holds the two equal).
export const TYPED = /\bre #i(\d{1,9})\b/i

// Pure: the item a message names by "re #iN", or null when it names none the list holds.
export function typedReply(text: string, items: readonly InboxItem[]): Reply | null {
  const ref = TYPED.exec(text)?.[1]
  const item = ref === undefined ? undefined : items.find((i) => i.ref === Number(ref))
  return item ? { ref: item.ref, title: item.title } : null
}
