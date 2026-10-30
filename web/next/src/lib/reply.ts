import type { InboxItem } from "@api/hono"
import { useSyncExternalStore } from "react"

import { leadingSkill } from "@/lib/skill-menu"

// The inbox item Playground's composer is replying to, picked by an item's Chat about it button; the composer sends it as "re #iN" before the words, and the list marks it until then.
export type Reply = Pick<InboxItem, "ref" | "title">

// One value React reads and anything may set: the reply picked by a button, and the one the composer's words name, which the list marks too. A pick notifies every time, even of the same item, so a second Chat about it still brings a phone's chat forward; the words' store notifies only on a change, since the composer sets it whenever the item its words name changes.
function store(everySet: boolean) {
  let value: Reply | null = null
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    set(next: Reply | null) {
      if (!everySet && next?.ref === value?.ref && next?.title === value?.title) return
      value = next
      for (const listener of listeners) listener()
    },
    get: (): Reply | null => value,
    use: (): Reply | null =>
      useSyncExternalStore(
        subscribe,
        () => value,
        () => null,
      ),
  }
}

const picked = store(true)
const typed = store(false)

export const setReply = picked.set
export const useReply = picked.use
export const currentReply = picked.get
export const setTypedReply = typed.set
export const useTypedReply = typed.use

// The words that name an item (`re #iN`), as the composer sends and the list reads; the API's REPLY_RE holds the same pattern (a test holds the two equal).
export const TYPED = /\bre #i(\d{1,9})\b/i

// Pure: the item a message names by "re #iN", or null when it names none the list holds.
export function typedReply(text: string, items: readonly InboxItem[]): Reply | null {
  const ref = TYPED.exec(text)?.[1]
  const item = ref === undefined ? undefined : items.find((i) => i.ref === Number(ref))
  return item ? { ref: item.ref, title: item.title } : null
}

// Pure: the message as sent: the words led by the item's id, after the command of one of the session's skills so the skill still runs, unless they already name it; files sent alone carry the id by itself.
export function withReply(
  text: string,
  reply: Reply | null,
  skills: readonly string[] = [],
): string {
  if (!reply || new RegExp(`\\bre #i${reply.ref}\\b`, "i").test(text)) return text
  const skill = leadingSkill(text, skills)
  const words = text.slice(skill.length)
  const tagged = words.trim() ? `re #i${reply.ref}: ${words}` : `re #i${reply.ref}`
  return skill ? `${skill.trimEnd()} ${tagged}` : tagged
}
