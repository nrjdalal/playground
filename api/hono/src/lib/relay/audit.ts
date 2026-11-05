import { appendFile, mkdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"

import { dataDir } from "@/lib/sessions/paths"

// Every write from Yard this Mac checked, one line each in the data folder: when, the route, the paired key that signed it (null for any other key), and the status it answered, refusals included, never its body.

export const AUDIT_FILE = "remote-audit.jsonl"

// How many lines Settings' Remote section shows, newest first.
export const AUDIT_SHOWN = 20

const auditLineSchema = z.strictObject({
  at: z.iso.datetime(),
  fingerprint: z.string().nullable(),
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
  return {
    async append(line: AuditLine): Promise<void> {
      await mkdir(dir(), { mode: 0o700, recursive: true })
      await appendFile(file(), `${JSON.stringify(line)}\n`, { mode: 0o600 })
    },

    // The last AUDIT_SHOWN lines that read as one, newest first.
    async recent(): Promise<AuditLine[]> {
      const text = await readFile(file(), "utf8").catch(() => "")
      return text.split("\n").flatMap(read).slice(-AUDIT_SHOWN).reverse()
    },
  }
}

export type AuditLog = ReturnType<typeof auditLog>

// This Mac's one audit, appended by the relay and read by the local Remote routes.
export const remoteAudit: AuditLog = auditLog()
