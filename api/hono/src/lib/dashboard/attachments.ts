import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, readdir, unlink } from "node:fs/promises"
import { basename, dirname, extname, join, resolve } from "node:path"

// Relative, not @/: the web's tests import this file.
import { dataDir, livePath } from "../sessions/paths"

// What a session can Read: an image its Read tool shows, a PDF, or text.
export type AttachmentKind = "image" | "pdf" | "text"

// A stored file as the dashboard hands it to deliver(): its id (its name in the attachments folder), its kind, its absolute path and its size in bytes.
export type Attachment = { id: string; kind: AttachmentKind; path: string; size: number }

// A file as a transcript entry names it: enough for the dashboard to fetch it by id, never a path. An image Claude Code took in from a pasted path has a null id until the line naming its source is read beside it.
export type EntryAttachment = { id: string; kind: AttachmentKind } | { id: null; kind: "image" }

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS = 5
export const MAX_FOLDER_BYTES = 1024 * 1024 * 1024
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const SWEEP_EVERY_MS = 60 * 60 * 1000

export const IMAGE_EXTENSIONS = ["gif", "jpg", "png", "webp"] as const
const TEXT_EXTENSIONS = new Set([
  "c",
  "cpp",
  "css",
  "csv",
  "diff",
  "go",
  "h",
  "html",
  "java",
  "js",
  "json",
  "jsonl",
  "jsx",
  "kt",
  "log",
  "md",
  "mjs",
  "patch",
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
  "xml",
  "yaml",
  "yml",
])

// Every extension a kept file can have; the web's picker and its id check are held to this list by a test.
export const EXTENSIONS = [...IMAGE_EXTENSIONS, "pdf", ...TEXT_EXTENSIONS]

