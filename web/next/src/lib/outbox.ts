import type { Entry, Worker } from "@api/hono"
import { markerOf } from "@packages/config/threads"

import { agentLabel } from "@/lib/agent-label"

// A file sent with a message, as the attachments picker hands it over; the outbox carries it so a pending bubble can show its chip.
export type OutboxAttachment = {
  id: string
  kind: "image" | "pdf" | "text"
  name: string
  previewUrl: string | null
  size: number
}

// queued: waiting its turn, or for a retry after a refusal that can pass (reason says why). sending: its request is out. typed: the session has it, in its input or, while it is busy, in its own queue. delivered: its transcript holds it (entryId). failed: refused for good, given up on, or cut off with its fate unknown (reason says which).
export type OutboxState = "delivered" | "failed" | "queued" | "sending" | "typed"

export type OutboxMessage = {
  at: string
  attachments: OutboxAttachment[]
  attempts: number
  code: string | null
  deliveredAt: string | null
  entryId: string | null
  id: string
  // Sent as the first message of a new thread, which the API opens.
  newThread?: boolean
  reason: string | null
  retryAt: number | null
  // The session has been seen on its picker since this message was refused for one.
  sawPicker: boolean
  // The session that took it, from the API's reply: its transcript is the one to find it in.
  sessionId: string | null
  state: OutboxState
  text: string
  // The thread it is routed to, when it was sent from a thread's view.
  threadId?: string
  to: string
  typedAt: string | null
  // An earlier try got no answer, or the API's own failure, so it may have landed: while it waits or after it fails, the session's transcript is read for it (matchDeliveries). It stays through every later wait, retry and failure, since none of them proves that try never landed.
  unanswered: boolean
  // How many tries in a row the API has not answered, so a restart gets its own window whatever came before it.
  unreached: number
}

export const MAX_ATTEMPTS = 20

// Pure: whether a message joined the outbox since the ids last seen. On a phone that brings the Chat tab forward: a send from the composer is there already, while Update now's from the sidebar is not (a reviewer's finding).
export const sentSince = (seen: ReadonlySet<string>, messages: { id: string }[]): boolean =>
  messages.some((m) => !seen.has(m.id))

// Refusals the API gives before typing anything, or with the message left pasted and unsent for a retry's Enter (INPUT_NOT_EMPTY, deliver.ts), which a later try can pass: the session is on a picker, its input holds a draft, its terminal stumbled reading it, the session is between lives, or the rate limit is full. These are retried on their own.
const AUTO_RETRY = new Set([
  "CMUX_FAILED",
  "INPUT_NOT_EMPTY",
  "NOT_FOUND",
  "ON_PICKER",
  "TOO_MANY_REQUESTS",
])

// No answer, one that is not the API's, or the API's own failure (deliver() throws when it cannot write its activity row, which can come after the Enter): the message may or may not have been typed, so once it fails only a person retries it, after a look at the session. The API's own failure fails at once; no answer is retried on its own first (UNREACHED).
const UNANSWERED = new Set(["INTERNAL_SERVER_ERROR", "NETWORK_ERROR", "UNKNOWN_ERROR"])

// No answer at all, or one that is not the API's, as while the dashboard restarts: each retry carries the message's id, which the API answers as delivered once its row is recorded, so these wait out about 2 minutes of tries in a row (2s, 4s, 8s, 16s, then 30s three times) before failing. Every try still counts toward the other waits' limit, so an API that keeps dropping in and out between them still runs out.
const UNREACHED = new Set(["NETWORK_ERROR", "UNKNOWN_ERROR"])
export const UNREACHED_ATTEMPTS = 8

// Whether a failed message offers Retry: one that ran out of tries on a refusal that can pass, or one whose fate is unknown. A message cut off while typing (INTERRUPTED) or refused for what it says offers Edit alone.
export const canRetry = (code: string | null): boolean =>
  code !== null && (AUTO_RETRY.has(code) || UNANSWERED.has(code))

