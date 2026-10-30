"use client"

import { Chat } from "@ai-sdk/react"
import type { Entry, EntryAttachment, Worker } from "@api/hono"
import { useQueryClient } from "@tanstack/react-query"
import type { ChatTransport, DynamicToolUIPart, FileUIPart, UIMessage, UIMessageChunk } from "ai"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

import { attachmentUrl } from "@/lib/attachments"
import { sendMessage, toolLabel } from "@/lib/dashboard"
import { INBOX_QUERY_KEY } from "@/lib/inbox"
import {
  failWithFiles,
  isUnsentMarker,
  matchDeliveries,
  nextToSend,
  nextWake,
  onRefusal,
  outboxReducer,
  pickerMoves,
  refusalCode,
  resumable,
  type OutboxAction,
  type OutboxAttachment,
  type OutboxMessage,
} from "@/lib/outbox"
import { TYPED } from "@/lib/reply"

// What a session's step says beyond its parts: when it was written, who wrote it (a peer's name), and for a message sent from here, where the outbox has it.
export type DashboardMetadata = {
  at: string
  // A turn whose newest step ended it (stop_reason end_turn): the reply has stopped.
  ended?: true
  from: string | null
  kind: "assistant" | "human" | "peer"
  outbox?: OutboxMessage
  // A turn's steps, the entry each of its parts came from, in order: a part's name, which stays as the turn's oldest steps are dropped.
  steps?: string[]
  // His message that an Undo marker after it took back.
  unsent?: true
}

export type DashboardMessage = UIMessage<DashboardMetadata>

// A tool call as the transcript keeps it: its one-line summary and its input as indented JSON, both clipped.
export type DashboardToolInput = { json: string; summary: string }

// What a call returned, clipped, and for an Agent call the subagent that ran it.
export type DashboardToolOutput = { agentId: string | null; text: string }

export type DashboardToolPart = DynamicToolUIPart & { input: DashboardToolInput }

// The tools whose run is a subagent's, shown as a Task with that subagent's steps inside.
export const SUBAGENT_TOOLS = new Set(["Agent", "Task"])

// Whether a subagent's run is still going: its call has no result yet, or it went to the background and its session's tasks still list it running.
export const subagentRunning = (
  part: DashboardToolPart,
  tasks: Pick<Worker["tasks"][number], "id" | "state">[],
): boolean =>
  part.state === "input-available" ||
  part.state === "input-streaming" ||
  tasks.some((task) => task.id === part.toolCallId && task.state === "running")

const MEDIA_TYPES: Record<string, string> = {
  gif: "image/gif",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  webp: "image/webp",
}

// A file a message carries, as a file part: its URL only when the id is one the API gives, so a transcript never points the page at another file.
export function filePart(file: EntryAttachment): FileUIPart | null {
  if (file.id === null) return null
  const url = attachmentUrl(file.id)
  if (!url) return null
  const extension = file.id.split(".").pop() ?? ""
  return { filename: file.id, mediaType: MEDIA_TYPES[extension] ?? "text/plain", type: "file", url }
}

const toolPart = (entry: Entry): DashboardToolPart => ({
  input: { json: entry.input ?? "", summary: entry.text },
  state: "input-available",
  title: toolLabel(entry.tool),
  toolCallId: entry.toolUseId ?? entry.id,
  toolName: entry.tool ?? "",
  type: "dynamic-tool",
})

