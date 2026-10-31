import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { writeAtomic } from "../write-atomic"

// ops-zai-usage: the GLM plan's credit windows from Z.ai's quota endpoint, written for spawn.sh's usage gate, whose GLM branch reads the file. One endpoint caller: everything else reads the file this job writes. The endpoint is undocumented (measured 2026-10-16) and answers 200 even when it fails, so success is the body's code and success flags.
export const CYCLE_SECONDS = 300
const TIMEOUT_MS = 20_000

type Limit = Record<string, unknown>

// unit 3 with number 5 is the 5-hour window, unit 6 with number 1 the week; usage is the cap, currentValue the amount used, nextResetTime epoch ms.
const WINDOWS: [number, number, "fiveHour" | "week"][] = [
  [3, 5, "fiveHour"],
  [6, 1, "week"],
]

export type ZaiWindow = { cap: number; resetsAt: string | null; used: number }

export type ZaiWindows = { fiveHour: ZaiWindow | null; week: ZaiWindow | null }

const windowOf = (limit: Limit): ZaiWindow | null => {
  const used = limit.currentValue
  const cap = limit.usage
  if (
    limit.type !== "CREDIT_LIMIT" ||
    typeof used !== "number" ||
    typeof cap !== "number" ||
    cap <= 0
  ) {
    return null
  }
  const reset = limit.nextResetTime
  return { cap, resetsAt: typeof reset === "number" ? new Date(reset).toISOString() : null, used }
}

// Pure: the answer's limits as the two windows, or null when no whole window stands in it.
export function windowsOf(limits: unknown): ZaiWindows | null {
  const windows: ZaiWindows = { fiveHour: null, week: null }
  if (!Array.isArray(limits)) return null
  for (const entry of limits) {
    const limit = entry as Limit
    const slot = WINDOWS.find(([unit, number]) => limit.unit === unit && limit.number === number)
    const window = slot ? windowOf(limit) : null
    if (slot && window) windows[slot[2]] = window
  }
  return windows.fiveHour || windows.week ? windows : null
}

// The key goes only into the Authorization header; a failure names Z.ai's status and body code, and masks the key, should Z.ai or the fetch echo it.
export async function zaiQuota(key: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  if (!key)
    throw new Error(
      "the Keychain holds no key for the first GLM row of usage.accounts under models.glmKeychainService",
    )
  const res = await fetchImpl("https://api.z.ai/api/monitor/usage/quota/limit", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: unknown) => {
    throw new Error((err instanceof Error ? err.message : String(err)).replaceAll(key, "***"))
  })
  const body = (await res.json().catch(() => ({}))) as {
    code?: unknown
    data?: unknown
    success?: unknown
  }
  if (res.ok && body.code === 200 && body.success === true) return body.data
  throw new Error(`Z.ai ${res.status}: code ${String(body.code ?? "?")}`.replaceAll(key, "***"))
}

// How long a GLM session's empty-balance failure holds the balance empty; once it lapses, spawn.sh lets one GLM start try again, and a balance still empty fails that start and sets it afresh.
export const BALANCE_HOLD_MS = 60 * 60 * 1000

// The newest empty-balance failure (reason "balance", which the session-state hook writes for Z.ai's 429 [1113]) within the hold, or null; the quota endpoint keeps answering with low use while the balance is empty (31 Oct), so a GLM session's own error is the one source.
export async function emptyBalanceAt(stateDir: string, now = new Date()): Promise<string | null> {
  const names = await readdir(stateDir).catch(() => [] as string[])
  let newest: string | null = null
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    const record = await readFile(join(stateDir, name), "utf8")
      .then((text) => JSON.parse(text) as { at?: unknown; reason?: unknown })
      .catch(() => null)
    const at = typeof record?.at === "string" ? Date.parse(record.at) : Number.NaN
    if (record?.reason !== "balance" || Number.isNaN(at) || now.getTime() - at > BALANCE_HOLD_MS)
      continue
    if (!newest || at > Date.parse(newest)) newest = new Date(at).toISOString()
  }
  return newest
}

// One run: "ok" once the file is written, else why not, written as the file's error over its last windows, so the sidebar draws no GLM readings from a read that failed.
export async function cycle(
  read: () => Promise<unknown>,
  path: string,
  now = new Date(),
  balance: () => Promise<string | null> = async () => null,
): Promise<string> {
  try {
    const data = (await read()) as { limits?: unknown } | null
    const windows = windowsOf(data?.limits)
    if (!windows) throw new Error("no credit window in the answer")
    const seenAt = await balance()
    await writeAtomic(
      path,
      `${JSON.stringify({ ...(seenAt ? { balance: { empty: true, seenAt } } : {}), windows, writtenAt: now.toISOString() }, null, 2)}\n`,
    )
    return "ok"
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    const last = await readFile(path, "utf8")
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch(() => ({}))
    const { windows, writtenAt } = last as { windows?: unknown; writtenAt?: unknown }
    await writeAtomic(
      path,
      `${JSON.stringify({ error, errorAt: now.toISOString(), ...(windows ? { windows, writtenAt } : {}) }, null, 2)}\n`,
    ).catch(() => {})
    return error
  }
}

// The heartbeat api/hono/src/lib/dashboard/ops.ts reads.
export const beat = (path: string, startedAt: Date, now: Date, lastResult: string) =>
  writeAtomic(
    path,
    `${JSON.stringify({
      cycleSeconds: CYCLE_SECONDS,
      job: "ops-zai-usage",
      lastBeatAt: now.toISOString(),
      lastResult,
      pid: process.pid,
      startedAt: startedAt.toISOString(),
    })}\n`,
  )