// 2s, 4s, 8s, 16s, then every 30s.
export const retryDelay = (attempts: number): number =>
  Math.min(30_000, 2000 * 2 ** Math.max(0, attempts - 1))

// Why a message waits, in a few plain words, for each refusal the outbox retries; null for a code it has no words for. A session at its usage limit refuses as one on a prompt (deliver() types nothing into either), so `limited`, read from the board when the words are shown, tells the two apart.
export const waitWhy = (code: string, label: string, limited = false): string | null => {
  switch (code) {
    case "CMUX_FAILED":
      return "the terminal did not answer"
    case "INPUT_NOT_EMPTY":
      return `waiting for ${label}'s input to clear`
    case "NETWORK_ERROR":
      return "the server did not answer"
    case "NOT_FOUND":
      return `${label} is not live`
    case "ON_PICKER":
      return limited ? `${label} is at its usage limit` : `${label} is on a prompt`
    case "TOO_MANY_REQUESTS":
      return "too many messages this minute"
    case "UNKNOWN_ERROR":
      return "the server did not answer"
    default:
      return null
  }
}

// What a waiting bubble records about why, kept with the message: the code itself when it has no words.
export const waitReason = (code: string, label: string): string => waitWhy(code, label) ?? code

// Why a queued message waits, read afresh against the board, so a usage limit reads as one.
const queuedWhy = (message: OutboxMessage, limited: boolean): string | null =>
  message.code ? waitWhy(message.code, agentLabel(message.to), limited) : null

// The refusal's own code: a delivery's reason travels under `delivery`, inside the API's broader code (a CONFLICT that is ON_PICKER). An attachment that has left the folder is a NOT_FOUND too, but no retry brings it back, so it gets a code of its own.
export const refusalCode = (error: { code: string } & Record<string, unknown>): string =>
  error.attachment === "GONE"
    ? "ATTACHMENT_GONE"
    : typeof error.delivery === "string"
      ? error.delivery
      : error.code

export type OutboxAction =
  | { message: OutboxMessage; type: "add" }
  | { id: string; type: "cancel" }
  | { id: string; type: "dismiss" }
  | { id: string; type: "release" }
  | { id: string; type: "remove" }
  | { id: string; type: "retry" }
  | { id: string; type: "saw" }
  | { id: string; type: "sending" }
  | { at: string; id: string; sessionId: string; type: "typed" }
  | {
      attempts: number
      code: string
      id: string
      reason: string
      retryAt: number
      // the thread a New thread send opened and kept, its message left pasted and unsent, which the retry sends to
      threadId?: string
      type: "wait"
      unreached: number
    }
  | {
      attachments?: OutboxAttachment[]
      code: string
      id: string
      reason: string
      // the thread a New thread send opened and kept, as it was cut off while typing, which a Retry sends to
      threadId?: string
      type: "fail"
    }
  | { at: string; entryId: string; id: string; type: "delivered" }

type Fail = Extract<OutboxAction, { type: "fail" }>

// A failed message's files: the one the API says has gone (it names it under `id`) leaves the message and is named in the reason, so the bubble says which to attach again and Edit hands back the rest. Any other refusal leaves the files as they were.
export function failWithFiles(
  action: Fail,
  attachments: OutboxAttachment[],
  error: Record<string, unknown>,
): Fail {
  const gone =
    error.attachment === "GONE" && typeof error.id === "string"
      ? attachments.find((file) => file.id === error.id)
      : undefined
  if (!gone) return action
  return {
    ...action,
    attachments: attachments.filter((file) => file.id !== gone.id),
    reason: `${gone.name} is gone: files are kept for a week after they arrive. Attach it again.`,
  }
}

// The state each move starts from: a move that finds its message anywhere else is stale (a reply after a cancel, a release after the send began) and changes nothing.
const FROM: Record<Exclude<OutboxAction["type"], "add">, readonly OutboxState[]> = {
  cancel: ["queued"],
  // a request that went unanswered may still have landed, and its transcript then says so, a message still waiting to be sent again included
  delivered: ["typed", "failed", "queued"],
  dismiss: ["typed"],
  fail: ["sending"],
  release: ["queued"],
  remove: ["failed"],
  retry: ["failed"],
  saw: ["queued"],
  sending: ["queued"],
  typed: ["sending"],
  wait: ["sending"],
}

