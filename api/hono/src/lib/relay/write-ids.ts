import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"

import { dataDir } from "@/lib/sessions/paths"

// The ids of the writes from Yard this Mac took, each kept in the data folder until its frame expires, so a write sent before a restart never runs after it.
export const WRITE_IDS_FILE = "remote-write-ids.json"

const keptSchema = z.record(z.uuid(), z.number())

export function writeIdStore({ dir = dataDir }: { dir?: () => string } = {}) {
  const file = () => join(dir(), WRITE_IDS_FILE)
  // one claim at a time, so two frames with one id never both pass
  let queue: Promise<unknown> = Promise.resolve()
  return {
    // Keeps id until `until` (ms) and answers true, or answers false for an id kept already. Throws when the file cannot be read or written, so the write runs nothing.
    claim(id: string, until: number, now: number): Promise<boolean> {
      const done = queue.then(async () => {
        const text = await readFile(file(), "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "{}"
          throw error
        })
        const kept = Object.fromEntries(
          Object.entries(keptSchema.parse(JSON.parse(text))).filter(([, end]) => end > now),
        )
        if (id in kept) return false
        kept[id] = until
        await mkdir(dir(), { mode: 0o700, recursive: true })
        const temporary = `${file()}.${crypto.randomUUID()}.tmp`
        try {
          await writeFile(temporary, JSON.stringify(kept), { mode: 0o600 })
          await rename(temporary, file())
        } catch (error) {
          await rm(temporary, { force: true })
          throw error
        }
        return true
      })
      queue = done.catch(() => undefined)
      return done
    },
  }
}

export type WriteIdStore = ReturnType<typeof writeIdStore>

// This Mac's one store, claimed by the relay before a write runs.
export const remoteWriteIds: WriteIdStore = writeIdStore()
