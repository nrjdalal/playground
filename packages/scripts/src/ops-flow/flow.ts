import { appendFile, mkdir, readdir, stat } from "node:fs/promises"
import { join } from "node:path"

import { writeAtomic } from "../write-atomic"

// ops-flow: a run-slot holder over 15 min alerts the leads. Each cycle reads the process table and the run-slot holders, and queues one line for each lead in the ops outbox per hold, which the relay sends with SendMessage (ADR 0010). It signals nothing.
export const CYCLE_SECONDS = 60
export const HOLD_MS = 15 * 60_000
// A model-bound slot's holder mostly waits on a model, so it is judged by its own limit: a 10-run parity replay holds one for about 75 minutes (measured once).
export const MODEL_HOLD_MS = 120 * 60_000
export const MODEL_SLOT = /^run-slot-model-\d+$/

// The leads' seats, by roster kind, and the names notify.sh falls back to when roster.ts cannot say.
export const LEADS: Record<string, string> = { builder: "builder", ops: "ops" }

// The run-slot slots whose holder writes "<who> <pid> <iso>" to <slot>.holder beside the slot's directory; the model-bound ones, run-slot-model-<n>, are found in the folder, since their count is a setting.
export const SLOTS = [
  "run-slot",
  "run-slot-2",
  "run-slot-3",
  "run-slot-4",
  "run-slot-clone",
  "run-slot-commit",
  "run-slot-quick",
]

export type Proc = { command: string; pid: number }
export type Holder = { command: string; pid: number; since: string; slot: string; who: string }
type State = { alerted: string[] }

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
const hhmm = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)}Z`
const mins = (ms: number): number => Math.floor(ms / 60_000)

// Pure: a holder line "<who> <pid> <iso>" for a slot whose directory exists, alive while its pid is in the process table.
export function holderOf(slot: string, line: string, procs: Proc[]): Holder | null {
  const [who, pidText, since] = line.trim().split(/\s+/)
  const pid = Number(pidText)
  if (!who || !Number.isInteger(pid) || !since || isNaN(Date.parse(since))) return null
  const proc = procs.find((p) => p.pid === pid)
  return proc ? { command: proc.command, pid, since, slot, who } : null
}

export type Alert = { key: string; text: string }

// Pure: this cycle's alerts and the state to keep: a hold that ends and comes back is a new key and alerts again; a key no longer held leaves the state.
export function judge(input: { holders: Holder[]; now: number; state: State }): {
  alerts: Alert[]
  state: State
} {
  const { holders, now, state } = input
  const current: Alert[] = []
  for (const h of holders) {
    const age = now - Date.parse(h.since)
    if (age < (MODEL_SLOT.test(h.slot) ? MODEL_HOLD_MS : HOLD_MS)) continue
    current.push({
      key: `hold ${h.slot} ${h.who} ${h.pid} ${h.since}`,
      text: `${h.who} has held ${h.slot} for ${mins(age)} min (since ${hhmm(Date.parse(h.since))}, pid ${h.pid}): ${h.command.slice(0, 200)}`,
    })
  }
  const was = new Set(state.alerted)
  return {
    alerts: current.filter((a) => !was.has(a.key)),
    state: { alerted: current.map((a) => a.key) },
  }
}

const readText = (path: string): Promise<string> =>
  Bun.file(path)
    .text()
    .catch(() => "")

async function holders(ops: string, procs: Proc[]): Promise<Holder[]> {
  const found: Holder[] = []
  const model = (await readdir(ops).catch(() => [] as string[])).filter((n) => MODEL_SLOT.test(n))
  for (const slot of [...SLOTS, ...model.sort()]) {
    const dir = await stat(join(ops, slot)).catch(() => null)
    if (!dir?.isDirectory()) continue
    const holder = holderOf(slot, await readText(join(ops, `${slot}.holder`)), procs)
    if (holder) found.push(holder)
  }
  return found
}

// One run: "ok" with the count of lines queued, else why not. Each alert goes to both leads, as {at, job, to, text} in outbox/ops-flow.jsonl and a line in alerts.log, the shape notify.sh writes.
export async function cycle(options: {
  // the data folder the job's state, alerts and outbox are kept in
  data: string
  now?: Date
  procs: Proc[]
  whoOf: (kind: string) => Promise<string>
}): Promise<{ alerted: number; result: string }> {
  const { data, now = new Date(), procs, whoOf } = options
  let alerted = 0
  try {
    const ops = join(data, "ops")
    const statePath = join(ops, "flow", "state.json")
    let state: State = { alerted: [] }
    try {
      const read = JSON.parse(await readText(statePath)) as Partial<State>
      if (Array.isArray(read.alerted))
        state = { alerted: read.alerted.filter((k) => typeof k === "string") }
    } catch {}
    const judged = judge({ holders: await holders(ops, procs), now: now.getTime(), state })
    if (judged.alerts.length > 0) {
      await mkdir(join(ops, "outbox"), { recursive: true })
      const at = iso(now.getTime())
      for (const alert of judged.alerts)
        for (const kind of Object.keys(LEADS)) {
          const to = await whoOf(kind)
          await appendFile(
            join(ops, "outbox", "ops-flow.jsonl"),
            `${JSON.stringify({ at, job: "flow", text: alert.text, to })}\n`,
          )
          await appendFile(join(ops, "alerts.log"), `${at} [ops-flow → ${to}] ${alert.text}\n`)
          alerted++
        }
    }
    await writeAtomic(statePath, `${JSON.stringify(judged.state)}\n`)
    return { alerted, result: "ok" }
  } catch (err) {
    return { alerted, result: err instanceof Error ? err.message : String(err) }
  }
}

// The heartbeat api/hono/src/lib/dashboard/ops.ts reads.
export const beat = (path: string, startedAt: Date, now: Date, lastResult: string) =>
  writeAtomic(
    path,
    `${JSON.stringify({
      cycleSeconds: CYCLE_SECONDS,
      job: "ops-flow",
      lastBeatAt: now.toISOString(),
      lastResult,
      pid: process.pid,
      startedAt: startedAt.toISOString(),
    })}\n`,
  )