export function outboxReducer(messages: OutboxMessage[], action: OutboxAction): OutboxMessage[] {
  if (action.type === "add") return [...messages, action.message]
  const target = messages.find((m) => m.id === action.id)
  if (!target || !FROM[action.type].includes(target.state)) return messages
  if (action.type === "cancel" || action.type === "dismiss" || action.type === "remove") {
    return messages.filter((m) => m !== target)
  }
  return messages.map((m): OutboxMessage => {
    if (m !== target) return m
    switch (action.type) {
      // A picker answered starts the count over: its wait, however long, is not a failure.
      case "release":
        return { ...m, attempts: 0, retryAt: null, sawPicker: false }
      case "retry":
        return {
          ...m,
          attempts: 0,
          code: null,
          reason: null,
          retryAt: null,
          state: "queued",
          unreached: 0,
        }
      case "saw":
        return { ...m, sawPicker: true }
      case "sending":
        return { ...m, attempts: m.attempts + 1, state: "sending" }
      case "typed":
        return {
          ...m,
          code: null,
          reason: null,
          retryAt: null,
          sessionId: action.sessionId,
          state: "typed",
          typedAt: action.at,
        }
      case "wait":
        return {
          ...m,
          ...(action.threadId && { newThread: undefined, threadId: action.threadId }),
          attempts: action.attempts,
          code: action.code,
          reason: action.reason,
          retryAt: action.retryAt,
          sawPicker: false,
          state: "queued",
          unanswered: m.unanswered || UNANSWERED.has(action.code),
          unreached: action.unreached,
        }
      case "fail":
        return {
          ...m,
          ...(action.threadId && { newThread: undefined, threadId: action.threadId }),
          attachments: action.attachments ?? m.attachments,
          code: action.code,
          reason: action.reason,
          retryAt: null,
          state: "failed",
          unanswered: m.unanswered || UNANSWERED.has(action.code),
        }
      case "delivered":
        return { ...m, deliveredAt: action.at, entryId: action.entryId, state: "delivered" }
    }
  })
}

// What a refusal does to the message whose send it answers, at its attempts-th try: a refusal a later try can pass waits with backoff, a picker for as long as it takes (it is released once the picker is seen answered, and a person may take hours), and no answer for about 2 minutes of tries in a row, counted on their own; a draft waits like any other, after a try that came back with no answer too, since deliver() refuses it before typing anything (whether that try landed is kept as `unanswered`); anything else fails with the API's reason, and an unanswered request says to look before retrying. A picker's tries are its own (message.code is the last refusal's): the count starts over once the picker gives way to another reason, so hours on a picker cannot fail the refusal that follows, while every other reason shares one count, so two that take turns still run out. No answer counts its run of tries on its own (unreached), while each of its tries still counts toward the shared one.
export function onRefusal(
  message: Pick<OutboxMessage, "attempts" | "code" | "id" | "unreached">,
  error: { code: string; message: string },
  label: string,
  now: number,
): OutboxAction {
  const { code } = error
  const { id } = message
  const attempts = message.code === "ON_PICKER" && code !== "ON_PICKER" ? 1 : message.attempts
  const reason = waitReason(code, label)
  if (UNREACHED.has(code)) {
    const unreached = message.unreached + 1
    if (unreached < UNREACHED_ATTEMPTS) {
      const retryAt = now + retryDelay(unreached)
      return { attempts, code, id, reason, retryAt, type: "wait", unreached }
    }
  } else if (AUTO_RETRY.has(code) && (code === "ON_PICKER" || attempts < MAX_ATTEMPTS)) {
    const retryAt = now + retryDelay(attempts)
    return { attempts, code, id, reason, retryAt, type: "wait", unreached: 0 }
  }
  if (UNANSWERED.has(code)) {
    const unknown = `the server did not answer, so ${label} may have it already: look at its terminal before Retry`
    return { code, id, reason: unknown, type: "fail" }
  }
  return { code, id, reason: error.message, type: "fail" }
}

