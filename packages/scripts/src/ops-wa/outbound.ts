import { lstat, realpath } from "node:fs/promises"
import { basename, extname, join, sep } from "node:path"

import type { AnyMessageContent } from "baileys"

// The one folder wa send takes a file from, beside the media folder and outside whatsapp/, so a file goes over WhatsApp only once a session has put it there (ADR 0036).
export const outboxDir = (data: string) => join(data, "wa", "outbox")

type Kind = "audio" | "document" | "image" | "video"
// Each file type wa send takes, by its extension, and the mime WhatsApp is told; a text document is read for a token shape as a body is, and any other type is refused.
const TYPES: Record<string, { kind: Kind; mimetype: string; text?: true }> = {
  csv: { kind: "document", mimetype: "text/csv", text: true },
  jpeg: { kind: "image", mimetype: "image/jpeg" },
  jpg: { kind: "image", mimetype: "image/jpeg" },
  json: { kind: "document", mimetype: "application/json", text: true },
  md: { kind: "document", mimetype: "text/markdown", text: true },
  mp4: { kind: "video", mimetype: "video/mp4" },
  ogg: { kind: "audio", mimetype: "audio/ogg; codecs=opus" },
  opus: { kind: "audio", mimetype: "audio/ogg; codecs=opus" },
  pdf: { kind: "document", mimetype: "application/pdf" },
  png: { kind: "image", mimetype: "image/png" },
  txt: { kind: "document", mimetype: "text/plain", text: true },
}
const TYPE_NAMES = Object.keys(TYPES).join(", ")

// What ops-wa sends, each shape one Baileys takes (Fits checks it): text, an image, a video or a document with its caption, an audio file as a voice note, which takes none, a poll of one choice, whose secret ops-wa makes itself so it can read the owner's vote, or a reaction on a kept message.
type Fits<T extends AnyMessageContent> = T
export type Content = Fits<
  | { linkPreview: null; text: string }
  | { caption?: string; image: Buffer; mimetype: string }
  | { caption?: string; mimetype: string; video: Buffer }
  | { caption?: string; document: Buffer; fileName: string; mimetype: string }
  | { audio: Buffer; mimetype: string; ptt: true }
  | { poll: { messageSecret: Uint8Array; name: string; selectableCount: 1; values: string[] } }
  | { react: { key: { fromMe: false; id: string; remoteJid: string }; text: string } }
>

export type Outbound = { bytes: Buffer; kind: Kind; mimetype: string; name: string; text?: string }

// A file wa send names, read whole: refused unless its real path is a regular file in the outbox, of a type TYPES names.
export async function readOutbound(outbox: string, path: string): Promise<Outbound> {
  const type = TYPES[extname(path).slice(1).toLowerCase()]
  if (!type) throw new Error(`wa send takes a file of these types alone: ${TYPE_NAMES}`)
  const [real, root] = await Promise.all([
    realpath(path).catch(() => ""),
    realpath(outbox).catch(() => ""),
  ])
  if (!real || !root || !real.startsWith(root + sep))
    throw new Error(`wa send takes a file from ${outbox} alone`)
  if (!(await lstat(real)).isFile()) throw new Error("wa send takes a regular file alone")
  const bytes = Buffer.from(await Bun.file(real).arrayBuffer())
  const name = basename(real)
  const { kind, mimetype } = type
  return { bytes, kind, mimetype, name, ...(type.text && { text: bytes.toString("utf8") }) }
}

// The messages one send is, in order: a file with a caption goes first, carrying the body's first part as it, and the rest follow as text; a voice note takes no caption, so the body goes before it as text.
export const messagesOf = (parts: string[], file?: Outbound): Content[] => {
  const text = parts.filter(Boolean).map((part): Content => ({ linkPreview: null, text: part }))
  if (!file) return text
  const { bytes, mimetype } = file
  if (file.kind === "audio") return [...text, { audio: bytes, mimetype, ptt: true }]
  const caption = parts.find(Boolean)
  const media: Content =
    file.kind === "image"
      ? { caption, image: bytes, mimetype }
      : file.kind === "video"
        ? { caption, mimetype, video: bytes }
        : { caption, document: bytes, fileName: file.name, mimetype }
  return [media, ...text.slice(caption === undefined ? 0 : 1)]
}
