// The status line's two retail $ figures, the last 7 local days and the last 24 hours, from Claude Code's transcripts, reading only the bytes appended since the last run
import { closeSync, openSync, readdirSync, readSync, statSync } from "node:fs"
import { join } from "node:path"

import { type Tokens, usd } from "./prices"

export const BUCKET_MS = 15 * 60_000
// A message's lines arrive within minutes, so one seen this long before the last run is never added again: a later copy of it (a fork, a re-read file) is history already counted
export const HOLD_MS = 2 * 3_600_000
export const KEEP_MS = 8 * 86_400_000

// buckets: $ and unpriced messages per 15-minute UTC start; files: each transcript's inode and the offset read to; recent: each message seen within HOLD_MS, its time, the $ it added and 1 once it counted as unpriced
export type State = {
  buckets: Record<string, [number, number]>
  files: Record<string, [number, number]>
  lastRun: number
  recent: Record<string, [number, number, number]>
}

export const emptyState = (): State => ({ buckets: {}, files: {}, lastRun: 0, recent: {} })

type Message = { at: number; fast: boolean; key: string; model: string; tokens: Tokens }

export function parse(line: string): Message | undefined {
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    return undefined
  }
  const m = o?.message
  const u = m?.usage
  const at = Date.parse(o?.timestamp)
  if (o?.type !== "assistant" || !u || !m.id || Number.isNaN(at)) return undefined
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  return {
    at,
    fast: u.speed === "fast",
    // ccusage's key, so a message's later lines replace its earlier ones
    key: `${m.id}:${o.requestId ?? ""}`,
    model: String(m.model),
    tokens: {
      cacheRead: u.cache_read_input_tokens ?? 0,
      input: u.input_tokens ?? 0,
      output: u.output_tokens ?? 0,
      write1h,
      write5m: (u.cache_creation_input_tokens ?? 0) - write1h,
    },
  }
}

function transcripts(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name)
    if (e.isDirectory()) transcripts(path, out)
    else if (e.name.endsWith(".jsonl")) out.push(path)
  }
  return out
}

// Hands each whole line of [from, to) that may be an assistant's usage to `each`, in 8 MB slices, and returns the offset after the last newline, so a line still being written is read next run
function readLines(path: string, from: number, to: number, each: (line: string) => void): number {
  const fd = openSync(path, "r")
  const buf = Buffer.alloc(8 << 20)
  let pos = from
  let end = from
  let carry = ""
  try {
    while (pos < to) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, to - pos), pos)
      if (n <= 0) break
      pos += n
      const text = carry + buf.toString("utf8", 0, n)
      const cut = text.lastIndexOf("\n")
      if (cut < 0) {
        carry = text
        continue
      }
      for (const line of text.slice(0, cut).split("\n"))
        if (line.includes('"usage"') && line.includes('"assistant"')) each(line)
      carry = text.slice(cut + 1)
      end = pos - Buffer.byteLength(carry)
    }
  } finally {
    closeSync(fd)
  }
  return end
}

function add(s: State, line: string, since: number) {
  const m = parse(line)
  if (!m || m.at < since) return
  const v = usd(m.model, m.tokens, m.fast)
  const prev = s.recent[m.key]
  const slot = (at: number) =>
    (s.buckets[String(Math.floor(at / BUCKET_MS) * BUCKET_MS)] ??= [0, 0])
  if (prev) slot(prev[0])[0] -= prev[1]
  // an unpriced message counts once, on its first line with tokens
  const unpriced = v === undefined && m.tokens.input + m.tokens.output > 0 && !prev?.[2]
  if (unpriced) slot(m.at)[1]++
  slot(m.at)[0] += v ?? 0
  s.recent[m.key] = [m.at, v ?? 0, unpriced || prev?.[2] ? 1 : 0]
}

// Reads every transcript under root from where the last run stopped; a file with a new inode or cut shorter is read again from 0, and one untouched for KEEP_MS is marked read unopened
export function update(s: State, root: string, now: number): { bytes: number } {
  const since = s.lastRun ? s.lastRun - HOLD_MS : 0
  const files: State["files"] = {}
  let bytes = 0
  for (const path of transcripts(root)) {
    let st
    try {
      st = statSync(path)
    } catch {
      continue
    }
    const was = s.files[path]
    let off = was && was[0] === st.ino && was[1] <= st.size ? was[1] : 0
    if (off === 0 && st.mtimeMs < now - KEEP_MS) off = st.size
    if (off < st.size) {
      bytes += st.size - off
      off = readLines(path, off, st.size, (line) => add(s, line, since))
    }
    files[path] = [st.ino, off]
  }
  s.files = files
  for (const k of Object.keys(s.buckets)) if (Number(k) < now - KEEP_MS) delete s.buckets[k]
  for (const [k, v] of Object.entries(s.recent)) if (v[0] < now - HOLD_MS) delete s.recent[k]
  s.lastRun = now
  return { bytes }
}

// The UTC instant of local midnight `back` days before now's local date, in zone
export function localMidnight(now: number, back: number, zone: string): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: zone,
    year: "numeric",
  })
  const [y, m, d] = fmt.format(now).split("-").map(Number)
  const guess = Date.UTC(y!, m! - 1, d! - back)
  const wall = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    minute: "numeric",
    month: "numeric",
    timeZone: zone,
    year: "numeric",
  })
  const offset = (t: number) => {
    const parts = wall.formatToParts(t)
    const p = (type: string) => Number(parts.find((x) => x.type === type)!.value)
    return Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute")) - t
  }
  // the offset at the first answer, not at the guess, so a day the clocks change on still starts at its own midnight
  return guess - offset(guess - offset(guess))
}

// weekly: today and the 6 local days before it, as the status line's `date -v-6d` counts them; day24: the last 24 hours, the oldest bucket prorated by its part inside; unpriced: weekly's messages whose model has no price
export function figures(
  s: State,
  now: number,
  zone: string,
): { day24: number; unpriced: number; weekly: number } {
  const weekStart = localMidnight(now, 6, zone)
  const dayStart = now - 86_400_000
  let day24 = 0
  let unpriced = 0
  let weekly = 0
  for (const [k, [v, n]] of Object.entries(s.buckets)) {
    const b = Number(k)
    if (b >= now) continue
    if (b >= weekStart) {
      weekly += v
      unpriced += n
    }
    if (b >= dayStart) day24 += v
    else if (b + BUCKET_MS > dayStart) day24 += (v * (b + BUCKET_MS - dayStart)) / BUCKET_MS
  }
  return { day24, unpriced, weekly }
}
