import { appendFile } from "node:fs/promises"
import { join } from "node:path"

import { secretIn } from "@packages/settings"

import { type Stuck, WAIT_S } from "../ops-job/dispatcher"
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
  // a line to a session by its name, through the ops relay
  relay: (to: string, text: string) => Promise<unknown>
  sleep: (ms: number) => Promise<void>
}
// WhatsApp mode's reads, and the reply it sends while it is off, so a test hands in fakes.
export type Mode = {
  assistant: () => Promise<string | undefined>
  busy: () => Promise<boolean>
  log: (line: string) => void
  // whether WhatsApp mode is on: the bundled whatsapp extension's switch in Settings, Extensions
  on: () => Promise<boolean>
  reply: (body: string) => Promise<string>
  stuck: () => Promise<Stuck>
}
// Door 2: what goes back over WhatsApp is factory status alone.
export const REPLY =
  "Answer with factory status alone, no org work, secret or customer data, through playground wa send <file>."

// A number's chat id, as Baileys names a phone number's 1:1 chat.
export const jidOf = (e164: string) => `${e164.replace(/^\+/, "")}@s.whatsapp.net`

export const OFF =
  "WhatsApp mode is off, so this message goes no further. Turn it on in Playground's Settings, under Extensions."
export const UPDATE = `WhatsApp mode: send the owner an update on the factory's work now. ${REPLY}`
export const UPDATE_MS = 15 * 60_000

// Each state file has one writer: owner.json and handed.json the bridge's queue, sends.json the sender's chain, so no write drops another's.
const ownerFile = (dir: string) => join(dir, "owner.json")
const sendsFile = (dir: string) => join(dir, "sends.json")
const handedFile = (dir: string) => join(dir, "handed.json")
// bravo marks a message past its hand-on to the assistant seat, so it goes once.
type Handed = { at: number; bravo?: true; line: string }
type Watch = { handed?: Handed[]; offAt?: number; updateAt?: number }

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

async function inbound(io: Io & Mode, m: Incoming) {
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
  const watch = await readOwn<Watch>(handedFile(io.dir), {})
  if (!(await io.on())) {
    // one reply an hour at most, so a run of messages while it is off gets one answer; offAt is written first, so a failed reply waits out the hour too
    if (at - (watch.offAt ?? 0) < HOUR) return
    await writeOwn(handedFile(io.dir), { ...watch, offAt: at })
    await io.reply(OFF).catch((error: Error) => io.log(`ops-wa: the off reply: ${error.message}`))
    return
  }
  const when = new Date(at).toISOString()
  const line = text
    ? `The owner's WhatsApp at ${when} reads: ${text}\n${REPLY}`
    : `The owner's WhatsApp at ${when} holds ${media}, which ops-wa does not read yet: say so to the owner.\n${REPLY}`
  await io.relay("dispatcher", line)
  await writeOwn(handedFile(io.dir), { ...watch, handed: [...(watch.handed ?? []), { at, line }] })
}

// One pass while WhatsApp mode is on: a message with no send after it in 3 minutes while the dispatcher is not mid-turn, or any while it has read stuck or failed, goes to the session in the assistant seat too (else the log says it stays with the dispatcher); and every 15 minutes while the owner has written in the last 24 hours, the dispatcher is asked for an update.
async function pass(io: Io & Mode) {
  const now = io.now()
  const watch = await readOwn<Watch>(handedFile(io.dir), {})
  const handed = (watch.handed ?? []).filter((h) => now - h.at < HOUR)
  // the file is written however the pass ends, so a relay that throws keeps the marks of those sent before it
  try {
    if (await io.on()) {
      const sends = (await readOwn<{ sends?: number[] }>(sendsFile(io.dir), {})).sends ?? []
      const waiting = handed.filter((h) => !h.bravo && !sends.some((at) => at >= h.at))
      const blocked = waiting.length > 0 ? await io.stuck() : null
      const working = !blocked && waiting.length > 0 && (await io.busy())
      const due = waiting.filter((h) => blocked || (now - h.at >= WAIT_S * 1000 && !working))
      const to = due.length > 0 ? await io.assistant() : undefined
      for (const h of due) {
        if (!to) {
          io.log(
            `ops-wa: no live session holds the assistant seat, so the owner's WhatsApp at ${new Date(h.at).toISOString()} stays with the dispatcher alone`,
          )
        } else {
          const why = blocked
            ? `the dispatcher has read ${blocked.state} since ${blocked.at}`
            : `no reply has gone out in ${WAIT_S / 60} minutes`
          await io.relay(to, `Handed on since ${why}. ${h.line}`)
        }
        h.bravo = true
      }
      const { ownerAt } = await readOwn<{ ownerAt?: number }>(ownerFile(io.dir), {})
      if (
        ownerAt !== undefined &&
        now - ownerAt <= OWNER_WINDOW_MS &&
        now - Math.max(watch.updateAt ?? 0, ownerAt) >= UPDATE_MS
      ) {
        await io.relay("dispatcher", UPDATE)
        watch.updateAt = now
      }
    }
  } finally {
    await ownFolder(io.dir)
    await writeOwn(handedFile(io.dir), { ...watch, handed })
  }
}

// The bridge, one per process, so its one queue writes its state files across every reconnect: attach listens on a socket, where each new 1:1 message from the owner goes to the dispatcher while WhatsApp mode is on and every other message and call is dropped and logged, one at a time in the order they came; pass queues the failover and update check; idle waits for the queue to empty.
export function bridge(io: Io & Mode) {
  let chain = Promise.resolve()
  const queue = (job: () => Promise<unknown>) => {
    chain = chain.then(job).then(
      () => {},
      (error: Error) => io.log(`ops-wa: a message was not handed on: ${error.message}`),
    )
  }
  return {
    attach: (sock: Sock) => {
      sock.ev.on("messages.upsert", ({ messages, type }) => {
        if (type !== "notify") return
        for (const m of messages) queue(() => inbound(io, m))
      })
      sock.ev.on("call", (calls) => {
        for (const c of calls) if (c.status === "offer") queue(() => drop(io, "call", c.from))
      })
    },
    idle: () => chain,
    pass: () => queue(() => pass(io)),
  }
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
export function sender(io: Omit<Io, "relay"> & { sock: Sock }) {
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
    const kept = await readOwn<{ sends?: number[] }>(sendsFile(io.dir), {})
    const sends = (kept.sends ?? []).filter((at) => now - at < HOUR)
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
