import { useSyncExternalStore } from "react"

import { attachmentUrl, isAttachmentId } from "@/lib/attachments"
import type { OutboxAttachment } from "@/lib/outbox"

// What the composer holds for a session and has not sent: its words and the files already uploaded for them.
export type Draft = { attachments: OutboxAttachment[]; text: string }
export type Drafts = Record<string, Draft>

export const DRAFTS_KEY = "dashboard.composer.drafts.v1"

const KINDS = new Set(["image", "pdf", "text"])
const EMPTY: Drafts = {}

const isEmpty = (draft: Draft) => !draft.text.trim() && !draft.attachments.length

// Pure: the drafts a stored value holds, keeping only a file the API would name, its preview rebuilt from its id, so a hand-edited value never points an image at another site.
export function parseDrafts(raw: string | null): Drafts {
  if (!raw) return EMPTY
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return EMPTY
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY
  const drafts: Drafts = {}
  for (const [to, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object") continue
    const { attachments, text } = entry as Record<string, unknown>
    const files = (Array.isArray(attachments) ? attachments : []).flatMap((file) => {
      const { id, kind, name, size } = (file ?? {}) as Record<string, unknown>
      if (typeof id !== "string" || !isAttachmentId(id)) return []
      if (typeof kind !== "string" || !KINDS.has(kind)) return []
      if (typeof name !== "string" || typeof size !== "number") return []
      const ref: OutboxAttachment = {
        id,
        kind: kind as OutboxAttachment["kind"],
        name,
        previewUrl: kind === "image" ? attachmentUrl(id) : null,
        size,
      }
      return [ref]
    })
    const draft = { attachments: files, text: typeof text === "string" ? text : "" }
    if (!isEmpty(draft)) drafts[to] = draft
  }
  return drafts
}

// Pure: the drafts with one session's replaced, an empty one removing it.
export function putDraft(drafts: Drafts, to: string, draft: Draft): Drafts {
  const rest = { ...drafts }
  delete rest[to]
  return isEmpty(draft) ? rest : { ...rest, [to]: draft }
}

// The files a restored draft still holds, dropping only those the API answers are gone; one it cannot ask about stays, and the send then says what is missing.
export async function keptAttachments(
  refs: OutboxAttachment[],
  gone: (id: string) => Promise<boolean>,
): Promise<OutboxAttachment[]> {
  const answers = await Promise.all(refs.map((ref) => gone(ref.id).catch(() => false)))
  return refs.filter((_, i) => !answers[i])
}

// Whether the dashboard no longer keeps a file: files leave the folder a week after they arrive.
export async function attachmentGone(id: string): Promise<boolean> {
  const url = attachmentUrl(id)
  if (!url) return true
  const response = await fetch(url, { credentials: "include", method: "HEAD" })
  return response.status === 404
}

// The drafts in this tab, read from localStorage and kept here too, so a blocked or private window still keeps a draft across a session switch; another tab's write arrives through the storage event.
let current: Drafts | null = null
const listeners = new Set<() => void>()

const readStored = (): Drafts | null => {
  try {
    return parseDrafts(localStorage.getItem(DRAFTS_KEY))
  } catch {
    return null
  }
}

export function readDrafts(): Drafts {
  if (current === null) current = readStored() ?? EMPTY
  return current
}

// Writes one session's draft over what storage holds now, so another tab's drafts for other sessions stay.
export function saveDraft(to: string, draft: Draft): void {
  const before = readStored() ?? readDrafts()
  const next = putDraft(before, to, draft)
  if (JSON.stringify(next) === JSON.stringify(readDrafts())) return
  current = next
  try {
    if (Object.keys(current).length) localStorage.setItem(DRAFTS_KEY, JSON.stringify(current))
    else localStorage.removeItem(DRAFTS_KEY)
  } catch {}
  for (const listener of listeners) listener()
}

const draftKey = (draft: Draft) =>
  JSON.stringify([draft.text, draft.attachments.map((file) => file.id)])

// One composer's saves: it writes only when its own words or files differ from what it last loaded or saved, so a render with nothing new here (an idle tab's composer re-rendering on every dashboard frame) never writes its stale box over a draft typed in another tab.
export function draftSaver(to: string, initial: Draft | undefined): (draft: Draft) => void {
  let last = draftKey(initial ?? { attachments: [], text: "" })
  return (draft) => {
    const key = draftKey(draft)
    if (key === last) return
    last = key
    saveDraft(to, draft)
  }
}

const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DRAFTS_KEY && event.key !== null) return
    current = null
    onChange()
  }
  listeners.add(onChange)
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onStorage)
  }
}

// Whether one session holds a draft, for its sidebar row's Draft mark: none on the server's first paint, then this browser's. A boolean, so a key typed into one composer re-renders no row whose mark stays as it was.
export const useDrafted = (to: string): boolean =>
  useSyncExternalStore(
    subscribe,
    () => Boolean(readDrafts()[to]),
    () => false,
  )

// Pure: what the composer's box holds once it takes words handed to it (a failed message's Edit), after anything already typed, or null when it takes none: words for another session, or the very hand-off it took already, since React's development run of a new composer's effects twice would take one twice before it clears. A message of files alone hands back no words, so what is typed stays as it is.
export function takeHanded<Handed extends { text: string; to: string }>(
  typed: string,
  handed: Handed | null,
  to: string,
  taken: Handed | null,
): string | null {
  if (!handed || handed.to !== to || handed === taken) return null
  return typed.trim() && handed.text
    ? `${typed}\n${handed.text}`
    : typed.trim()
      ? typed
      : handed.text
}
