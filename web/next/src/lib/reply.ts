import type { InboxItem } from "@api/hono"
import { useSyncExternalStore } from "react"

// The inbox item Playground's composer is replying to, named in its words as re #iN; its card's band reads Replying until it is sent.
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

// A ref the composer's words open with, its colon and the spaces after it too, so Reply on another card swaps it rather than adding a second.
const LEADING = /^\s*re #i\d{1,9}\b:?[ \t]*/i

// Pure: the composer's words once a card's Reply hands them over: re #iN: first, then the words the box held, any item's ref they opened with swapped for this one.
export const withRef = (text: string, ref: number): string =>
  `re #i${ref}: ${text.replace(LEADING, "")}`

// Where a card's Reply takes the owner: words in the box send, or open a folded card to them; an empty box goes to the composer, but a secret ask's opens its own box, since a secret never reaches the chat, and so does any card's while Playground's session is down, since no composer would take the hand until it is back.
export type ReplyRoute = "composer" | "open" | "send"

// Pure: a card's Reply, by its comment box's words, whether it is folded, whether it is a secret ask and whether Playground's chat, the primary dispatcher's live session, is there.
export function replyRoute(card: {
  chat: boolean
  folded: boolean
  secret: boolean
  text: string
}): ReplyRoute {
  if (card.text.trim() !== "") return card.folded ? "open" : "send"
  return card.secret || !card.chat ? "open" : "composer"
}
