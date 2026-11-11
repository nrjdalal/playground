import { chmod, mkdir } from "node:fs/promises"
import { join } from "node:path"

import { writeAtomic } from "../write-atomic"

// The ban-safety habits ops-wa keeps, each from a project that ran an unofficial WhatsApp client and lost or kept its number (OpenClaw and Hermes Agent, at the commits the plan's research page pinned): the reconnect backoff and its stop (OpenClaw reconnect.ts), the hourly connect cap (an OpenClaw user's 3,500 reconnects in 3 hours locked the number out for 72), the quiet footprint (Hermes bridge.js) and the send pacing (Hermes).
export const BACKOFF = { firstMs: 2_000, maxMs: 30_000, spread: 0.25, tries: 12 }
export const CONNECTS_PER_HOUR = 20
export const SEND = { gapMs: 1_000, partChars: 3_500, partGapMs: 300, perHour: 60 }
export const OWNER_WINDOW_MS = 24 * 3_600_000
export const KEEP_ALIVE_DAYS = 12

const HOUR = 3_600_000

// The wait before connect try n (1 the first retry): doubling from 2 s to 30 s, spread by up to a quarter either way and kept inside the two.
export const backoffMs = (attempt: number, random: () => number = Math.random): number => {
  const base = Math.min(BACKOFF.maxMs, BACKOFF.firstMs * 2 ** (attempt - 1))
  const spread = base * BACKOFF.spread * (random() * 2 - 1)
  return Math.round(Math.min(BACKOFF.maxMs, Math.max(BACKOFF.firstMs, base + spread)))
}

// Baileys' options that keep the linked device quiet: never online on connect, no history pulled, no link previews; ops-wa never marks a message read nor sends presence, so no option names them.
export const SOCKET = {
  generateHighQualityLinkPreview: false,
  markOnlineOnConnect: false,
  shouldSyncHistoryMessage: () => false,
  syncFullHistory: false,
}

// The folder ops-wa keeps everything in, to its owner alone.
export const ownFolder = async (dir: string) => {
  await mkdir(dir, { mode: 0o700, recursive: true })
  await chmod(dir, 0o700)
}

// A JSON file of ops-wa's, written whole and to its owner alone (writeAtomic's 600).
export const writeOwn = (path: string, value: unknown) => writeAtomic(path, JSON.stringify(value))

export const readOwn = async <T>(path: string, fallback: T): Promise<T> =>
  (await Bun.file(path)
    .json()
    .catch(() => fallback)) as T

// Whether ops-wa may connect now, recording the connect when it may: at most 20 in the last hour, counted in connects.json, so no restart gets past the count.
export async function mayConnect(dir: string, now: number): Promise<boolean> {
  await ownFolder(dir)
  const path = join(dir, "connects.json")
  const recent = (await readOwn<number[]>(path, [])).filter((at) => now - at < HOUR)
  if (recent.length >= CONNECTS_PER_HOUR) return false
  await writeOwn(path, [...recent, now])
  return true
}

// The time the oldest connect in the hour ages out, when the next may run.
export async function connectFreesAt(dir: string, now: number): Promise<number> {
  const recent = (await readOwn<number[]>(join(dir, "connects.json"), [])).filter(
    (at) => now - at < HOUR,
  )
  return Math.min(...recent, now) + HOUR
}

export type Link = { linkedAt?: number; remindedAt?: number }

// Linked devices drop after 14 days with the phone away, so 12 days after the link, and each 12 days after, one reminder to open WhatsApp on the spare phone.
export async function keepAlive(dir: string, now: number, remind: () => Promise<unknown>) {
  const path = join(dir, "link.json")
  const link = await readOwn<Link>(path, {})
  const since = link.remindedAt ?? link.linkedAt
  if (since === undefined || now - since < KEEP_ALIVE_DAYS * 24 * HOUR) return
  await remind()
  await writeOwn(path, { ...link, remindedAt: now })
}