// Pure: a session's steps as chat messages. What a person or a peer said is a user message of its words and files; everything the session did between two of those (its thinking, its words, each tool call) is one assistant message, its parts in order, named for its first step, with each part's step in `metadata.steps` (withTranscript keeps a turn's name as its first step changes). A result fills in the call it answers, wherever that call is, and one whose call is not loaded is left out.
export function toUIMessages(entries: Entry[]): DashboardMessage[] {
  const messages: DashboardMessage[] = []
  const calls = new Map<
    string,
    { index: number; message: DashboardMessage; part: DashboardToolPart }
  >()
  let turn: DashboardMessage | null = null
  for (const entry of entries) {
    // Undo's marker shows as no message: it marks his message before it unsent
    if (entry.kind === "human" && isUnsentMarker(entry.text) && !entry.attachments?.length) {
      const target = messages.findLast((m) => m.metadata?.kind === "human")
      if (target?.metadata) target.metadata = { ...target.metadata, unsent: true }
      turn = null
      continue
    }
    if (entry.kind === "human" || entry.kind === "peer") {
      const files = (entry.attachments ?? []).flatMap((file) => filePart(file) ?? [])
      messages.push({
        id: entry.id,
        metadata: { at: entry.at, from: entry.from, kind: entry.kind },
        parts: [...(entry.text ? [{ text: entry.text, type: "text" as const }] : []), ...files],
        role: "user",
      })
      turn = null
      continue
    }
    if (entry.kind === "result") {
      const call = entry.toolUseId ? calls.get(entry.toolUseId) : undefined
      if (!call) continue
      const { input, title, toolCallId, toolName } = call.part
      const base = { input, title, toolCallId, toolName, type: "dynamic-tool" as const }
      const output: DashboardToolOutput = { agentId: entry.agentId ?? null, text: entry.text }
      call.message.parts[call.index] = entry.isError
        ? { ...base, errorText: entry.text, state: "output-error" }
        : { ...base, output, state: "output-available" }
      continue
    }
    if (!turn) {
      turn = {
        id: entry.id,
        metadata: { at: entry.at, from: null, kind: "assistant", steps: [] },
        parts: [],
        role: "assistant",
      }
      messages.push(turn)
    }
    turn.metadata?.steps?.push(entry.id)
    if (turn.metadata) {
      if (entry.endsTurn) turn.metadata.ended = true
      else delete turn.metadata.ended
    }
    if (entry.kind === "assistant") turn.parts.push({ text: entry.text, type: "text" })
    else if (entry.kind === "reasoning") turn.parts.push({ text: entry.text, type: "reasoning" })
    else {
      const part = toolPart(entry)
      calls.set(part.toolCallId, { index: turn.parts.length, message: turn, part })
      turn.parts.push(part)
    }
  }
  return messages
}

// Pure: a message's files as the transcript names them, back from its file parts.
export const attachmentsOf = (message: DashboardMessage): EntryAttachment[] =>
  message.parts.flatMap((part) =>
    part.type === "file" && part.filename
      ? [
          {
            id: part.filename,
            kind: part.mediaType.startsWith("image/")
              ? ("image" as const)
              : part.mediaType === "application/pdf"
                ? ("pdf" as const)
                : ("text" as const),
          },
        ]
      : [],
  )

// Pure: the words of a message, its text parts joined.
export const textOf = (message: DashboardMessage): string =>
  message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n")

// Pure: the messages the outbox carries, in the order they were written.
export const outboxOf = (messages: DashboardMessage[]): OutboxMessage[] =>
  messages.flatMap((m) => (m.metadata?.outbox ? [m.metadata.outbox] : []))

// A message sent from here as the chat holds it: its words, with its place in the outbox as metadata.
export const outboxMessage = (record: OutboxMessage): DashboardMessage => ({
  id: record.id,
  metadata: { at: record.at, from: null, kind: "human", outbox: record },
  parts: [{ text: record.text, type: "text" }],
  role: "user",
})

// Pure: an outbox move applied to a chat's messages: the outbox's own reducer decides it, over the messages that carry an outbox record, and each record it changes, adds or drops is written back in place. A stale move leaves the messages as they were.
export function applyOutbox(
  messages: DashboardMessage[],
  action: OutboxAction,
): DashboardMessage[] {
  const before = outboxOf(messages)
  const after = outboxReducer(before, action)
  if (after === before) return messages
  const next = new Map(after.map((record) => [record.id, record]))
  const kept = messages.flatMap((m) => {
    const record = m.metadata?.outbox
    if (!record) return [m]
    const changed = next.get(record.id)
    next.delete(record.id)
    if (!changed) return []
    return [changed === record ? m : outboxMessage(changed)]
  })
  return [...kept, ...[...next.values()].map(outboxMessage)]
}

