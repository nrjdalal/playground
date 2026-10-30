import { existsSync, readFileSync, statSync } from "node:fs"
import { loadavg } from "node:os"
import { join } from "node:path"

import { dispatcherOf, isManagerKind, kindOf, managerOf } from "@packages/config/kinds"

import { leadOf } from "../ops-tick/tick"
import { writeAtomic } from "../write-atomic"

const LOAD_LINE = 15
const HOUR = 3_600_000
// scripts/ops/run-slot.sh's SWITCHES, and the hours one with no expiry line stands from its mtime
export const SWITCHES = [
  "run-slot.3-off",
  "run-slot.4-off",
  "run-slot.clone-off",
  "run-slot.load5-cap",
  "run-slot.single",
  "runner-host/off",
  "runner-host/slot-off",
]
export const SWITCH_HOURS = 4

// What the last sweep saw, kept in the lead's own state file: how far into checks.log it read, the alerts and passed ETAs it printed, the queue line, which side of 15 the load was on, whether the single-slot flag was set and when it last listed the switches on.
type SweepState = {
  alerts: string[]
  checks: number
  etas: string[]
  loadHigh: boolean
  queue: string
  single: boolean
  switchesAt?: number
}

type Switch = { by: string; name: string; reason: string; set: number; until: number }

type Readings = {
  alerts: unknown
  checks: { lines: string[]; size: number }
  load5: number
  now: Date
  queue: unknown
  roster: unknown
  single: boolean
  switches: Switch[]
}

type Row = {
  eta?: unknown
  kind?: unknown
  lead?: unknown
  name?: unknown
  pr?: unknown
  status?: unknown
  task?: unknown
  worker?: unknown
}

const listOf = (value: unknown, key: string): unknown[] => {
  const list = (value as Record<string, unknown> | null)?.[key]
  return Array.isArray(list) ? list : []
}

const queueLine = (queue: unknown): string => {
  const prs = listOf(queue, "queue").flatMap((e) => {
    const { pr, readyAt } = (e ?? {}) as { pr?: unknown; readyAt?: unknown }
    return typeof pr === "number" ? [`#${pr}${readyAt ? " ready" : ""}`] : []
  })
  return prs.length ? prs.join(", ") : "empty"
}

// Pure: the lines this sweep prints and the state to keep. A first sweep compares every reading but checks.log with a calm baseline, so it prints once what stands now.
function sweep(
  lead: string,
  r: Readings,
  prev: SweepState | null,
): { lines: string[]; next: SweepState } {
  const lines = r.checks.lines.map((line) => `checks: ${line}`)

  // An alert is keyed by kind and name alone, since ops-unstick rewrites some kinds' `since` every cycle; one that clears and comes back prints again.
  const alerts = listOf(r.alerts, "alerts").map((a) => {
    const { kind, line, name } = (a ?? {}) as Record<string, unknown>
    return { key: `${kind} ${name}`, text: `alert: ${kind} ${name}: ${line}` }
  })
  for (const a of alerts) if (!prev?.alerts.includes(a.key)) lines.push(a.text)

  const queue = queueLine(r.queue)
  if (queue !== (prev?.queue ?? "empty")) lines.push(`queue: ${queue}`)

  const loadHigh = r.load5 >= LOAD_LINE
  if (loadHigh !== (prev?.loadHigh ?? false))
    lines.push(
      `load5 ${r.load5.toFixed(1)}, ${loadHigh ? "at or above" : "back under"} ${LOAD_LINE}`,
    )
  if (r.single !== (prev?.single ?? false)) lines.push(`single slot: ${r.single ? "on" : "off"}`)

  const agents = listOf(r.roster, "agents") as Row[]
  const passed = agents.flatMap((row) => {
    const { eta, name, status } = row
    if (
      typeof name !== "string" ||
      typeof eta !== "string" ||
      status === "ended" ||
      status === "parked"
    )
      return []
    const at = Date.parse(eta)
    if (isNaN(at) || at > r.now.getTime()) return []
    const kind = kindOf(name, row.kind) === "probe" ? "ops" : leadOf(name, row.worker, row.kind)
    const owner =
      typeof row.lead === "string"
        ? row.lead
        : isManagerKind(kind)
          ? managerOf(agents, kind)
          : dispatcherOf(agents, 1)
    if (owner !== lead) return []
    const about = typeof row.pr === "string" ? row.pr : typeof row.task === "string" ? row.task : ""
    return [
      { key: `${name} ${eta}`, text: `eta passed: ${name} ${eta}${about ? ` (${about})` : ""}` },
    ]
  })
  for (const p of passed) if (!prev?.etas.includes(p.key)) lines.push(p.text)

  // a hand-set switch kept the runner box idle for two days, so each one on is listed once an hour
  const now = r.now.getTime()
  let switchesAt = r.switches.length ? (prev?.switchesAt ?? 0) : 0
  if (r.switches.length && now - switchesAt >= HOUR) {
    switchesAt = now
    for (const s of r.switches) {
      const age = Math.max(0, now - s.set)
      const why = s.by ? `by ${s.by}: ${s.reason}` : "no reason, set by hand"
      lines.push(
        `switch on: ${s.name} for ${Math.floor(age / HOUR)}h${Math.floor((age % HOUR) / 60_000)}m, until ${new Date(s.until).toISOString().slice(0, 19)}Z, ${why}`,
      )
    }
  }

  return {
    lines,
    next: {
      alerts: alerts.map((a) => a.key),
      checks: r.checks.size,
      etas: passed.map((p) => p.key),
      loadHigh,
      queue,
      single: r.single,
      switchesAt,
    },
  }
}

