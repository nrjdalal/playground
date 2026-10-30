import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"

import { dataDir } from "@/lib/sessions/paths"
import type { Usage, UsageWindow } from "@/lib/usage/window"

// What ops-unstick last found blocking a live session (a usage limit with no room, a permission prompt, a picker, /login): it reads every quiet session's screen every 2 minutes and writes them here. ops-unstick owns the file and its shape, so each entry and each field is read on its own, and one that does not read costs only itself.
export const unstickPath = (): string => join(dataDir(), "ops", "unstick", "state.json")

// A file older than this is a job that has stopped writing, so what it says is no longer known.
export const UNSTICK_STALE_MS = 3 * 60_000

const text = z.string().min(1).nullable().catch(null)

const blockedSchema = z.object({
  kind: text,
  line: text,
  name: text,
  since: text,
  surface: text,
  workspace: text,
})

export type Blocked = z.infer<typeof blockedSchema>

// Pure: the file's text in, the sessions it names as blocked out; none when it is not a JSON object, has no fresh writtenAt, or names no session in an entry.
export function parseUnstick(raw: string, now: number): Blocked[] {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return []
  const { blocked, writtenAt } = json as Record<string, unknown>
  const written = typeof writtenAt === "string" ? Date.parse(writtenAt) : Number.NaN
  if (Number.isNaN(written) || now - written > UNSTICK_STALE_MS || !Array.isArray(blocked))
    return []
  return blocked.flatMap((entry) => {
    const parsed = blockedSchema.safeParse(entry)
    return parsed.success && (parsed.data.surface || parsed.data.name) ? [parsed.data] : []
  })
}

export async function readUnstick(now = Date.now()): Promise<Blocked[]> {
  const raw = await readFile(unstickPath(), "utf8").catch(() => null)
  return raw === null ? [] : parseUnstick(raw, now)
}

export type Held = { name: string; sessionId: string; surface: string | null }

// Pure: the sessions ops-unstick lists, each entry matched to a live session by its surface (cmux's surface id, as `cmux sessions list` gives it), else by its name, so an entry whose surface no session holds, a tree ref (`surface:24`) included, still finds its session. Each session keeps every entry that names it, for its kinds. `sessions` may hold sessions off the board being read, after its own, which then win. An entry whose surface and name point at two sessions marks neither and is named in `conflicts`, since a wrong Waiting on you holds back every message to that session.
export function blockedSessions(
  blocked: Blocked[],
  sessions: Held[],
): { conflicts: string[]; sessions: Map<string, Blocked[]> } {
  const conflicts: string[] = []
  const marked = new Map<string, Blocked[]>()
  for (const entry of blocked) {
    const bySurface = sessions.find((s) => entry.surface !== null && s.surface === entry.surface)
    const byName = sessions.find((s) => entry.name !== null && s.name === entry.name)
    if (bySurface && byName && bySurface.sessionId !== byName.sessionId) {
      conflicts.push(
        `ops-unstick lists ${entry.name} as blocked (${entry.kind}) on surface ${entry.surface}, which ${bySurface.name} holds, so neither is marked`,
      )
      continue
    }
    const match = bySurface ?? byName
    if (match) marked.set(match.sessionId, [...(marked.get(match.sessionId) ?? []), entry])
  }
  return { conflicts, sessions: marked }
}

// When a session the usage limit holds can go on: the dialog's own words (`resets 3am (Asia/Calcutta)`), else the reset of a usage window, as an ISO time.
export type UsageLimit = { resets: string | null; resetsAt: string | null }

// The reset's time and its zone alone, as ops-unstick's own LIMIT_LINE reads it, so what it appends after the dialog's words (`(no room: …)`) or a boxed line's border never shows.
const RESETS = /\bresets?\s+(?:at\s+)?(\d{1,2}(?::\d\d)?\s*[ap]m(?:\s*\([A-Za-z][\w/+-]*\))?)/i

// ops-unstick appends this when it found room and its Escape left the dialog up, so the limit is not what holds the session.
const NOT_CLEARED = "(Escape did not clear it)"

// Pure: a session held by the usage limit alone, and when it resets; null when any block needs a person (a prompt, a login, a permission), or a nudge: the limit still showing past its reset (`usage-limit-stuck`), or a dialog Escape did not clear. With no reset in the dialog's line, the full window's reset (the later, with both full), else the soonest.
export function usageLimitOf(entries: Blocked[], usage: Usage | null): UsageLimit | null {
  const paused = (entry: Blocked) =>
    entry.kind === "usage-limit" && !entry.line?.includes(NOT_CLEARED)
  if (!entries.length || !entries.every(paused)) return null
  const resets = entries.map((entry) => entry.line?.match(RESETS)?.[1]?.trim()).find(Boolean)
  if (resets) return { resets, resetsAt: null }
  const windows = [usage?.fiveHour, usage?.sevenDay].filter((w) => w?.resetsAt) as UsageWindow[]
  const at = (w: UsageWindow) => w.resetsAt as string
  const full = windows.filter((w) => w.usedPercent >= 100)
  // a full window holds it until its reset, so with both full, the later one; with none, the soonest
  const reset = full.length ? full.map(at).sort().at(-1) : windows.map(at).sort()[0]
  return { resets: null, resetsAt: reset ?? null }
}
