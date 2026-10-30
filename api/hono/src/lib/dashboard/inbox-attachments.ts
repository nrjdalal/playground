import { realpath, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, sep } from "node:path"

import { z } from "zod"

// Relative, not @/: bun run ask runs this from any shell.
import { dataDir } from "../sessions/paths"
import {
  attachmentsDir,
  kindOf,
  MAX_ATTACHMENT_BYTES,
  sniff,
  storeAttachment,
  TOO_LARGE_REASON,
} from "./attachments"
import {
  type InboxAttachmentKind,
  attachmentSourceSchema,
  type InboxAttachment,
  MAX_INBOX_ATTACHMENTS,
  zodMessage,
} from "./inbox"

// A file's kind by its extension, when its poster names none.
export const KIND_OF_EXTENSION: Record<string, InboxAttachmentKind> = {
  css: "code",
  diff: "code",
  gif: "image",
  htm: "html",
  html: "html",
  jpeg: "image",
  jpg: "image",
  js: "code",
  json: "code",
  md: "doc",
  pdf: "pdf",
  png: "image",
  py: "code",
  sh: "code",
  sql: "code",
  ts: "code",
  tsx: "code",
  txt: "doc",
  webp: "image",
  yaml: "code",
  yml: "code",
}

// What the attachments folder's sniff tells a file's bytes as (attachments.ts kindOf), for each kind an ask can carry.
const STORED_AS: Record<InboxAttachmentKind, ReturnType<typeof kindOf>> = {
  code: "text",
  doc: "text",
  html: "text",
  image: "image",
  pdf: "pdf",
}

// Whether a file sits inside the folder, its symlinks and the folder's resolved first, so a link cannot point out of it.
async function inside(src: string, folder: string): Promise<boolean> {
  const [real, root] = await Promise.all(
    [realpath(src), realpath(folder)].map((p) => p.catch(() => null)),
  )
  return Boolean(real && root && real.startsWith(root + sep))
}

type Kept = { input: unknown; ok: true } | { message: string; ok: false }

const sourcesSchema = z.array(attachmentSourceSchema).min(1).max(MAX_INBOX_ATTACHMENTS)

// bun run ask's step before posting: each file an ask's or a read-only update's preview names is checked, all of them first, then copied into the attachments folder, and the item keeps the copies' ids in place of the paths. Any other item, or one with none, passes as it is; the item's own schema judges the rest.
export async function keepAttachments(
  input: unknown,
  { data = dataDir(), dir = attachmentsDir() }: { data?: string; dir?: string } = {},
): Promise<Kept> {
  const preview = (input as { preview?: { attachments?: unknown } } | null)?.preview
  if (!preview || typeof preview !== "object" || !("attachments" in preview)) {
    return { input, ok: true }
  }
  const parsed = sourcesSchema.safeParse(preview.attachments)
  if (!parsed.success) {
    return { message: `preview.attachments: ${zodMessage(parsed.error)}`, ok: false }
  }
  const checked: {
    bytes: Uint8Array
    kind: InboxAttachmentKind
    source: (typeof parsed.data)[number]
  }[] = []
  for (const source of parsed.data) {
    const { src } = source
    if (!isAbsolute(src)) return { message: `${src}: give the file's absolute path`, ok: false }
    const kind = source.kind ?? KIND_OF_EXTENSION[extname(src).slice(1).toLowerCase()]
    if (!kind)
      return { message: `${src}: name its kind (${Object.keys(STORED_AS).join(", ")})`, ok: false }
    const info = await stat(src).catch(() => null)
    if (!info?.isFile()) return { message: `${src}: no such file`, ok: false }
    // an HTML page runs its own script in the viewer, so it comes only from the dashboard's data folder, which holds the previews folder `playground page` keeps pages in
    if (kind === "html" && !(await inside(src, data))) {
      return { message: `${src}: an HTML page is taken only from ${data}`, ok: false }
    }
    if (info.size > MAX_ATTACHMENT_BYTES)
      return { message: `${src}: ${TOO_LARGE_REASON}`, ok: false }
    const bytes = await Bun.file(src)
      .arrayBuffer()
      .then((buffer) => new Uint8Array(buffer))
      .catch(() => null)
    if (!bytes) return { message: `${src}: it cannot be read`, ok: false }
    const extension = sniff(bytes, basename(src))
    if (!extension || kindOf(`x.${extension}`) !== STORED_AS[kind]) {
      return { message: `${src}: its bytes do not match its kind, ${kind}`, ok: false }
    }
    checked.push({ bytes, kind, source })
  }
  const attachments: InboxAttachment[] = []
  for (const { bytes, kind, source } of checked) {
    const stored = await storeAttachment(bytes, basename(source.src), { dir })
    if (!stored.ok) return { message: `${source.src}: ${stored.reason}`, ok: false }
    const name = basename(source.src)
    attachments.push({
      ...(source.group && { group: source.group }),
      id: stored.id,
      kind,
      ...(source.label && { label: source.label }),
      name,
    })
  }
  return { input: { ...(input as object), preview: { ...preview, attachments } }, ok: true }
}
