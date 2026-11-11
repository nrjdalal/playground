import { appendFile } from "node:fs/promises"
import { join } from "node:path"

import { secretIn } from "@packages/settings"

import { HOUR, OWNER_WINDOW_MS, ownFolder, readOwn, SEND, writeOwn } from "./habits"

type Key = {
  fromMe?: boolean | null
  participant?: string | null
  remoteJid?: string | null
  remoteJidAlt?: string | null
}
export type Incoming = { key: Key; message?: Record<string, unknown> | null }
export type Upsert = { messages: Incoming[]; type: string }
export type Call = { from: string; status: string }
type Events = { call: Call[]; "messages.upsert": Upsert }
// The calls ops-wa makes on a Baileys socket, so a test hands it a fake one.
export type Sock = {
  ev: { on<K extends keyof Events>(name: K, fn: (arg: Events[K]) => void): void }
  sendMessage(jid: string, content: { linkPreview: null; text: string }): Promise<unknown>
}
export type Io = {
  // <data>/whatsapp
  dir: string
  now: () => number
  // the owner's number in E.164, the allowlist of one
  owner: string
  relay: (text: string) => Promise<unknown>
  sleep: (ms: number) => Promise<void>
  sock: Sock
}
// Door 2: what goes back over WhatsApp is factory status alone.
export const REPLY =
  "Answer with factory status alone, no org work, secret or customer data, through playground wa send <file>."

// A number's chat id, as Baileys names a phone number's 1:1 chat.
export const jidOf = (e164: string) => `${e164.replace(/^\+/, "")}@s.whatsapp.net`

// Each state file has one writer: owner.json the listener's queue, sends.json the sender's chain, so neither write drops the other's.
const ownerFile = (dir: string) => join(dir, "owner.json")
const sendsFile = (dir: string) => join(dir, "sends.json")

// The kind of chat a message came from that is no 1:1 chat, which ops-wa drops.
const chatKind = (jid: string): string | undefined => {
  if (jid.endsWith("@g.us")) return "group"
  if (jid === "status@broadcast") return "status"
  if (jid.endsWith("@broadcast")) return "broadcast"
  if (jid.endsWith("@newsletter")) return "newsletter"
}

// What the dispatcher hears of a message with no text: its kind alone, never its content.
const MEDIA: Record<string, string> = {
  audioMessage: "a voice note",
  contactMessage: "a contact",
  documentMessage: "a document",
  imageMessage: "an image",
  locationMessage: "a location",
  stickerMessage: "a sticker",
  videoMessage: "a video",
}

const textOf = (message: Record<string, unknown>): string | undefined => {
  if (typeof message.conversation === "string" && message.conversation) return message.conversation
  const extended = message.extendedTextMessage as { text?: unknown } | undefined
  if (typeof extended?.text === "string" && extended.text) return extended.text
}

// One line in dropped.log: the time, the kind and the sender's last 4 digits, never the words or the whole number.
async function drop(io: Io, kind: string, from: string) {
  await ownFolder(io.dir)
  const digits = (from.split("@")[0] ?? "").split(":")[0]!.replace(/\D/g, "")
  await appendFile(
    join(io.dir, "dropped.log"),
    `${new Date(io.now()).toISOString()} ${kind} ...${digits.slice(-4)}\n`,
    { mode: 0o600 },
  )
}

async function inbound(io: Io, m: Incoming) {
  const { fromMe, participant, remoteJid, remoteJidAlt } = m.key
  if (fromMe || !remoteJid) return
  const kind = chatKind(remoteJid)
  if (kind) return drop(io, kind, participant ?? remoteJid)
  const owner = jidOf(io.owner)
  if (remoteJid !== owner && remoteJidAlt !== owner) return drop(io, "stranger", remoteJid)
  const message = m.message ?? {}
  const text = textOf(message)
  const media = Object.keys(message)
    .map((k) => MEDIA[k])
    .find(Boolean)
  if (!text && !media) return
  const at = io.now()
  await ownFolder(io.dir)
  await writeOwn(ownerFile(io.dir), { ownerAt: at })
  const when = new Date(at).toISOString()
  await io.relay(
    text
      ? `The owner's WhatsApp at ${when} reads: ${text}\n${REPLY}`
      : `The owner's WhatsApp at ${when} holds ${media}, which ops-wa does not read yet: say so to the owner.\n${REPLY}`,
  )
}