// The only names the dashboard gives a file, and so the only ids it takes back: a random UUID and an extension it chose. A name like this holds no / and no .., so it cannot reach outside the folder.
export const ID_PATTERN = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:${EXTENSIONS.join("|")})$`,
)

const extensionOf = (id: string): string => extname(id).slice(1)

export const kindOf = (id: string): AttachmentKind => {
  const extension = extensionOf(id)
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return "image"
  return extension === "pdf" ? "pdf" : "text"
}

const CONTENT_TYPES: Record<string, string> = {
  gif: "image/gif",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  webp: "image/webp",
}

// How the dashboard serves a file: an image as itself, a PDF as one, and text as plain text, whatever it holds.
export const contentType = (id: string): string =>
  CONTENT_TYPES[extensionOf(id)] ?? "text/plain; charset=utf-8"

// The folder files are kept in: $PLAYGROUND_ATTACHMENTS_DIR when set (a live-reads test stack's scratch folder), else attachments in the dashboard's data folder; a fixture stack keeps them in its fixture's folder whatever is set.
export const attachmentsDir = (): string =>
  resolve(livePath("PLAYGROUND_ATTACHMENTS_DIR") || join(dataDir(), "attachments"))

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const holds = (bytes: Uint8Array, at: number, expected: string | number[]): boolean =>
  (typeof expected === "string" ? [...expected].map((ch) => ch.charCodeAt(0)) : expected).every(
    (byte, i) => bytes[at + i] === byte,
  )

// Tab, line feed, form feed, carriage return and escape (a coloured log) are the control bytes text holds; any other one, NUL included, marks a binary file.
export const TEXT_CONTROLS = new Set([0x09, 0x0a, 0x0c, 0x0d, 0x1b])

const isText = (bytes: Uint8Array): boolean => {
  if (bytes.some((byte) => byte < 0x20 && !TEXT_CONTROLS.has(byte))) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

// The extension a file is kept under, told by its bytes rather than the name or type the browser sent: a raster image (never SVG, which can carry script), a PDF, or UTF-8 text with no control byte but the ones text holds, which keeps its own extension when that is on the text list and is .txt otherwise. Null for anything else.
export function sniff(bytes: Uint8Array, name: string): string | null {
  if (holds(bytes, 0, PNG)) return "png"
  if (holds(bytes, 0, [0xff, 0xd8, 0xff])) return "jpg"
  if (holds(bytes, 0, "GIF87a") || holds(bytes, 0, "GIF89a")) return "gif"
  if (holds(bytes, 0, "RIFF") && holds(bytes, 8, "WEBP")) return "webp"
  if (holds(bytes, 0, "%PDF-")) return "pdf"
  if (!isText(bytes)) return null
  const extension = extname(name).slice(1).toLowerCase()
  return TEXT_EXTENSIONS.has(extension) ? extension : "txt"
}

const ownUid = (): number | undefined => process.getuid?.()

// The folder is its owner's alone: made 0700 when missing, put back to 0700 when something widened it, and refused when it is a symlink, not a folder, or another user's. It is opened with O_NOFOLLOW and checked and tightened through that handle, so a symlink swapped in after the check is never followed.
export async function ownFolder(dir: string): Promise<void> {
  await mkdir(dir, { mode: 0o700, recursive: true })
  const folder = await open(
    dir,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  ).catch(() => null)
  if (!folder) throw new Error(`${dir} is not a folder, so no files are kept in it`)
  try {
    const info = await folder.stat()
    if (!info.isDirectory() || info.uid !== ownUid()) {
      throw new Error(`${dir} is not a folder this user owns, so no files are kept in it`)
    }
    if ((info.mode & 0o777) !== 0o700) await folder.chmod(0o700)
  } finally {
    await folder.close()
  }
}

// The same check for a read, which creates nothing: a folder that is missing, a symlink or another user's holds no file the dashboard will hand out.
export async function isOwnFolder(dir: string): Promise<boolean> {
  const info = await lstat(dir).catch(() => null)
  return Boolean(info?.isDirectory() && info.uid === ownUid())
}

// Deletes the dashboard's files older than RETENTION_MS and returns the bytes the rest hold; a name the dashboard did not give is left alone and not counted.
export async function sweep(dir = attachmentsDir(), now = new Date()): Promise<number> {
  if (!(await isOwnFolder(dir))) return 0
  let kept = 0
  for (const name of await readdir(dir)) {
    if (!ID_PATTERN.test(name)) continue
    const path = join(dir, name)
    const info = await lstat(path).catch(() => null)
    if (!info?.isFile()) continue
    if (now.getTime() - info.mtimeMs > RETENTION_MS) await unlink(path).catch(() => {})
    else kept += info.size
  }
  return kept
}

const SWEEPER = Symbol.for("playground.dashboard.attachments.sweeper")
const timers = globalThis as { [SWEEPER]?: ReturnType<typeof setInterval> }

// Sweeps the folder now and every hour after, so a file leaves a week after it arrived even when nothing new is uploaded. The API's entry starts it; the timer never holds the process open, and a reload under bun --hot replaces it rather than adding another.
export function keepSweeping(dir = attachmentsDir()): void {
  const run = () =>
    void sweep(dir).catch((error: unknown) => {
      console.warn(`Could not sweep ${dir}:`, error)
    })
  run()
  clearInterval(timers[SWEEPER])
  timers[SWEEPER] = setInterval(run, SWEEP_EVERY_MS)
  timers[SWEEPER].unref()
}

// Why a file was not kept. FULL can pass once the sweep frees room; the rest cannot until the file changes.
export type StoreRefusal = {
  code: "EMPTY" | "FULL" | "TOO_LARGE" | "UNSUPPORTED"
  ok: false
  reason: string
}

export type Stored = { id: string; kind: AttachmentKind; ok: true; size: number }

const refused = (code: StoreRefusal["code"], reason: string): StoreRefusal => ({
  code,
  ok: false,
  reason,
})

// A cap as its refusal names it: 10 MB, 1 GB.
const capLabel = (bytes: number): string =>
  bytes >= 1024 ** 3
    ? `${+(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes >= 1024 ** 2
      ? `${+(bytes / 1024 ** 2).toFixed(1)} MB`
      : `${bytes} bytes`

// The one reason a file too large is refused with, by the route's body limit and by the store alike.
export const TOO_LARGE_REASON = `A file holds at most ${capLabel(MAX_ATTACHMENT_BYTES)}.`

// Keeps one uploaded file in the attachments folder under a name the dashboard makes, created with O_EXCL and O_NOFOLLOW at 0600, so nothing already there is written through or over. The name the browser sent decides only a text file's extension. The folder is swept first, so its cap counts only files still kept.
export async function storeAttachment(
  bytes: Uint8Array,
  name: string,
  {
    dir = attachmentsDir(),
    maxFolderBytes = MAX_FOLDER_BYTES,
    now = new Date(),
  }: { dir?: string; maxFolderBytes?: number; now?: Date } = {},
): Promise<StoreRefusal | Stored> {
  if (bytes.length === 0) return refused("EMPTY", "The file is empty.")
  if (bytes.length > MAX_ATTACHMENT_BYTES) return refused("TOO_LARGE", TOO_LARGE_REASON)
  const extension = sniff(bytes, name)
  if (!extension) {
    return refused(
      "UNSUPPORTED",
      "Only images (PNG, JPEG, GIF or WebP), PDFs and text files can be attached.",
    )
  }
  const folder = resolve(dir)
  await ownFolder(folder)
  if ((await sweep(folder, now)) + bytes.length > maxFolderBytes) {
    return refused(
      "FULL",
      `The attachments folder has no room for this file: it holds at most ${capLabel(maxFolderBytes)}, and files leave it a week after they arrive.`,
    )
  }
  const id = `${randomUUID()}.${extension}`
  const path = join(folder, id)
  const file = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  )
  try {
    await file.writeFile(bytes)
    await file.chmod(0o600)
  } catch (error) {
    await unlink(path).catch(() => {})
    throw error
  } finally {
    await file.close()
  }
  return { id, kind: kindOf(id), ok: true, size: bytes.length }
}

// The file an id names, or null: the id must be a name the dashboard gives, sitting directly in the folder as a regular file with one link (not a symlink, and not a hard link to a file elsewhere), in a folder its owner owns.
export async function findAttachment(
  id: string,
  dir = attachmentsDir(),
): Promise<Attachment | null> {
  if (!ID_PATTERN.test(id)) return null
  const folder = resolve(dir)
  const path = join(folder, id)
  if (dirname(path) !== folder || !(await isOwnFolder(folder))) return null
  const info = await lstat(path).catch(() => null)
  if (!info?.isFile() || info.nlink !== 1) return null
  return { id, kind: kindOf(id), path, size: info.size }
}

// A found file's bytes, read through a handle opened with O_NOFOLLOW and checked again, so a symlink swapped in after findAttachment is never followed. Null when it is gone or no longer the file it was.
export async function readAttachment(
  id: string,
  dir = attachmentsDir(),
): Promise<{ bytes: Uint8Array<ArrayBuffer>; file: Attachment } | null> {
  const file = await findAttachment(id, dir)
  if (!file) return null
  const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null)
  if (!handle) return null
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.nlink !== 1) return null
    return { bytes: Uint8Array.from(await handle.readFile()), file: { ...file, size: info.size } }
  } finally {
    await handle.close()
  }
}

