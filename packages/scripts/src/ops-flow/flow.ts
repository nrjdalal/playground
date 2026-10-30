import { appendFile, mkdir, readdir, stat } from "node:fs/promises"
import { join } from "node:path"

import { writeAtomic } from "../write-atomic"

// ops-flow: two merge stalls on 19 Oct were seen by the owner before any lead; the rule since: a ready-line PR with no gate run moving for 10 min, or a run-slot holder over 15 min, alerts the leads. Each cycle reads the leads' ready line, the gate logs, the process table and the run-slot holders, and queues one line for each lead in the ops outbox per stall, which the relay sends with SendMessage (ADR 0010). It signals nothing.
export const CYCLE_SECONDS = 60
export const STALL_MS = 10 * 60_000
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

export type Entry = { goAt?: string; nextGate?: string; pr: number; readyAt: string }
export type Proc = { command: string; pid: number }
export type Holder = { command: string; pid: number; since: string; slot: string; who: string }
type State = { alerted: string[]; moved: Record<string, string> }

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
const hhmm = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)}Z`
const mins = (ms: number): number => Math.floor(ms / 60_000)

// Pure: the ready line's entries (merge-queue.json's `queue`) a stall can be judged on: a PR whose next gate (the first one its nextGate names) is local CI or Checks, ops' own gates, or that names none and has a local CI go; a next gate of review, or a round as the leads word a re-gate ("small round"), wins over an older go, since a review round has no process here to watch and runs for longer than 10 minutes as a matter of course (a review once re-gated a PR after its go).
export function readyLine(text: string): Entry[] {
  let entries: unknown
  try {
    entries = (JSON.parse(text) as { queue?: unknown }).queue
  } catch {
    return []
  }
  if (!Array.isArray(entries)) return []
  return entries.flatMap((raw): Entry[] => {
    const e = raw as Record<string, unknown>
    if (typeof e.pr !== "number" || typeof e.readyAt !== "string" || isNaN(Date.parse(e.readyAt)))
      return []
    const goAt = typeof e.goAt === "string" && !isNaN(Date.parse(e.goAt)) ? e.goAt : undefined
    const nextGate = typeof e.nextGate === "string" ? e.nextGate : undefined
    const first = /\b(review|round)|checks|local ci/i.exec(nextGate ?? "")?.[0].toLowerCase()
    if (
      first === "review" ||
      first === "round" ||
      (!goAt && first !== "checks" && first !== "local ci")
    )
      return []
    return [{ goAt, nextGate, pr: e.pr, readyAt: e.readyAt }]
  })
}

// Pure: whether a process is a local CI or Checks run for pr: localci/run.py or checks/*.py with pr among its words, or run-slot's ops-checks-<n...> ticket name (an older lead-name prefix before the managers took role names).
export function gateProcess(command: string, pr: number): boolean {
  const n = String(pr)
  if (/(localci\/run\.py|checks\/(parallel|checks)\.py)\b/.test(command))
    if (command.split(/\s+/).includes(n)) return true
  return new RegExp(`checks-(\\d+-)*${n}(-|\\s|$)`).test(command)
}

// Pure: the newest time a gate log line names pr ("<iso> ... #<pr>" not followed by a digit), or null.
export function lastGateLine(lines: string[], pr: number): number | null {
  const re = new RegExp(`#${pr}(?!\\d)`)
  let newest: number | null = null
  for (const line of lines) {
    const at = Date.parse(line.slice(0, line.indexOf(" ")))
    if (!isNaN(at) && re.test(line) && (newest === null || at > newest)) newest = at
  }
  return newest
}

// Pure: a holder line "<who> <pid> <iso>" for a slot whose directory exists, alive while its pid is in the process table.
export function holderOf(slot: string, line: string, procs: Proc[]): Holder | null {
  const [who, pidText, since] = line.trim().split(/\s+/)
  const pid = Number(pidText)
  if (!who || !Number.isInteger(pid) || !since || isNaN(Date.parse(since))) return null
  const proc = procs.find((p) => p.pid === pid)
  return proc ? { command: proc.command, pid, since, slot, who } : null
}

export type Alert = { key: string; text: string }

// Pure: this cycle's alerts and the state to keep. A stall starts at the latest of readyAt, goAt and the PR's last movement, so a stall that clears and comes back is a new key and alerts again; a key no longer stalled leaves the state.
export function judge(input: {
  entries: Entry[]
  holders: Holder[]
  lines: string[]
  now: number
  open?: Set<number>
  procs: Proc[]
  state: State
}): { alerts: Alert[]; state: State } {
  const { entries, holders, lines, now, open, procs, state } = input
  const moved: Record<string, string> = {}
  const current: Alert[] = []
  for (const e of entries) {
    if (open && !open.has(e.pr)) continue
    const times = [Date.parse(e.readyAt)]
    if (e.goAt) times.push(Date.parse(e.goAt))
    const kept = state.moved[e.pr]
    if (kept) times.push(Date.parse(kept))
    const line = lastGateLine(lines, e.pr)
    if (line !== null) times.push(line)
    if (procs.some((p) => gateProcess(p.command, e.pr))) times.push(now)
    const start = Math.max(...times)
    moved[e.pr] = iso(start)
    if (now - start < STALL_MS) continue
    const gate = e.nextGate ? ` Next gate: ${e.nextGate}.` : ""
    current.push({
      key: `stall ${e.pr} ${iso(start)}`,
      text: `#${e.pr} is in the ready line with no local CI or Checks moving for ${mins(now - start)} min (since ${hhmm(start)}).${gate}`,
    })
  }
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
    state: { alerted: current.map((a) => a.key), moved },
  }
}

const readText = (path: string): Promise<string> =>
  Bun.file(path)
    .text()
    .catch(() => "")

const tail = async (path: string): Promise<string[]> => {
  const file = Bun.file(path)
  const size = await file.size
  if (!size) return []
  return (
    await file
      .slice(Math.max(0, size - 256 * 1024))
      .text()
      .catch(() => "")
  ).split("\n")
}

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
  open?: Set<number>
  procs: Proc[]
  whoOf: (kind: string) => Promise<string>
}): Promise<{ alerted: number; result: string }> {
  const { data, now = new Date(), open, procs, whoOf } = options
  let alerted = 0
  try {
    const ops = join(data, "ops")
    const statePath = join(ops, "flow", "state.json")
    let state: State = { alerted: [], moved: {} }
    try {
      const read = JSON.parse(await readText(statePath)) as Partial<State>
      state = {
        alerted: Array.isArray(read.alerted)
          ? read.alerted.filter((k) => typeof k === "string")
          : [],
        moved: read.moved && typeof read.moved === "object" ? read.moved : {},
      }
    } catch {}
    const lines = [
      ...(await tail(join(ops, "localci", "localci.log"))),
      ...(await tail(join(ops, "checks", "checks.log"))),
    ]
    const judged = judge({
      entries: readyLine(await readText(join(data, "merge-queue.json"))),
      holders: await holders(ops, procs),
      lines,
      now: now.getTime(),
      open,
      procs,
      state,
    })
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