// One backslash before Enter reads as a line continuation in Claude Code's input, so a message ending in one would sit unsent with its bubble waiting; the composer drops it before the send. The end is judged trimmed, since the API's own normalize trims the ends before typing, and a drop that leaves another backslash (a double one) is the composer's refusal, not a second drop.
export const submittable = (text: string): string => {
  const end = text.trimEnd()
  return end.endsWith("\\") ? end.slice(0, -1) : text
}

// The message as the session's transcript will hold it: the API normalizes the text before typing it (line ends, tabs, control characters, the ends trimmed), so the match does the same.
export const comparable = (text: string): string =>
  [...text.replace(/\r\n?/g, "\n").replaceAll("\t", "    ")]
    .filter((ch) => ch === "\n" || !/\p{Cc}/u.test(ch))
    .join("")
    .trim()

// The transcript keeps at most this many characters of an entry, the last of them an ellipsis (api/hono's transcript.ts), while a message may run to twice that.
const HELD_CHARS = 4000

// Whether an entry's text is the sent text, whole or clipped as the transcript clips it.
export const sameText = (
  sent: string,
  held: string,
  clipped = held.length === HELD_CHARS,
): boolean => held === sent || (clipped && held.endsWith("…") && sent.startsWith(held.slice(0, -1)))

// A message cut off while typing may still have gone whole (a 30-line paste read failed after it landed), so the transcript can show it delivered too.
const CUT_OFF = "INTERRUPTED"

// When a message could have reached its session, if the transcript may hold it: from when it was written, for a typed message, one whose request went unanswered and one cut off while typing alike. Its entry never precedes that, while typedAt comes after the Enter, herdr's answer, the box's settle and the row's commit, which on a loaded machine run past the Enter's own stamp on a message queued mid-turn.
const reachableSince = (m: OutboxMessage): number | null => {
  if (m.state === "typed") return Date.parse(m.at)
  // still waiting to be sent again after a try that got no answer, which may have landed
  if (m.state === "queued" && m.unanswered) return Date.parse(m.at)
  if (
    m.state === "failed" &&
    (UNANSWERED.has(m.code ?? "") || m.code === CUT_OFF || m.unanswered)
  ) {
    return Date.parse(m.at)
  }
  return null
}

// Whether an entry carries the files a message was sent with, by id and in order: a message of files alone has no words to match on. An image Claude Code took in whose source line is not read yet has no id, so it stands for an image sent in its place, and nothing else.
export const sameFiles = (sent: OutboxAttachment[], held: Entry["attachments"]): boolean => {
  const files = held ?? []
  return (
    files.length === sent.length &&
    sent.every((file, i) =>
      files[i]?.id === null ? file.kind === "image" : file.id === files[i]?.id,
    )
  )
}

// The words as Claude Code keeps a paste that held an image path (measured on 2.1.304): split at a space before a path and at each line end, empty lines dropped, joined by line ends. herdr pastes a message whole, so a message with an image reaches its transcript so.
export const pastedWords = (text: string): string =>
  text
    .split(/ (?=\/|[A-Za-z]:\\)/)
    .flatMap((part) => part.split("\n"))
    .filter((part) => part.trim())
    .join("\n")

