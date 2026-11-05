import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"

import { dataDir } from "@/lib/sessions/paths"

// Every write from Yard whose signature this Mac verified, one line each in the data folder: when, the route, the paired key that signed it, and the status it answered, a refused card kind's included, never its body. A frame the paired key did not sign leaves no line, so the hub cannot crowd out the writes that ran.

export const AUDIT_FILE = "remote-audit.jsonl"

// How many lines Settings' Remote section shows, newest first.
export const AUDIT_SHOWN = 20

// How many lines the file keeps, the oldest dropped past it.
export const AUDIT_KEPT = 200

export const auditLineSchema = z.strictObject({
  at: z.iso.datetime(),
  fingerprint: z.string(),
  path: z.string(),
  status: z.number().int(),
})
export type AuditLine = z.infer<typeof auditLineSchema>

const read = (line: string): AuditLine[] => {
  try {
    const parsed = auditLineSchema.safeParse(JSON.parse(line))
    return parsed.success ? [parsed.data] : []
  } catch {
    return []
  }
}

export function auditLog({ dir = dataDir }: { dir?: () => string } = {}) {
  const file = () => join(dir(), AUDIT_FILE)
  const lines = async () =>
    (await readFile(file(), "utf8").catch(() => "")).split("\n").flatMap(read)
  // one append at a time, so two writes answered at once each keep their line
  let queue: Promise<void> = Promise.resolve()
  return {
    // Rewrites the file whole through a temporary one, the last AUDIT_KEPT lines with this one last, at mode 600.
    append(line: AuditLine): Promise<void> {
      const done = queue.then(async () => {
        await mkdir(dir(), { mode: 0o700, recursive: true })
        const kept = [...(await lines()), line].slice(-AUDIT_KEPT)
        const temporary = `${file()}.${crypto.randomUUID()}.tmp`
        try {
          await writeFile(temporary, kept.map((one) => `${JSON.stringify(one)}\n`).join(""), {
            mode: 0o600,
          })
          await rename(temporary, file())
        } catch (error) {
          await rm(temporary, { force: true })
          throw error
        }
      })
      queue = done.catch(() => undefined)
      return done
    },

    // The last AUDIT_SHOWN lines that read as one, newest first.
    async recent(): Promise<AuditLine[]> {
      return (await lines()).slice(-AUDIT_SHOWN).reverse()
    },
  }
}

export type AuditLog = ReturnType<typeof auditLog>

// This Mac's one audit, appended by the relay and read by the local Remote routes.
export const remoteAudit: AuditLog = auditLog()
