import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { open, unlink } from "node:fs/promises"
import { join, resolve } from "node:path"

import {
  findAttachment,
  IMAGE_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  ownFolder,
  readAttachment,
  sniff,
} from "@/lib/dashboard/attachments"
import { readsLive } from "@/lib/dashboard/fixture"
import { dataDir, livePath } from "@/lib/sessions/paths"
import { fixtureImages } from "@/plugins/changelog/fixture"
import { IMAGE_ID } from "@/plugins/changelog/image-id"
import type { ChangelogImage, ShownImage } from "@/plugins/changelog/types"

export { IMAGE_ID }

// The Changelog's screenshots: copies of a PR's before and after images, kept in an owner-only folder and served by the API alone, never by the database and never from GitHub. Unlike attachments they are never swept, since an entry keeps its images.

// $PLAYGROUND_CHANGELOG_DIR when set (a live-reads test stack's scratch folder), else changelog in the dashboard's data folder on a stack that reads this machine (the live Dashboard, or a person's own clone); the fixture's folder on any other stack, whatever is set.
export const imagesDir = (): string =>
  resolve(livePath("PLAYGROUND_CHANGELOG_DIR") || join(dataDir(), "changelog"))

// Keeps one screenshot under a name it makes, 0600 in the 0700 folder, created with O_EXCL and O_NOFOLLOW so nothing already there is written through or over; null when the bytes are not a PNG, JPEG, GIF or WebP, or are over 10 MB.
export async function storeImage(bytes: Uint8Array, dir = imagesDir()): Promise<string | null> {
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) return null
  const extension = sniff(bytes, "")
  if (!extension || !(IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return null
  const folder = resolve(dir)
  await ownFolder(folder)
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
  return id
}

// A kept screenshot's bytes and id, read as attachments are (a regular file with one link, directly in a folder this user owns, through an O_NOFOLLOW handle); null for any other id or a file that is gone. A fixture stack serves the fixture's drawn screenshots from memory, so its rows never wait on a file the launcher drops at each stop.
export async function readImage(
  id: string,
  dir = imagesDir(),
): Promise<{ bytes: Uint8Array<ArrayBuffer>; id: string } | null> {
  if (!IMAGE_ID.test(id)) return null
  if (!readsLive()) {
    const drawn = fixtureImages().find((image) => image.id === id)
    if (drawn) return { bytes: Uint8Array.from(drawn.bytes), id }
  }
  const found = await readAttachment(id, dir)
  return found && { bytes: found.bytes, id: found.file.id }
}

const u16be = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0)
const u16le = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8)
const u24le = (b: Uint8Array, at: number) => u16le(b, at) | ((b[at + 2] ?? 0) << 16)
const u32be = (b: Uint8Array, at: number) => u16be(b, at) * 0x10000 + u16be(b, at + 2)

// An image's width and height in pixels from its header (PNG, GIF, WebP, or a JPEG's frame marker), or null when it does not read.
export function imageSize(b: Uint8Array): { height: number; width: number } | null {
  const ascii = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))
  let size: { height: number; width: number } | null = null
  if (b[0] === 0x89 && ascii(12, 4) === "IHDR") size = { height: u32be(b, 20), width: u32be(b, 16) }
  else if (ascii(0, 4) === "GIF8") size = { height: u16le(b, 8), width: u16le(b, 6) }
  else if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4)
    if (chunk === "VP8 ") size = { height: u16le(b, 28) & 0x3fff, width: u16le(b, 26) & 0x3fff }
    else if (chunk === "VP8L") {
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24)
      size = { height: ((bits >>> 14) & 0x3fff) + 1, width: (bits & 0x3fff) + 1 }
    } else if (chunk === "VP8X") size = { height: u24le(b, 27) + 1, width: u24le(b, 24) + 1 }
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    let at = 2
    while (at + 9 < b.length && b[at] === 0xff) {
      const marker = b[at + 1] ?? 0
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        size = { height: u16be(b, at + 5), width: u16be(b, at + 7) }
        break
      }
      at += 2 + u16be(b, at + 2)
    }
  }
  return size && size.width > 0 && size.height > 0 ? size : null
}

// A size needs only an image's first bytes; a JPEG whose frame marker sits past them reads as no size.
const HEAD_BYTES = 64 * 1024

// A kept screenshot's first HEAD_BYTES, checked and opened as readImage's are; the fixture's drawn ones from memory.
async function readImageHead(id: string, dir: string): Promise<Uint8Array | null> {
  if (!IMAGE_ID.test(id)) return null
  if (!readsLive()) {
    const drawn = fixtureImages().find((image) => image.id === id)
    if (drawn) return drawn.bytes.subarray(0, HEAD_BYTES)
  }
  const file = await findAttachment(id, dir)
  if (!file) return null
  const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null)
  if (!handle) return null
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.nlink !== 1) return null
    const head = new Uint8Array(HEAD_BYTES)
    const { bytesRead } = await handle.read(head, 0, HEAD_BYTES, 0)
    return head.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const SIZES = new Map<string, { height: number; width: number } | null>()

// Each screenshot with its size, read from its first 64 KiB once per id (a kept file never changes under its name) and then from memory; a file that is gone is tried again on the next read.
export async function withSizes<T extends { images: ChangelogImage[] }>(
  entries: T[],
  dir = imagesDir(),
): Promise<(Omit<T, "images"> & { images: ShownImage[] })[]> {
  const sizeOf = async (id: string) => {
    if (SIZES.has(id)) return SIZES.get(id) ?? null
    const head = await readImageHead(id, dir)
    const size = head && imageSize(head)
    if (head) SIZES.set(id, size)
    return size
  }
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      images: await Promise.all(
        entry.images.map(async (image) => {
          const size = await sizeOf(image.id)
          return { ...image, height: size?.height ?? null, width: size?.width ?? null }
        }),
      ),
    })),
  )
}