// The transcript entry a message became: a person's entry with the same text and files, written no earlier than the message could have reached the session, and not already claimed by another message. A message cut off while typing matches only its whole text, never the transcript's clipped copy, which part of it sent from the terminal could share.
export function findDelivery(
  message: OutboxMessage,
  entries: Entry[],
  claimed: Set<string>,
): Entry | null {
  const reachable = reachableSince(message)
  if (reachable === null) return null
  // no slack before it was written: after a reload, an earlier send of the same text whose record was not kept may have written one just before
  const since = reachable
  const sent = comparable(message.text)
  // a thread's message reaches the transcript with its marker first, which the match reads past, its clipping judged on the whole
  const marked = Boolean(message.threadId || message.newThread)
  const heldOf = (e: Entry) => {
    const whole = comparable(e.text)
    return {
      clipped: whole.length === HELD_CHARS,
      text: marked ? comparable(markerOf(whole).text) : whole,
    }
  }
  const texts = message.attachments.some((file) => file.kind === "image")
    ? [sent, comparable(pastedWords(sent))]
    : [sent]
  return (
    entries.find(
      (e) =>
        e.kind === "human" &&
        !claimed.has(e.id) &&
        Date.parse(e.at) >= since &&
        texts.some((text) => {
          const held = heldOf(e)
          return message.code === CUT_OFF
            ? text === held.text
            : sameText(text, held.text, held.clipped)
        }) &&
        sameFiles(message.attachments, e.attachments),
    ) ?? null
  )
}

// The messages the loaded entries show delivered, oldest first so two sends of the same text claim their entries in order. The entries are one session's: a typed message is matched against them when that session took it, and one whose request went unanswered (no session named in a reply) when it was sent to that session's name. Typed messages claim first, since an unanswered one may never have landed and must not take the entry of a later send of the same text.
export function matchDeliveries(
  messages: OutboxMessage[],
  entries: Entry[],
  session: { id: string; name: string } | null,
): { at: string; entryId: string; id: string }[] {
  if (!session) return []
  const claimed = new Set(messages.flatMap((m) => (m.entryId ? [m.entryId] : [])))
  const found: { at: string; entryId: string; id: string }[] = []
  const typed = messages.filter((m) => m.state === "typed" && m.sessionId === session.id)
  const unanswered = messages.filter(
    (m) =>
      (m.state === "failed" || (m.state === "queued" && m.unanswered)) && m.to === session.name,
  )
  for (const m of [...typed, ...unanswered]) {
    const entry = findDelivery(m, entries, claimed)
    if (!entry) continue
    claimed.add(entry.id)
    found.push({ at: entry.at, entryId: entry.id, id: m.id })
  }
  return found
}

// A session's next message to send or wait on: its first that is queued or sending, so its messages go in the order they were written.
const head = (messages: OutboxMessage[], to: string): OutboxMessage | undefined =>
  messages.find((m) => m.to === to && (m.state === "queued" || m.state === "sending"))

// The one message a session sends now: its head, when that is queued and due.
export function nextToSend(
  messages: OutboxMessage[],
  to: string,
  now: number,
): OutboxMessage | null {
  const next = head(messages, to)
  if (next?.state !== "queued") return null
  return next.retryAt === null || next.retryAt <= now ? next : null
}

// When the outbox next has something to do on its own: the earliest retry still ahead among the sessions' heads. A due head is sent at once, and a message behind another waits for that one to settle, so neither sets a timer.
export function nextWake(messages: OutboxMessage[], now: number): number | null {
  let wake: number | null = null
  for (const to of new Set(messages.map((m) => m.to))) {
    const next = head(messages, to)
    if (next?.state !== "queued" || next.retryAt === null || next.retryAt <= now) continue
    wake = wake === null ? next.retryAt : Math.min(wake, next.retryAt)
  }
  return wake
}

// Moves for messages held by a picker: one whose session is seen on the picker is marked, and a marked one is released once its session is seen off it. Seeing the picker first means a light that has not yet caught up with the refusal releases nothing.
export function pickerMoves(
  messages: OutboxMessage[],
  workers: Worker[] | null,
): { release: string[]; saw: string[] } {
  const moves = { release: [] as string[], saw: [] as string[] }
  for (const m of messages) {
    if (m.state !== "queued" || m.code !== "ON_PICKER") continue
    const worker = workers?.find((w) => w.name === m.to)
    if (!worker) continue
    if (worker.light === "needs-you") {
      if (!m.sawPicker) moves.saw.push(m.id)
    } else if (m.sawPicker) moves.release.push(m.id)
  }
  return moves
}