// The leads a sweep serves: whoever holds the builder's and ops' seats in the roster.
const leadsOf = (roster: unknown): string[] =>
  (["builder", "ops"] as const).map((kind) => managerOf(listOf(roster, "agents"), kind))

// A cursor file of another shape counts as no cursor, so the sweep after it starts afresh.
const isState = (value: unknown): SweepState | null => {
  const v = value as Partial<SweepState> | null
  return v && Array.isArray(v.alerts) && Array.isArray(v.etas) && typeof v.checks === "number"
    ? (v as SweepState)
    : null
}

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

// Each switch on, read as run-slot.sh reads it: its "<who> <iso set> <iso expiry> <reason>" line, else set at its mtime for SWITCH_HOURS.
const switchesOn = (ops: string, now: Date): Switch[] =>
  SWITCHES.flatMap((name) => {
    const path = join(ops, name)
    let line: string
    let mtime: number
    try {
      line = readFileSync(path, "utf8").split("\n")[0] ?? ""
      mtime = statSync(path).mtimeMs
    } catch {
      return []
    }
    const m = /^(\S+) ([\d-]{10}T[\d:]{8}Z) ([\d-]{10}T[\d:]{8}Z) (.*)/.exec(line)
    const s = m
      ? { by: m[1]!, name, reason: m[4]!, set: Date.parse(m[2]!), until: Date.parse(m[3]!) }
      : { by: "", name, reason: "", set: mtime, until: mtime + SWITCH_HOURS * HOUR }
    return s.until > now.getTime() ? [s] : []
  })

// The complete lines of checks.log from an offset, and the offset after the last of them, so a line still being written waits for the next sweep.
const checksSince = (path: string, from: number): { lines: string[]; size: number } => {
  if (!existsSync(path)) return { lines: [], size: 0 }
  const bytes = readFileSync(path).subarray(from)
  const end = bytes.lastIndexOf(10) + 1
  const lines = bytes.subarray(0, end).toString("utf8").split("\n").filter(Boolean)
  return { lines, size: from + end }
}

// `playground sweep <lead>`: one read of what changed since that lead's last sweep (and, for ops' lead, each switch on, once an hour), `quiet` when nothing did, its cursor in sweep/<lead>.json in the data folder.
export async function runSweep(
  lead: string,
  dir: string,
  now = new Date(),
  load5 = loadavg()[1],
): Promise<string[]> {
  const roster = readJson(join(dir, "roster.json"))
  const leads = leadsOf(roster)
  const [, opsLead] = leads
  if (!leads.includes(lead))
    throw new Error(`playground sweep takes a lead's name (${leads.join(" or ")}), not ${lead}`)
  const statePath = join(dir, "sweep", `${lead}.json`)
  const prev = isState(readJson(statePath))
  const log = join(dir, "ops", "checks", "checks.log")
  const size = existsSync(log) ? statSync(log).size : 0
  // A first sweep starts at the last complete line, so a line still being written then prints whole later; a log cut shorter than the cursor is read from its start.
  const checks = prev
    ? checksSince(log, prev.checks <= size ? prev.checks : 0)
    : { lines: [], size: checksSince(log, 0).size }
  const switches = switchesOn(join(dir, "ops"), now)
  const { lines, next } = sweep(
    lead,
    {
      alerts: readJson(join(dir, "ops", "alerts-pending.json")),
      checks,
      load5,
      now,
      queue: readJson(join(dir, "merge-queue.json")),
      roster,
      single: switches.some((s) => s.name === "run-slot.single"),
      switches: lead === opsLead ? switches : [],
    },
    prev,
  )
  await writeAtomic(statePath, `${JSON.stringify(next, null, 2)}\n`)
  return lines.length ? lines : ["quiet"]
}