// Pure: a session's transcript as the chat holds it, followed by the messages the outbox still carries, in their order.
export const withTranscript = (
  messages: DashboardMessage[],
  transcript: DashboardMessage[],
): DashboardMessage[] => [
  ...keepTurnIds(messages, transcript),
  ...messages.filter((m) => m.metadata?.outbox),
]

// Pure: each turn keeps the name it had when it holds a step it held before, as the stream drops its oldest steps or Load older brings in earlier ones, so its row and an opened tool row in it are never drawn anew.
export function keepTurnIds(
  previous: DashboardMessage[],
  transcript: DashboardMessage[],
): DashboardMessage[] {
  const named = new Map<string, string>()
  for (const message of previous)
    for (const step of message.metadata?.steps ?? []) named.set(step, message.id)
  // a name another message has of its own stays its own
  const own = new Set(transcript.map((message) => message.id))
  const taken = new Set<string>()
  return transcript.map((message) => {
    const kept = message.metadata?.steps?.map((step) => named.get(step)).find(Boolean)
    const id =
      kept && !taken.has(kept) && (kept === message.id || !own.has(kept)) ? kept : message.id
    taken.add(id)
    return id === message.id ? message : { ...message, id }
  })
}

const finished = (): ReadableStream<UIMessageChunk> =>
  new ReadableStream({ start: (controller) => controller.close() })

type Send = typeof sendMessage

// A send that refreshes the inbox once a message naming an item (`re #iN`) is typed, when the API has recorded the reply, so the item leaves the open list and the count at once rather than on the next poll, as the inbox's own buttons do.
export const refreshingReplies =
  (send: Send, refresh: () => void): Send =>
  async (...args) => {
    const result = await send(...args)
    if (result.data && TYPED.test(args[1])) refresh()
    return result
  }

// The tab's own storage, where unsent messages wait out a page reload; none on the server, or where the browser refuses it.
type OutboxStorage = Pick<Storage, "getItem" | "setItem">

const OUTBOX_KEY = "outbox"

const tabStorage = (): OutboxStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage
  } catch {
    return null
  }
}

// The dashboard's chats, one per session by name, kept for the whole dashboard so messages on their way survive moving between sessions. Each chat's messages are the one store: the selected session's transcript, and every message sent from here with its outbox record as metadata. A message goes out through the chat (sendMessage, then the transport), each session's one at a time and in order, a refusal that can pass retried with the outbox's backoff, and a picker's wait released as soon as the picker is seen answered.
export class DashboardChats {
  private readonly chats = new Map<string, Chat<DashboardMessage>>()
  private readonly listeners = new Set<() => void>()
  private readonly label: (name: string) => string
  private resumed = false
  private readonly send: Send
  private readonly storage: OutboxStorage | null
  private version = 0
  private readonly transport: ChatTransport<DashboardMessage>

  constructor({
    label,
    send = sendMessage,
    storage = null,
  }: {
    label: (name: string) => string
    send?: Send
    storage?: OutboxStorage | null
  }) {
    this.label = label
    this.send = send
    this.storage = storage
    // sendMessages answers when deliver() has typed the message, or the message has settled without it (failed for good, cancelled); the reply is no stream, since it reaches the transcript and the socket on its own time.
    this.transport = {
      reconnectToStream: async () => null,
      sendMessages: async ({ chatId, messages }) => {
        const sent = messages.at(-1)
        if (sent) await this.run(chatId, sent.id)
        return finished()
      },
    }
  }