// What a bubble says about where its message is, as its state mark's hover and screen-reader words (statusMark), and no time: the time it was sent heads the message, and when it arrived is the footer's hover. A typed message waits in the session's input queue while the session works, which Claude Code holds until its turn ends, so it reads Queued, and the stream's activity line shows the session at work. The retry count is kept apart (retryNote), so a screen reader is not told each new try.
export function statusLine(
  message: OutboxMessage,
  {
    busy,
    label,
    limited = false,
    next,
  }: { busy: boolean; label: string; limited?: boolean; next: boolean },
): string {
  switch (message.state) {
    case "sending":
      return "Sending…"
    case "queued":
      if (message.reason) return `Queued: ${queuedWhy(message, limited) ?? message.reason}`
      return next ? "Sending…" : "Queued: waiting its turn"
    case "typed":
      return busy ? "Queued" : `Sent, waiting for ${label}`
    case "failed":
      return `Failed: ${message.reason ?? "not sent"}`
    case "delivered":
      return "Delivered"
  }
}

// The mark his footer draws for a state, in one fixed-width slot whatever the state: a spinner while on its way, one tick once typed, two once delivered; statusLine's words are its hover and its screen-reader text.
export type StatusMarkKind = "delivered" | "failed" | "sending" | "sent"

export const statusMark = (state: OutboxState): StatusMarkKind =>
  state === "queued" || state === "sending" ? "sending" : state === "typed" ? "sent" : state

// How long a message's Dismiss stays back once it is typed, so a state the send passes through in a moment never flashes its button (LIGHT_HOLD_MS holds a light the same way).
export const TYPED_HOLD_MS = 1000

// Whether a typed message has held its state long enough to offer Dismiss; a typedAt it does not know holds nothing back.
export const typedHeld = (typedAt: string | null, now: number): boolean =>
  typedAt === null || now - Date.parse(typedAt) >= TYPED_HOLD_MS

// The line Undo sends after his message: the session reads it as his next turn, and the stream reads only this exact line as a marker, never his own words.
export const UNSENT_MARKER =
  "[The user unsent their previous message: ignore it and anything you started because of it]"

export const isUnsentMarker = (text: string): boolean => text === UNSENT_MARKER

// How long after it arrived his newest message offers Undo.
export const UNDO_MS = 2 * 60_000

export type UndoState =
  | { kind: "failed"; marker: OutboxMessage; retry: boolean }
  | { kind: "undo" }
  | { kind: "unsending"; marker: OutboxMessage }
  | { kind: "unsent" }
  | null

// What a delivered message of his offers: Unsent once the transcript holds its marker; for his newest, an undo on its way (Unsending, with Unsend while it is still queued and Dismiss once typed) or one that failed (Discard, and Retry where a retry can pass, its message is still his newest and nothing waits behind it), else Undo for UNDO_MS after it arrived, while no other message to the session waits (its marker would land after that one and take it back instead).
export function undoState({
  marker,
  newest,
  now,
  sent,
  unsent,
  waiting,
}: {
  marker: OutboxMessage | null
  newest: boolean
  now: number
  sent: OutboxMessage | null
  unsent: boolean
  waiting: boolean
}): UndoState {
  if (unsent) return { kind: "unsent" }
  if (!sent?.deliveredAt) return null
  // an undo already sent stays on its message whatever came after, so it can be unsent or dismissed
  if (marker?.state === "failed") {
    return { kind: "failed", marker, retry: canRetry(marker.code) && newest && !waiting }
  }
  if (marker) return { kind: "unsending", marker }
  if (!newest || waiting) return null
  return now - Date.parse(sent.deliveredAt) < UNDO_MS ? { kind: "undo" } : null
}

// When his message reached the session: its outbox record's time, else its transcript time, since a reload keeps only unsent records and the transcript holds only what arrived.
export const deliveredAt = ({
  at,
  peer,
  sent,
}: {
  at: string | null
  peer: boolean
  sent: OutboxMessage | null
}): string | null => (peer ? null : (sent?.deliveredAt ?? at))

