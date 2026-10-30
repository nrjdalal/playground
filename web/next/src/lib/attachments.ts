import type { AttachmentKind } from "@api/hono"

import { apiClient, unwrap } from "@/lib/api/client"
import { retryDelay, UNREACHED_ATTEMPTS, type OutboxAttachment } from "@/lib/outbox"

// The API keeps at most this many files with one message, each at most this large, and refuses more; the composer says so before uploading.
export const MAX_FILES = 5
export const MAX_FILE_BYTES = 10 * 1024 * 1024

// Every extension the API gives a kept file (its EXTENSIONS in api/hono/src/lib/dashboard/attachments.ts, which a test holds this to): the images, the PDF, and the text kinds it keeps under their own name.
export const ATTACHMENT_EXTENSIONS = [
  "c",
  "cpp",
  "css",
  "csv",
  "diff",
  "gif",
  "go",
  "h",
  "html",
  "java",
  "jpg",
  "js",
  "json",
  "jsonl",
  "jsx",
  "kt",
  "log",
  "md",
  "mjs",
  "patch",
  "pdf",
  "png",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "webp",
  "xml",
  "yaml",
  "yml",
] as const

// The only ids the API gives, so the only ones the dashboard builds a URL from: a UUID and one of those extensions. Anything else, from a transcript or anywhere, gets no link and no image.
const ATTACHMENT_ID = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:${ATTACHMENT_EXTENSIONS.join("|")})$`,
)

export const isAttachmentId = (id: string): boolean => ATTACHMENT_ID.test(id)

// What the picker offers: the types and extensions the API keeps, each extension listed, since a system can map one (.ts) to another type. The API tells a file by its bytes, so this only narrows the dialog.
export const ACCEPT = [
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/*",
  ...ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`),
].join(",")

// The image types a browser can draw as a chip's thumbnail before the upload is done.
export const PREVIEWABLE = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"])

// A file's size as the chips show it, in the binary units the dashboard's activity row uses.
export const byteLabel = (bytes: number): string => {
  const kilobytes = Math.max(1, Math.round(bytes / 1024))
  return kilobytes < 1024 ? `${kilobytes} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const kindLabel = (kind: AttachmentKind): string =>
  kind === "image" ? "Image" : kind === "pdf" ? "PDF" : "Text"

const room = (held: number) => Math.max(0, MAX_FILES - held)

// The files that fit beside the ones already attached: too large ones are left out by name, and past the count the rest are counted.
export const fitFiles = (
  held: number,
  files: File[],
): { dropped: number; taken: File[]; tooLarge: string[] } => {
  const sized = files.filter((file) => file.size <= MAX_FILE_BYTES)
  const taken = sized.slice(0, room(held))
  return {
    dropped: sized.length - taken.length,
    taken,
    tooLarge: files.filter((file) => file.size > MAX_FILE_BYTES).map((file) => file.name),
  }
}

// The same for files Edit hands back, which are already uploaded.
export const fitRefs = (
  held: number,
  refs: OutboxAttachment[],
): { dropped: number; taken: OutboxAttachment[] } => {
  const taken = refs.slice(0, room(held))
  return { dropped: refs.length - taken.length, taken }
}

// Whether a paste's files are what was pasted: when it carries no text, or only the files' own names (a copy in Finder, a name a line). A paste with real text beside an image (cells from a spreadsheet, a slide) is the text.
export const pasteTakesFiles = (text: string, names: string[]): boolean =>
  text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .every((line) => names.includes(line))

// An upload with no answer, as while the dashboard restarts (a 5xx included): it waits out the outbox's own 2 minutes of backoff (2s, 4s, 8s, 16s, then 30s), then fails with Retry. Unlike a message, whose send may have landed, an upload is safe to send again: the worst is a second copy the folder's weekly sweep removes.
const UPLOAD_RETRY = new Set(["INTERNAL_SERVER_ERROR", "NETWORK_ERROR", "UNKNOWN_ERROR"])

// Pure: what the tries-th failed upload does next: wait that many milliseconds and try again, fail with Retry once no answer has come for the whole window, or be refused for good (a file the API will not keep).
export const uploadWait = (code: string, tries: number): number | "failed" | "refused" =>
  !UPLOAD_RETRY.has(code) ? "refused" : tries < UNREACHED_ATTEMPTS ? retryDelay(tries) : "failed"

// Why a file not uploaded yet is not uploading: it waits between tries, or its tries ran out.
export type UploadWait = "failed" | "queued" | null

// A file in the composer: uploading until ref arrives, queued between tries that got no answer, failed once they run out. preview is a blob: URL of a picked image, or the server's URL for a file Edit handed back.
export type Held = {
  key: string
  name: string
  preview: string | null
  ref: OutboxAttachment | null
  size: number
  wait: UploadWait
}

export type HeldAction =
  | { items: Held[]; type: "add" }
  | { type: "clear" }
  | { key: string; type: "remove" }
  | { key: string; ref: OutboxAttachment; type: "settle" }
  | { key: string; type: "wait"; wait: UploadWait }

// The composer's files as uploads start, finish and are removed. An upload that finishes after its file was removed changes nothing.
export function heldReducer(items: Held[], action: HeldAction): Held[] {
  switch (action.type) {
    case "add":
      return [...items, ...action.items]
    case "clear":
      return []
    case "remove":
      return items.filter((h) => h.key !== action.key)
    case "settle":
      return items.some((h) => h.key === action.key)
        ? items.map((h) => (h.key === action.key ? { ...h, ref: action.ref, wait: null } : h))
        : items
    case "wait":
      return items.map((h) => (h.key === action.key ? { ...h, wait: action.wait } : h))
  }
}

// Keeps one file in the dashboard's attachments folder, for a message to carry by its id. A file removed while it uploads aborts its request.
export async function uploadAttachment(file: File, signal?: AbortSignal) {
  return unwrap(apiClient.v1.attachments.$post({ form: { file } }, { init: { signal } }))
}

// Where the dashboard serves an attachment, for an image's src or a file's link, or null for an id the API would not give. The API is the dashboard's own site, so the browser sends the session cookie with it.
export const attachmentUrl = (id: string): string | null =>
  isAttachmentId(id) ? apiClient.v1.attachments[":id"].$url({ param: { id } }).toString() : null
