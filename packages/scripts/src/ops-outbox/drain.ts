import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { opsDir } from "../ops-job/job"
import { writeAtomic } from "../write-atomic"

export type Queued = { at: string; job: string; text: string; to: string }

// The outbox lines notify.sh queued since the last drain, oldest first, for Ops' sweep to send (a script cannot SendMessage, ADR 0010); cursor.json holds each queue's byte offset, and is rewritten only when a line went out, the move relay-watch in ops-tick reads; a first run starts it at every queue's end.
export async function drain(outbox: string): Promise<Queued[]> {
  if (await Bun.file(join(outbox, "relay.py")).exists())
    throw new Error(`${outbox}/relay.py owns cursor.json here: its relay sends these lines`)
  const cursorPath = join(outbox, "cursor.json")
  const raw = await Bun.file(cursorPath)
    .text()
    .catch(() => null)
  const cursor: Record<string, number> = raw ? JSON.parse(raw) : {}
  const queues = (await readdir(outbox).catch(() => []))
    .filter((f) => /^ops-.+\.jsonl$/.test(f))
    .sort()
  const next = { ...cursor }
  const out: Queued[] = []
  for (const file of queues) {
    const bytes = new Uint8Array(await Bun.file(join(outbox, file)).arrayBuffer())
    if (raw === null) {
      next[file] = bytes.length
      continue
    }
    const from = (cursor[file] ?? 0) > bytes.length ? 0 : (cursor[file] ?? 0)
    const end = bytes.lastIndexOf(10) + 1
    if (end <= from) continue
    for (const line of new TextDecoder()
      .decode(bytes.subarray(from, end))
      .split("\n")
      .filter(Boolean)) {
      try {
        out.push(JSON.parse(line) as Queued)
      } catch {
        throw new Error(`${file}: unreadable line at byte ${from}: ${line.slice(0, 120)}`)
      }
    }
    next[file] = end
  }
  if (raw === null || out.length) await writeAtomic(cursorPath, JSON.stringify(next))
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

if (import.meta.main)
  for (const q of await drain(join(opsDir(), "outbox"))) console.log(JSON.stringify(q))
