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

// The message's sender line, words and links as one fenced block, its fence longer than any run of tildes inside, so nothing a member wrote, their token's name included, renders as markdown.
export const untrusted = (message: Message, channel: Channel): string => {
  const body = [
    `@${message.from.login} (${message.from.device}) in ${place(channel)}, as ${message.kind}:`,
    message.text,
    ...(message.links ?? []),
  ].join("\n")
  const fence = "~".repeat(Math.max(3, ...[...body.matchAll(/~+/g)].map((m) => m[0].length + 1)))
  return `${fence}text\n${body}\n${fence}`
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

// The Inbox card for the owner's own post that Yard holds pending, from this Mac's sidebar, its terminal or any of their devices: its Approve opens Yard's approve page in the browser, since a token never approves.
export const pendingCard = (message: Message, channel: Channel, web: string | undefined): Card => ({
  from: YARD_FROM,
  kind: "update",
  preview: {
    ...(web ? { approve: new URL(approvePath(message.id), web).href } : {}),
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

// The newest time this Playground has carded, in the data folder, so a restart never cards a message twice.
const marksFile = () => join(dataDir(), "yard", "mentions.json")

const saveMark = async (file: string, since: string) => {
  mkdirSync(dirname(file), { recursive: true })
  await Bun.write(file, `${JSON.stringify({ since })}\n`)
}

// Cards what waits on the owner since the last mark, oldest first by when it showed: each mention, a thread's reply or an approved held post included, and each post of theirs Yard holds. It saves the mark after each card, so a failed post retries from the first one not carded. The first run only sets the mark.
export async function pollWaiting(
  client: YardClient,
  post: (card: Card) => Promise<void>,
  web: string | undefined,
  file = marksFile(),
  now = new Date(),
): Promise<number> {
  const stored = Bun.file(file)
  const mark = (await stored.exists())
    ? ((await stored.json().catch(() => ({}))) as { since?: unknown }).since
    : undefined
  if (typeof mark !== "string") {
    await saveMark(file, now.toISOString())
    return 0
  }
  const due = await client.waiting(mark)
  if (!due.length) return 0
  const { login } = await client.me()
  const channels = new Map((await client.channels()).map((channel) => [channel.id, channel]))
  let carded = 0
  for (const { held, message, shownAt } of due) {
    const channel = channels.get(message.channel)
    const card =
      channel && (held ? pendingCard(message, channel, web) : inboundCard(message, channel, login))
    if (card) {
      await post(card)
      carded++
    }
    await saveMark(file, shownAt)
  }
  return carded
}

// Polls Yard once a minute while the local API runs with YARD_API_URL set and a token in the Keychain; a failed poll waits for the next.
export function startYardPoll(
  db: Database,
  client: (base: string, token: string) => YardClient,
): void {
  const api = env.YARD_API_URL
  if (!api) return
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const token = await keychain().read()
      if (token)
        await pollWaiting(client(api, token), (card) => postCard(db, card), env.YARD_WEB_URL)
    } catch (error) {
      console.error("[yard] poll failed", error)
    } finally {
      running = false
    }
  }
  setInterval(() => void tick(), POLL_MS).unref?.()
  void tick()
}