  chat(to: string): Chat<DashboardMessage> {
    let chat = this.chats.get(to)
    if (!chat) {
      chat = new Chat<DashboardMessage>({ id: to, transport: this.transport })
      this.chats.set(to, chat)
    }
    return chat
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed() {
    this.version += 1
    this.save()
    for (const listener of this.listeners) listener()
  }

  // Keeps the messages still on their way in the tab's storage, once what an earlier page kept there has been read back. An Undo's marker is not kept: after a reload nothing shows it or could unsend it.
  private save() {
    if (!this.storage || !this.resumed) return
    const unsent = this.outbox().filter(
      (m) => (m.state === "queued" || m.state === "sending") && !isUnsentMarker(m.text),
    )
    try {
      this.storage.setItem(OUTBOX_KEY, JSON.stringify(unsent))
    } catch {}
  }

  // Sends again what the tab's page held unsent when it reloaded, each under its own id, so one an earlier try got through is answered as delivered rather than typed twice.
  resume() {
    if (this.resumed) return
    this.resumed = true
    let saved: unknown = null
    try {
      saved = JSON.parse(this.storage?.getItem(OUTBOX_KEY) ?? "null")
    } catch {}
    const held = new Set(this.outbox().map((m) => m.id))
    for (const record of resumable(saved)) {
      if (!held.has(record.id)) this.enqueue(record)
    }
    this.save()
  }

  private read: { list: OutboxMessage[]; version: number } | null = null

  // Every message the outbox carries, across sessions: the same list until the store changes, so a view that depends on it reruns only then.
  outbox = (): OutboxMessage[] => {
    if (this.read?.version !== this.version) {
      const list = [...this.chats.values()].flatMap((chat) => outboxOf(chat.messages))
      this.read = { list, version: this.version }
    }
    return this.read.list
  }

  dispatch(to: string, action: OutboxAction) {
    const chat = this.chat(to)
    const next = applyOutbox(chat.messages, action)
    if (next === chat.messages) return
    chat.messages = next
    this.changed()
  }

  // The session's transcript replaces the one the chat held, the outbox's messages kept after it.
  setTranscript(to: string, transcript: DashboardMessage[]) {
    const chat = this.chat(to)
    chat.messages = withTranscript(chat.messages, transcript)
    this.changed()
  }

  // A new message shows at once, queued, and goes out through the chat.
  post(
    to: string,
    {
      attachments,
      newThread,
      text,
      threadId,
    }: { attachments: OutboxAttachment[]; newThread?: boolean; text: string; threadId?: string },
  ) {
    const record: OutboxMessage = {
      at: new Date().toISOString(),
      attachments,
      attempts: 0,
      code: null,
      deliveredAt: null,
      entryId: null,
      id: crypto.randomUUID(),
      ...(newThread ? { newThread } : {}),
      reason: null,
      retryAt: null,
      sawPicker: false,
      sessionId: null,
      state: "queued",
      text,
      ...(threadId ? { threadId } : {}),
      to,
      typedAt: null,
      unanswered: false,
      unreached: 0,
    }
    this.enqueue(record)
  }

  private enqueue(record: OutboxMessage) {
    const last = this.posted.get(record.to)
    if (!isUnsentMarker(record.text) && (!last || record.at > last)) {
      this.posted.set(record.to, record.at)
    }
    // the chat pushes the message before its first await, so the store has changed by the time this returns
    void this.chat(record.to).sendMessage(outboxMessage(record))
    this.changed()
  }

  private readonly posted = new Map<string, string>()

  // When this page last sent the session a message of his, an Undo's marker aside, kept whatever leaves the outbox after (a typed message dismissed may still land), so Undo is offered only on that last one.
  lastPosted(to: string): string | null {
    return this.posted.get(to) ?? null
  }

  // A failed message dropped for good, from the outbox and its session's chat.
  discard(to: string, id: string) {
    this.dispatch(to, { id, type: "remove" })
  }

  // A failed message queued again in its place, sent by the same loop a new one is.
  retry(to: string, id: string) {
    this.dispatch(to, { id, type: "retry" })
    void this.run(to, id)
  }

  // Waits until the message is its session's next to send and due, and marks it sending in the same step, so a cancel can never land between the two; false when it left the queue instead (cancelled, or failed elsewhere).
  private turn(to: string, id: string): Promise<boolean> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null
      let settled = false
      // stops listening before anything else, since marking it sending notifies every listener, this one included
      const settle = () => {
        settled = true
        unsubscribe()
        if (timer) clearTimeout(timer)
      }
      const check = () => {
        if (settled) return
        const all = outboxOf(this.chat(to).messages)
        const mine = all.find((m) => m.id === id)
        if (mine?.state !== "queued") {
          settle()
          return resolve(false)
        }
        const now = Date.now()
        if (nextToSend(all, to, now)?.id === id) {
          settle()
          this.dispatch(to, { id, type: "sending" })
          return resolve(true)
        }
        if (timer) clearTimeout(timer)
        const wake = nextWake(all, now)
        timer = wake === null ? null : setTimeout(check, wake - now)
      }
      const unsubscribe = this.subscribe(check)
      check()
    })
  }

  // One message's way to its session: its turn, then deliver() through the API, then typed, a wait before another try, or failed.
  async run(to: string, id: string): Promise<void> {
    while (await this.turn(to, id)) {
      const message = outboxOf(this.chat(to).messages).find((m) => m.id === id)
      if (!message) return
      const files = message.attachments.map((file) => file.id)
      const { data, error } = await this.send(to, message.text, files, id, {
        newThread: message.newThread,
        threadId: message.threadId,
      })
      if (data) {
        this.dispatch(to, { at: data.at, id, sessionId: data.sessionId, type: "typed" })
        return
      }
      const sent = {
        attempts: message.attempts,
        code: message.code,
        id,
        unreached: message.unreached,
      }
      const refusal = { code: refusalCode(error), message: error.message }
      const action = onRefusal(sent, refusal, this.label(to), Date.now())
      const kept = typeof error.threadId === "string" ? error.threadId : undefined
      this.dispatch(
        to,
        action.type === "fail"
          ? {
              ...failWithFiles(action, message.attachments, error),
              ...(kept && { threadId: kept }),
            }
          : { ...action, ...(kept && { threadId: kept }) },
      )
      if (action.type === "fail") return
    }
  }
}

