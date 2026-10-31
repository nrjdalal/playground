import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

import type { Database } from "@packages/db"
import { env } from "@packages/env/api-hono"
import { approvePath, type Channel, type Message } from "@packages/message"

import { postItem } from "@/lib/dashboard/inbox"
import { dataDir } from "@/lib/sessions/paths"
import type { YardClient } from "@/lib/yard/client"
import { keychain } from "@/lib/yard/keychain"
import { mentionsOf } from "@/lib/yard/tier"

// What Yard sends this Playground's owner reaches the Inbox here, every message as untrusted data: its words in a fenced block, so a link shows and never opens, and none is ever run.

export const YARD_FROM = "Yard"
export const POLL_MS = 60_000

export type Card = {
  from: string
  kind: "update"
  preview: { approve?: string; outcome: "decision" | "finding"; text: string }
  title: string
}

const place = (channel: Channel) =>
  channel.kind === "dm" ? `a DM with @${channel.peer?.login ?? channel.name}` : `#${channel.name}`

// The message's words and links as one fenced block, its fence longer than any run of tildes inside, so nothing in it renders as markdown.
export const untrusted = (message: Message, channel: Channel): string => {
  const body = [message.text, ...(message.links ?? [])].join("\n")
  const fence = "~".repeat(Math.max(3, ...[...body.matchAll(/~+/g)].map((m) => m[0].length + 1)))
  return `@${message.from.login} (${message.from.device}) in ${place(channel)}, as ${message.kind}:\n\n${fence}text\n${body}\n${fence}`
}

// Whether an inbound message calls on the owner, decided by its channel's kind, so a new kind (`self`, for remote work) adds one branch here.
const CALLS_ON: Record<Channel["kind"], (message: Message, login: string) => boolean> = {
  channel: (message, login) => mentionsOf(message.text).includes(login.toLowerCase()),
  dm: (message, login) => mentionsOf(message.text).includes(login.toLowerCase()),
}

// The Inbox card for a message someone else sent that calls on the owner, or null.
export const inboundCard = (message: Message, channel: Channel, login: string): Card | null => {
  if (message.from.login.toLowerCase() === login.toLowerCase()) return null
  if ((message.status ?? "sent") !== "sent" || !CALLS_ON[channel.kind](message, login)) return null
  return {
    from: YARD_FROM,
    kind: "update",
    preview: { outcome: "finding", text: untrusted(message, channel) },
    title: `@${message.from.login} mentioned you in ${place(channel)}`,
  }
}

// The Inbox card for the owner's own post that Yard holds pending: its Approve opens Yard's approve page in the browser, since a token never approves.
export const pendingCard = (message: Message, channel: Channel, web: string): Card => ({
  from: YARD_FROM,
  kind: "update",
  preview: {
    approve: new URL(approvePath(message.id), web).href,
    outcome: "decision",
    text: untrusted(message, channel),
  },
  title: `Your ${message.kind} post in ${place(channel)} waits for your approval on Yard`,
})

// Posts a card; one whose words the Inbox refuses (a Slack token, an archives link) goes in without them, so the owner still hears of it.
export const postCard = async (db: Database, card: Card): Promise<void> => {
  const posted = await postItem(db, card)
  if (posted.ok) return
  const { text: _, ...rest } = card.preview
  await postItem(db, {
    ...card,
    preview: { ...rest, text: "Its words are not shown here: open Yard to read them." },
  })
}

type Marks = Record<string, string>

// The newest message time this Playground has carded per channel, in the data folder, so a restart never cards a mention twice.
const marksFile = () => join(dataDir(), "yard", "mentions.json")

export async function pollMentions(
  client: YardClient,
  post: (card: Card) => Promise<void>,
  file = marksFile(),
  now = new Date(),
): Promise<number> {
  const { login } = await client.me()
  const stored = Bun.file(file)
  const first = !(await stored.exists())
  const marks: Marks = first ? {} : await stored.json().catch(() => ({}))
  let carded = 0
  for (const channel of await client.channels()) {
    const since = marks[channel.id] ?? (first ? now.toISOString() : new Date(0).toISOString())
    if (channel.mentions === 0 || first) {
      marks[channel.id] =
        channel.lastMessageAt && channel.lastMessageAt > since ? channel.lastMessageAt : since
      continue
    }
    const { messages } = await client.messages(channel.id, { limit: 100 })
    for (const message of messages.filter((m) => m.at > since)) {
      const card = inboundCard(message, channel, login)
      if (card) {
        await post(card)
        carded++
      }
      if (message.at > (marks[channel.id] ?? since)) marks[channel.id] = message.at
    }
    marks[channel.id] ??= since
  }
  mkdirSync(dirname(file), { recursive: true })
  await Bun.write(file, `${JSON.stringify(marks)}\n`)
  return carded
}

// Polls Yard for mentions once a minute while the local API runs with YARD_API_URL set and a token in the Keychain; a failed poll waits for the next.
export function startYardPoll(
  db: Database,
  client: (base: string, token: string) => YardClient,
): void {
  if (!env.YARD_API_URL) return
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const token = await keychain().read()
      if (token && env.YARD_API_URL)
        await pollMentions(client(env.YARD_API_URL, token), (card) => postCard(db, card))
    } catch (error) {
      console.error("[yard] mention poll failed", error)
    } finally {
      running = false
    }
  }
  setInterval(() => void tick(), POLL_MS).unref?.()
  void tick()
}