// Listens on the socket: each new 1:1 message from the owner goes to the relay, every other message and every call is dropped and logged, one at a time in the order they came; it answers a wait for the queue to empty.
export function attach(io: Io): () => Promise<void> {
  let chain = Promise.resolve()
  const queue = (job: () => Promise<unknown>) => {
    chain = chain.then(job).then(
      () => {},
      (error: Error) => console.error(`ops-wa: a message was not handed on: ${error.message}`),
    )
  }
  io.sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return
    for (const m of messages) queue(() => inbound(io, m))
  })
  io.sock.ev.on("call", (calls) => {
    for (const c of calls) if (c.status === "offer") queue(() => drop(io, "call", c.from))
  })
  return () => chain
}

// Markdown as WhatsApp marks it: headings and bold as *bold*, __x__ as _x_, a link as its text and URL; a fenced block stays as it is.
export const toWhatsApp = (md: string): string =>
  md
    .split(/(```[\s\S]*?```)/)
    .map((piece, i) =>
      i % 2 === 1
        ? piece
        : piece
            .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
            .replace(/\*\*(.+?)\*\*/g, "*$1*")
            .replace(/__(.+?)__/g, "_$1_")
            .replace(/\[([^\]]+)\]\((\S+?)\)/g, "$1 ($2)"),
    )
    .join("")

// A body in parts of at most SEND.partChars, split between paragraphs where it can.
const split = (text: string): string[] => {
  const parts: string[] = []
  for (const para of text.split("\n\n")) {
    const last = parts.at(-1)
    if (last !== undefined && last.length + 2 + para.length <= SEND.partChars)
      parts[parts.length - 1] = `${last}\n\n${para}`
    else
      for (let i = 0; i < Math.max(1, para.length); i += SEND.partChars)
        parts.push(para.slice(i, i + SEND.partChars))
  }
  return parts
}

// Why a body never goes out, or undefined: phase 1 refuses a token shape (door 2's line), and any later filter sits in front of this one.
export const refusalOf = (body: string): string | undefined => {
  const secret = secretIn(body)
  if (secret) return `the body holds ${secret}, which never goes over WhatsApp`
}

// The send wa send reaches: to the owner's number alone, one send at a time, a second apart and 300 ms between a split body's parts, at most 60 an hour, and only within 24 hours of the owner's last message, since ops-wa never starts a chat.
export function sender(io: Omit<Io, "relay">) {
  let chain: Promise<unknown> = Promise.resolve()
  let last = 0
  const sendNow = async (body: string): Promise<string> => {
    const refusal = refusalOf(body)
    if (refusal) throw new Error(refusal)
    const { ownerAt } = await readOwn<{ ownerAt?: number }>(ownerFile(io.dir), {})
    const now = io.now()
    if (ownerAt === undefined || now - ownerAt > OWNER_WINDOW_MS)
      throw new Error(
        "the owner has not written in the last 24 hours, and ops-wa never starts a chat",
      )
    const parts = split(toWhatsApp(body))
    const sends = (
      await readOwn<{ sends: number[] }>(sendsFile(io.dir), { sends: [] })
    ).sends.filter((at) => now - at < HOUR)
    if (sends.length + parts.length > SEND.perHour) {
      const frees = new Date(Math.min(...sends, now) + HOUR).toISOString().slice(11, 16)
      throw new Error(`the hourly cap of ${SEND.perHour} sends is reached until ${frees}Z`)
    }
    for (const [k, part] of parts.entries()) {
      const wait = last + (k === 0 ? SEND.gapMs : SEND.partGapMs) - io.now()
      if (last > 0 && wait > 0) await io.sleep(wait)
      await io.sock.sendMessage(jidOf(io.owner), { linkPreview: null, text: part })
      last = io.now()
      sends.push(last)
      await writeOwn(sendsFile(io.dir), { sends })
    }
    return "sent"
  }
  return (body: string): Promise<string> => {
    const run = chain.then(() => sendNow(body))
    chain = run.catch(() => {})
    return run
  }
}