const ATTACHED = "Attached: "

// The message a session receives: the person's words, a blank line, then one line per file giving its absolute path, which the session can Read. The path never starts the message, so files sent alone cannot read as a / command.
export const withAttachments = (text: string, attachments: Pick<Attachment, "path">[]): string =>
  attachments.length
    ? [...(text ? [text, ""] : []), ...attachments.map((file) => `${ATTACHED}${file.path}`)].join(
        "\n",
      )
    : text

// The id of a file directly in the attachments folder, under a name the dashboard gives; null for any other path.
export const attachmentIdOf = (path: string, dir = attachmentsDir()): string | null => {
  const id = basename(path)
  return path === join(resolve(dir), id) && ID_PATTERN.test(id) ? id : null
}

// What Claude Code leaves of a pasted "Attached: <path>" line (measured on 2.1.304): it splits a paste at " /", so a file's line lands as this and its path on the next, and an image path it takes in as an image leaves this alone, with an [Image #n] put before the words, a space between the marks on 2.1.309.
export const ATTACHED_LABEL = "Attached:"
const IMAGES = /^(?:\[Image #\d+\] *)+/

const wholeLineId = (line: string, dir: string): string | null =>
  line.startsWith(ATTACHED) ? attachmentIdOf(line.slice(ATTACHED.length), dir) : null

// The trailing run of whole `Attached: <path>` lines as files, walking up from the end.
const typedFiles = (lines: string[], dir: string) => {
  const attachments: EntryAttachment[] = []
  let end = lines.length
  while (end > 0) {
    const id = wholeLineId(lines[end - 1] ?? "", dir)
    if (!id) break
    attachments.unshift({ id, kind: kindOf(id) })
    end -= 1
  }
  return { attachments, end }
}

// The same run as Claude Code leaves a paste: a whole line, a bare label over its path, or a bare label alone for an image it took in.
const pastedFiles = (lines: string[], dir: string) => {
  const attachments: EntryAttachment[] = []
  let end = lines.length
  while (end > 0) {
    const line = lines[end - 1] ?? ""
    const whole = wholeLineId(line, dir)
    const id = whole ?? (lines[end - 2] === ATTACHED_LABEL ? attachmentIdOf(line, dir) : null)
    if (id) {
      attachments.unshift({ id, kind: kindOf(id) })
      end -= whole ? 1 : 2
    } else if (line === ATTACHED_LABEL) {
      attachments.unshift({ id: null, kind: "image" })
      end -= 1
    } else break
  }
  return { attachments, end }
}

// The other way, for a transcript: the trailing run of Attached lines lifted out of a message's text as ids. Only a path directly in the attachments folder, under a name the dashboard gives, counts; any other Attached line is the person's own words and stays, so a transcript can never point the dashboard at another path. A message herdr pasted reads as Claude Code left it: its images, each a bare Attached line, count only when the [Image #n] marks before its words are as many, and the marks are lifted too.
export function splitAttachments(
  text: string,
  dir = attachmentsDir(),
): { attachments: EntryAttachment[]; text: string } {
  const marks = (IMAGES.exec(text)?.[0].match(/\[/g) ?? []).length
  // with no words, the first file's line follows the marks on the same line
  const unmarked = text.replace(IMAGES, "").split("\n")
  const pasted = pastedFiles(unmarked, dir)
  const images = pasted.attachments.filter((file) => file.id === null).length
  const fromPaste = images > 0 && images === marks
  const lines = fromPaste ? unmarked : text.split("\n")
  const { attachments, end } = fromPaste ? pasted : typedFiles(lines, dir)
  if (!attachments.length) return { attachments, text }
  return { attachments, text: lines.slice(0, end).join("\n").trimEnd() }
}
