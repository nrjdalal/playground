import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { keyIdOf, type PairKey, pairKeySchema } from "@packages/message"
import { z } from "zod"

import type { RelayPair } from "@/lib/relay/protocol"
import { dataDir } from "@/lib/sessions/paths"

// The one browser key this Mac takes signed writes from, kept in the data folder at mode 600, and the one pair request waiting on the owner's Approve on this Mac, kept in memory alone.

const pairedKeySchema = z.strictObject({
  fingerprint: z.string(),
  id: z.string(),
  key: pairKeySchema,
  login: z.string(),
  pairedAt: z.iso.datetime(),
})
export type PairedKey = z.infer<typeof pairedKeySchema>

// A pair request as the Mac's Remote section shows it: the relay frame's id names it for Approve.
export type PairRequest = {
  at: string
  fingerprint: string
  id: string
  key: PairKey
  login: string
}

// How long a pair request waits on the owner's Approve before it is dropped.
export const PAIR_WAIT_MS = 10 * 60_000

export const KEY_FILE = "remote-key.json"

export function keyStore({
  dir = dataDir,
  now = () => new Date(),
}: { dir?: () => string; now?: () => Date } = {}) {
  let waiting: PairRequest | null = null
  const file = () => join(dir(), KEY_FILE)

  // Approve and Revoke run one at a time, in the order the owner clicked them, so a Revoke never lands inside an Approve's write and is undone by its rename.
  let queue: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const turn = queue.then(run)
    queue = turn.catch(() => undefined)
    return turn
  }

  const pending = (): PairRequest | null => {
    if (waiting && now().getTime() - Date.parse(waiting.at) >= PAIR_WAIT_MS) waiting = null
    return waiting
  }

  return {
    // Holds a pair request from the relay, in place of any earlier one; it changes no key.
    async offer(pair: RelayPair): Promise<PairRequest> {
      const { fingerprint } = await keyIdOf(pair.key)
      waiting = {
        at: now().toISOString(),
        fingerprint,
        id: pair.id,
        key: pair.key,
        login: pair.login,
      }
      return waiting
    },

    pending,

    // The owner's Approve on this Mac: the waiting request named by id becomes the one paired key, which revokes the one before it.
    approve: (id: string): Promise<PairedKey | null> =>
      inTurn(async () => {
        const request = pending()
        if (!request || request.id !== id) return null
        const paired: PairedKey = {
          fingerprint: request.fingerprint,
          id: (await keyIdOf(request.key)).id,
          key: request.key,
          login: request.login,
          pairedAt: now().toISOString(),
        }
        await mkdir(dir(), { mode: 0o700, recursive: true })
        const next = `${file()}.${crypto.randomUUID()}`
        try {
          await writeFile(next, JSON.stringify(paired), { flag: "wx", mode: 0o600 })
          await rename(next, file())
        } catch (error) {
          await rm(next, { force: true })
          throw error
        }
        if (waiting === request) waiting = null
        return paired
      }),

    // The paired key, or null with none or a file that does not read as one.
    async paired(): Promise<PairedKey | null> {
      const text = await readFile(file(), "utf8").catch(() => null)
      if (text === null) return null
      try {
        return pairedKeySchema.parse(JSON.parse(text))
      } catch {
        return null
      }
    },

    // Revoke on this Mac: the paired key and any waiting request go, so the key's next write is refused.
    revoke: (): Promise<void> =>
      inTurn(async () => {
        waiting = null
        await rm(file(), { force: true })
      }),
  }
}

export type KeyStore = ReturnType<typeof keyStore>

// This Mac's one store, shared by the relay and the local Remote routes.
export const remoteKeys: KeyStore = keyStore()
