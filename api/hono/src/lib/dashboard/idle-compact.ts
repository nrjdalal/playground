import { stat } from "node:fs/promises"

import { prompt } from "@/lib/dashboard/herdr"
import { type Live, listLive, type Worker } from "@/lib/dashboard/workers"

// The idle-compaction trial (ADR 0020): a worker or runner whose prompt cache is about to expire, 50 to 58 minutes after its last turn, gets `/compact` while the cache is warm, so its next turn reads a short summary rather than writing its whole history to the cache again.
export const IDLE_COMPACT = { contextTokens: 200_000, fromMinutes: 50, toMinutes: 58 }

// A session's newest request, as its transcript records it: when it ran and the context it carried (input plus cache read plus cache write).
export type LastTurn = { at: number; context: number }

export type Picked = { context: number; idleMinutes: number; name: string; surface: string }

const TAIL_BYTES = 512 * 1024

// The newest main-thread assistant line with a usage in the transcript's last 512 KB, or null.
export async function lastTurn(path: string): Promise<LastTurn | null> {
  const file = Bun.file(path)
  const size = (await stat(path).catch(() => null))?.size ?? 0
  if (size === 0) return null
  const lines = (await file.slice(Math.max(0, size - TAIL_BYTES)).text()).split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (!line.includes('"usage"')) continue
    let row: {
      isSidechain?: boolean
      message?: { usage?: Record<string, unknown> }
      timestamp?: string
      type?: string
    }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const usage = row.message?.usage
    const at = Date.parse(row.timestamp ?? "")
    if (row.type !== "assistant" || row.isSidechain || !usage || Number.isNaN(at)) continue
    const n = (key: string) => (typeof usage[key] === "number" ? (usage[key] as number) : 0)
    return {
      at,
      context: n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens"),
    }
  }
  return null
}

// Pure: the sessions to compact now. A worker or runner in a herdr pane, idle with nothing waiting on anyone (no prompt, question or usage limit), whose newest request carried 200k+ tokens, and whose transcript has been still for 50 to 58 minutes since that request; a dispatcher, a lead and every other role are left alone.
export function pickIdle(
  workers: Worker[],
  live: Pick<Live, "surfaces">,
  turns: Map<string, LastTurn>,
  now: number,
): Picked[] {
  const picked: Picked[] = []
  for (const worker of workers) {
    if (worker.role !== "worker" && worker.role !== "runner") continue
    const surface = live.surfaces.get(worker.sessionId)
    if (!worker.herdr || !surface) continue
    if (worker.light !== "idle" || worker.feed.length > 0 || worker.questions.length > 0) continue
    if (worker.usageLimit || worker.loginExpired || worker.failed) continue
    const turn = turns.get(worker.sessionId)
    if (!turn || turn.context < IDLE_COMPACT.contextTokens) continue
    const still = Math.max(turn.at, Date.parse(worker.lastActiveAt ?? "") || 0)
    const idleMinutes = (now - still) / 60_000
    if (idleMinutes < IDLE_COMPACT.fromMinutes || idleMinutes > IDLE_COMPACT.toMinutes) continue
    picked.push({ context: turn.context, idleMinutes, name: worker.name, surface })
  }
  return picked
}

export type CompactDeps = {
  live: () => Promise<Live>
  now: () => number
  send: (surface: string, text: string) => Promise<void>
  turn: (path: string) => Promise<LastTurn | null>
}

const LIVE_DEPS: CompactDeps = { live: listLive, now: Date.now, send: prompt, turn: lastTurn }

// One pass: reads the live sessions, sends `/compact` through herdr's prompt to each one pickIdle names (or none, with dry), and says one line a session.
export async function compactIdle({
  dry = false,
  ...deps
}: Partial<CompactDeps> & { dry?: boolean } = {}): Promise<string[]> {
  const { live, now, send, turn } = { ...LIVE_DEPS, ...deps }
  const read = await live()
  const turns = new Map<string, LastTurn>()
  for (const worker of read.workers) {
    if (worker.role !== "worker" && worker.role !== "runner") continue
    const path = read.transcripts.get(worker.sessionId)
    const last = path ? await turn(path) : null
    if (last) turns.set(worker.sessionId, last)
  }
  const said: string[] = []
  for (const pick of pickIdle(read.workers, read, turns, now())) {
    const what = `${pick.name}: ${Math.round(pick.context / 1000)}k tokens, idle ${Math.round(pick.idleMinutes)} min`
    if (dry) {
      said.push(`would compact ${what}`)
      continue
    }
    try {
      await send(pick.surface, "/compact")
      said.push(`compacted ${what}`)
    } catch (err) {
      said.push(`could not compact ${what}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return said
}