export type Outbox = {
  // Whether the message was cancelled: once its request is out it is too late.
  cancel: (id: string) => boolean
  clearDraft: () => void
  // Drops a failed message for good.
  discard: (id: string) => void
  // Drops a typed message that will not be matched (its session ended, it was pulled back out of the queue): it may still arrive, and the transcript would show it.
  dismiss: (id: string) => void
  // Words handed to the composer, a failed message's by Edit, cleared once the composer takes it.
  draft: { attachments: OutboxAttachment[]; text: string; to: string } | null
  edit: (id: string) => void
  // Every message on its way or sent from here, across sessions, read from the chats.
  messages: OutboxMessage[]
  retry: (id: string) => void
  send: (
    to: string,
    message: {
      attachments: OutboxAttachment[]
      newThread?: boolean
      text: string
      threadId?: string
    },
  ) => void
}

// One session's steps as the dashboard reads them: its entries, and the session they are of (none while nothing is read).
export type ChatStream = { entries: Entry[]; sessionId: string | null; sessionName: string | null }

// The dashboard's chats and the outbox over them, for the whole dashboard. Each stream read (Playground's, and the selected session's when it is another) goes into its chat before the page paints, so its stream reads one list; a message held by a picker is released once the picker is seen answered, and a typed one turns delivered when its session's transcript holds it. labelOf names a session in a waiting bubble's reason, read once.
export function useDashboardChats(
  workers: Worker[] | null,
  dispatcher: ChatStream,
  selected: ChatStream,
  labelOf: (name: string) => string,
): { chats: DashboardChats; outbox: Outbox } {
  const queryClient = useQueryClient()
  const [chats] = useState(
    () =>
      new DashboardChats({
        label: labelOf,
        send: refreshingReplies(
          sendMessage,
          () => void queryClient.invalidateQueries({ queryKey: INBOX_QUERY_KEY }),
        ),
        storage: tabStorage(),
      }),
  )
  const [draft, setDraft] = useState<Outbox["draft"]>(null)
  // the store's list is its snapshot, the same array until it changes, so React rereads it on every change and never between
  const messages = useSyncExternalStore(chats.subscribe, chats.outbox, chats.outbox)
  useStreamIn(chats, messages, dispatcher)
  useStreamIn(chats, messages, selected)

  useEffect(() => chats.resume(), [chats])

  useEffect(() => {
    const { release, saw } = pickerMoves(messages, workers)
    const to = (id: string) => messages.find((m) => m.id === id)?.to ?? ""
    for (const id of saw) chats.dispatch(to(id), { id, type: "saw" })
    for (const id of release) chats.dispatch(to(id), { id, type: "release" })
  }, [chats, messages, workers])

  const toOf = useCallback(
    (id: string) => chats.outbox().find((m) => m.id === id)?.to ?? null,
    [chats],
  )

  // the same object until its draft or messages move, so the dashboard's context holds across a render that changed neither
  const outbox = useMemo<Outbox>(
    () => ({
      cancel: (id) => {
        const to = toOf(id)
        const message = chats.outbox().find((m) => m.id === id)
        if (!to || message?.state !== "queued") return false
        chats.dispatch(to, { id, type: "cancel" })
        return true
      },
      clearDraft: () => setDraft(null),
      discard: (id) => {
        const to = toOf(id)
        if (to) chats.discard(to, id)
      },
      dismiss: (id) => {
        const to = toOf(id)
        if (to) chats.dispatch(to, { id, type: "dismiss" })
      },
      draft,
      edit: (id) => {
        const message = chats.outbox().find((m) => m.id === id)
        if (!message || message.state !== "failed") return
        chats.dispatch(message.to, { id, type: "remove" })
        setDraft({ attachments: message.attachments, text: message.text, to: message.to })
      },
      messages,
      retry: (id) => {
        const to = toOf(id)
        if (to) chats.retry(to, id)
      },
      send: (to, message) => chats.post(to, message),
    }),
    [chats, draft, messages, toOf],
  )
  return { chats, outbox }
}

// Pure: the chat a stream's transcript goes into, none while it reads no session, so an empty slot naming the session the other slot reads never blanks his chat.
export const transcriptFor = ({ sessionId, sessionName }: ChatStream): string | null =>
  sessionId ? sessionName : null

// One stream's transcript into its session's chat, and each message it holds marked delivered.
function useStreamIn(chats: DashboardChats, messages: OutboxMessage[], stream: ChatStream) {
  const { entries, sessionId, sessionName } = stream
  const transcript = useMemo(() => toUIMessages(entries), [entries])
  const into = transcriptFor(stream)
  useLayoutEffect(() => {
    if (into) chats.setTranscript(into, transcript)
  }, [chats, into, transcript])
  // before paint, so a delivered entry takes its pending bubble's row in the same frame: a frame holding both drew an extra row above his message and nudged the view down and back
  useLayoutEffect(() => {
    if (!sessionId || !sessionName) return
    for (const found of matchDeliveries(messages, entries, { id: sessionId, name: sessionName })) {
      const to = messages.find((m) => m.id === found.id)?.to ?? sessionName
      chats.dispatch(to, { ...found, type: "delivered" })
    }
  }, [chats, entries, messages, sessionId, sessionName])
}
