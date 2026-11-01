import { join } from "node:path"

import { dataDir } from "@/lib/sessions/paths"

// The ops-usage job (scripts/ops/usage/run.py, run through its link in ~/.playground/ops/usage) writes the usage windows (rate_limits) to this file every 5 minutes, with a temp file and a rename so a read never sees half of one. The dashboard only reads it.
export const usagePath = (): string => join(dataDir(), "usage.json")

// The ops-usage job writes every 5 minutes, so a file this old means it has missed a run and its numbers are stale.
export const USAGE_STALE_MS = 10 * 60 * 1000

// seenAt is set only on a window the file no longer holds: the last one the dashboard read, from the file written then.
export type UsageWindow = { resetsAt: string | null; seenAt?: string; usedPercent: number }

// The login rotation (login-flip.py's TARGETS): each account the factory switches between, whether its plan ends (ENDS), and when, once known, or the day of the month it renews (RENEWS).
type PoolEntry = {
  account: string
  ending: boolean
  endsAt: string | null
  renewsOn: number | null
}
export type Rotation = { pool: PoolEntry[] }

// rotation is set only when the file carries one, so a file with none marks no account's part in it. fiveHourNone marks an account with no 5-hour window at all, as distinct from a 5-hour reading that failed.
export type Usage = {
  fiveHour: UsageWindow | null
  fiveHourNone?: true
  rotation?: Rotation
  sevenDay: UsageWindow | null
  stale: boolean
  writtenAt: string
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const windowOf = (value: unknown): UsageWindow | null => {
  if (!isRecord(value) || typeof value.used_percentage !== "number") return null
  const resets = value.resets_at
  const resetsAt =
    typeof resets === "number" && Number.isFinite(resets)
      ? new Date(resets * 1000).toISOString()
      : null
  return { resetsAt, usedPercent: value.used_percentage }
}

// Pure: one pool entry, or null when it is off the shape login-flip.py writes.
const poolEntryOf = (value: unknown): PoolEntry | null =>
  isRecord(value) &&
  typeof value.account === "string" &&
  typeof value.ending === "boolean" &&
  (value.endsAt == null || typeof value.endsAt === "string") &&
  (value.renewsOn == null ||
    (typeof value.renewsOn === "number" &&
      Number.isInteger(value.renewsOn) &&
      value.renewsOn >= 1 &&
      value.renewsOn <= 31))
    ? {
        account: value.account,
        ending: value.ending,
        endsAt: value.endsAt ?? null,
        renewsOn: (value.renewsOn as number | undefined) ?? null,
      }
    : null

// Pure: usage.json's rotation, or null when it or any pool entry is off its shape.
const rotationOf = (value: unknown): Rotation | null => {
  if (!isRecord(value) || !Array.isArray(value.pool)) return null
  const pool = value.pool.map(poolEntryOf)
  return pool.every((entry): entry is PoolEntry => entry !== null) ? { pool } : null
}

// Pure: the file's text as the two windows, or null when it holds neither or no time it was written.
export function usageOf(text: string, now: Date): Usage | null {
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(file) || typeof file.writtenAt !== "string") return null
  const written = Date.parse(file.writtenAt)
  const limits = isRecord(file.rate_limits) ? file.rate_limits : {}
  const fiveHour = windowOf(limits.five_hour)
  const sevenDay = windowOf(limits.seven_day)
  if (Number.isNaN(written) || (!fiveHour && !sevenDay)) return null
  const rotation = rotationOf(file.rotation)
  // the probe's headers carry every window the account has, so a week with no five_hour there is an account with none; the /usage reading drops a window it failed to read, so its gap stays unknown
  const none =
    file.source === "token/ratelimit-headers" && sevenDay !== null && !("five_hour" in limits)
  return {
    fiveHour,
    ...(none && { fiveHourNone: true as const }),
    ...(rotation && { rotation }),
    sevenDay,
    stale: now.getTime() - written > USAGE_STALE_MS,
    writtenAt: new Date(written).toISOString(),
  }
}

export type SeenWindows = { fiveHour?: UsageWindow; sevenDay?: UsageWindow }