// Whether a message of his to the session is still on its way: anything the transcript does not hold yet, a failed one included, since one whose fate is unknown may still land. Undo's own markers are not counted.
export const othersWaiting = (messages: OutboxMessage[]): boolean =>
  messages.some((m) => m.state !== "delivered" && !isUnsentMarker(m.text))

// The undo sent for a delivered message: the newest marker sent while it was his last to have arrived.
export function undoOf(messages: OutboxMessage[], sent: OutboxMessage): OutboxMessage | null {
  const arrived = (m: OutboxMessage) => !isUnsentMarker(m.text) && m.deliveredAt !== null
  // a marker is sent for his message that arrived last before it, since Undo is offered only there
  const forSent = (marker: OutboxMessage) =>
    messages
      .filter((m) => arrived(m) && (m.deliveredAt ?? "") <= marker.at)
      .reduce<OutboxMessage | null>(
        (last, m) => (!last || (m.deliveredAt ?? "") > (last.deliveredAt ?? "") ? m : last),
        null,
      )?.id === sent.id
  return messages.findLast((m) => isUnsentMarker(m.text) && forSent(m)) ?? null
}

// A refused message's try count, then why it waits after a dot, or the count alone when the outbox has no words for its code; none for a message nothing has refused, such as one a reload caught mid-send.
export function retryNote(message: OutboxMessage, limited = false): string | null {
  if (message.state !== "queued" || message.attempts === 0 || !message.code) return null
  const why = queuedWhy(message, limited)
  return why ? `retry ${message.attempts} · ${why}` : `retry ${message.attempts}`
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null)
const count = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0

// The messages a tab kept unsent when its page reloaded (a dashboard restart reloads it too), queued again to go at once under the same id, which the API answers as delivered if an earlier try got through. Each field is read on its own, since newer code may read what older code wrote, and a file's preview, a URL of the page that is gone, is dropped.
export function resumable(saved: unknown): OutboxMessage[] {
  if (!Array.isArray(saved)) return []
  return saved.flatMap((item: Record<string, unknown> | null): OutboxMessage[] => {
    const id = text(item?.id)
    const to = text(item?.to)
    const words = text(item?.text)
    const threadId = text(item?.threadId)
    if (!item || !id || !to || words === null || !Array.isArray(item.attachments)) return []
    const attachments = item.attachments.flatMap(
      (file: Record<string, unknown> | null): OutboxAttachment[] => {
        const kind = file?.kind
        const fileId = text(file?.id)
        const name = text(file?.name)
        if (!fileId || !name || (kind !== "image" && kind !== "pdf" && kind !== "text")) return []
        return [{ id: fileId, kind, name, previewUrl: null, size: count(file?.size) }]
      },
    )
    if (attachments.length !== item.attachments.length) return []
    return [
      {
        at: text(item.at) ?? new Date().toISOString(),
        attachments,
        attempts: count(item.attempts),
        code: text(item.code),
        deliveredAt: null,
        entryId: null,
        id,
        ...(item.newThread === true ? { newThread: true } : {}),
        reason: text(item.reason),
        retryAt: null,
        sawPicker: false,
        sessionId: null,
        state: "queued",
        text: words,
        ...(threadId ? { threadId } : {}),
        to,
        typedAt: null,
        // a record saved before the mark existed still says its tries went unanswered, and one saved while its request was out may have landed
        unanswered:
          item.unanswered === true || count(item.unreached) > 0 || item.state === "sending",
        unreached: count(item.unreached),
      },
    ]
  })
}

// Whether the message is its session's head, the one the outbox sends or waits on next.
export const isNext = (messages: OutboxMessage[], message: OutboxMessage): boolean =>
  head(messages, message.to)?.id === message.id

// Messages still on their way to a session, oldest first: everything not yet delivered, failed or dismissed.
export const waiting = (messages: OutboxMessage[], to: string): OutboxMessage[] =>
  messages.filter(
    (m) =>
      m.to === to &&
      !isUnsentMarker(m.text) &&
      (m.state === "queued" || m.state === "sending" || m.state === "typed"),
  )