// The windows the System sampler has seen, kept on globalThis so a bun --hot reload keeps them. A write can hold one window and not the other, when the job read no numbers for it.
const SEEN_KEY = Symbol.for("playground.dashboard.usage.seen")
const kept = globalThis as { [SEEN_KEY]?: SeenWindows }
export const seenWindows: SeenWindows = (kept[SEEN_KEY] ??= {})

// Pure but for `seen`, which it updates: a window the file holds is remembered, and one it lacks is the last remembered, never a number the dashboard did not read.
export function withSeen(usage: Usage, seen: SeenWindows): Usage {
  const window = (key: keyof SeenWindows): UsageWindow | null => {
    const read = usage[key]
    if (key === "fiveHour" && usage.fiveHourNone) return null
    if (!read) return seen[key] ?? null
    seen[key] = { ...read, seenAt: usage.writtenAt }
    return read
  }
  return { ...usage, fiveHour: window("fiveHour"), sevenDay: window("sevenDay") }
}

// The file as usageOf reads it; a missing or unreadable one is no usage.
export async function readUsage(path = usagePath(), now = new Date()): Promise<Usage | null> {
  try {
    return usageOf(await Bun.file(path).text(), now)
  } catch {
    return null
  }
}

// One Claude account's usage, from its own usage-<name>.json, labelled by the account the file names.
export type AccountUsage = { account: string; usage: Usage }

// Pure: an account file's label, the account it names, or null when it names none.
const accountIn = (text: string): string | null => {
  try {
    const file: unknown = JSON.parse(text)
    return isRecord(file) && typeof file.account === "string" && file.account.trim()
      ? file.account.trim()
      : null
  } catch {
    return null
  }
}

// Pure: the accounts in their fixed order, the main login first (the one Claude Code's config names), then the rest A to Z.
const accountOrder = (accounts: AccountUsage[], main: string | null): AccountUsage[] => {
  const isMain = (a: AccountUsage) => a.account.toLowerCase() === main?.toLowerCase()
  return accounts.toSorted(
    (a, b) => Number(isMain(b)) - Number(isMain(a)) || a.account.localeCompare(b.account),
  )
}

// Every usage-*.json the ops-usage job writes in the data folder, one per account, and usage.json under the account it names, in accountOrder; a file with no account or no window is left out, and of two naming one account, in any case, the later written stays.
export async function readAccountUsages(
  main: string | null,
  dir = dataDir(),
  now = new Date(),
): Promise<AccountUsage[]> {
  const accounts = new Map<string, AccountUsage>()
  try {
    const names = [
      "usage.json",
      ...(await Array.fromAsync(new Bun.Glob("usage-*.json").scan({ cwd: dir, onlyFiles: true }))),
    ]
    for (const name of names) {
      const text = await Bun.file(join(dir, name))
        .text()
        .catch(() => "")
      const account = accountIn(text)
      const usage = usageOf(text, now)
      const key = account?.toLowerCase()
      const seen = key && accounts.get(key)
      if (account && key && usage && !(seen && seen.usage.writtenAt > usage.writtenAt))
        accounts.set(key, { account, usage })
    }
  } catch {
    return []
  }
  return accountOrder([...accounts.values()], main)
}

// Why readUsage read no usage from the file, for the Usage app's banner: no file yet, one it cannot read, or one holding neither window.
export async function noUsageProblem(path = usagePath()): Promise<string> {
  const handle = Bun.file(path)
  if (!(await handle.exists()))
    return "No usage windows: the ops-usage job has not written usage.json"
  const unreadable = "No usage windows: usage.json is there but cannot be read"
  let file: unknown
  try {
    file = JSON.parse(await handle.text())
  } catch {
    return unreadable
  }
  const limits = isRecord(file) && isRecord(file.rate_limits) ? file.rate_limits : {}
  if (!isRecord(file) || windowOf(limits.five_hour) || windowOf(limits.seven_day)) return unreadable
  const written = typeof file.writtenAt === "string" ? Date.parse(file.writtenAt) : Number.NaN
  const when = Number.isNaN(written) ? "" : `, last written ${new Date(written).toISOString()}`
  return `No usage windows: usage.json holds none${when}`
}
