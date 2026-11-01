import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { parseSessionState, sessionStateDir } from "@packages/config/session-state"

import { readMachine } from "../ops-machine/machine"
import type { Run } from "../ops-tick/tick"

// health-beat: the owner's health beat as text, the Mac, its memory, the sessions, the ops jobs and the battery, read once and printed; the session that runs the beat posts it.

export type Reading = {
  at: Date
  battery: { pct: number; state: string } | null
  cores: number
  down: string[]
  freeMin: number
  freePct: number
  idlePct: number | null
  late: string[]
  load5: number
  ok: number
  pressure: number
  sessions: Record<string, number>
  zone: string
}

const LOAD_WARN = 15
const PRESSURE_NAMES: Record<number, string> = { 1: "normal", 2: "warning", 4: "critical" }
const SESSIONS_WITHIN_MS = 2 * 3600_000

// Pure: spawn.sh's memory gate for a Claude start (its gate 2; a GLM start takes a stricter one), which passes a start at pressure level 1 or 2 and free at the gates.memoryFreeMin setting's floor or more (8% by default).
export const memoryPasses = (pressure: number, freePct: number, freeMin: number): boolean =>
  (pressure === 1 || pressure === 2) && freePct >= freeMin

// The zone's own short name (IST, UTC, EDT) over a GMT offset where one locale has it, as the dashboard's ownerTime names it.
const zoneName = (at: Date, zone: string): string => {
  const names = ["en-US", "en-IN"].map(
    (locale) =>
      new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "short" })
        .formatToParts(at)
        .find((part) => part.type === "timeZoneName")?.value ?? zone,
  )
  return names.find((name) => !name.startsWith("GMT")) ?? names[0]!
}

// Pure: a moment as the owner reads it in their zone, `6:05 pm UTC`.
const ownerClock = (at: Date, zone: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).formatToParts(at)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return `${part("hour")}:${part("minute")} ${part("dayPeriod").toLowerCase()} ${zoneName(at, zone)}`
}

const mark = (warn: boolean) => (warn ? "⚠️" : "✅")

// Pure: the beat's text, one line a part.
export const beatText = (r: Reading): string => {
  const memoryOk = memoryPasses(r.pressure, r.freePct, r.freeMin)
  const stuck = (r.sessions.stuck ?? 0) + (r.sessions.failed ?? 0)
  return [
    `*Health, ${ownerClock(r.at, r.zone)}*`,
    `${mark(r.load5 > LOAD_WARN)} Mac: load ${r.load5.toFixed(0)} on ${r.cores} cores, ${r.idlePct === null ? "?" : r.idlePct.toFixed(0)}% CPU idle`,
    `${mark(!memoryOk)} Memory: pressure ${r.pressure} (${PRESSURE_NAMES[r.pressure] ?? "unknown"}), ${r.freePct}% free${memoryOk ? "" : ", so spawn's gate refuses a Claude start"}`,
    `${mark(stuck > 0)} Sessions: ${r.sessions.working ?? 0} working, ${r.sessions.idle ?? 0} idle, ${stuck} stuck`,
    `${mark(r.late.length + r.down.length > 0)} Ops jobs: ${r.ok} ok${r.late.length ? `, late: ${r.late.join(", ")}` : ""}${r.down.length ? `, down: ${r.down.join(", ")}` : ""}`,
    `🔋 ${r.battery ? `${r.battery.pct}%, ${r.battery.state}` : "?"}`,
  ].join("\n")
}

const readJson = async (path: string): Promise<Record<string, unknown> | null> => {
  try {
    return (await Bun.file(path).json()) as Record<string, unknown>
  } catch {
    return null
  }
}

// Each session's newest state written in the last 2 hours, counted by state.
const readSessions = async (data: string, at: Date): Promise<Record<string, number>> => {
  const dir = sessionStateDir(data)
  const counts: Record<string, number> = {}
  for (const file of await readdir(dir).catch(() => [])) {
    if (!file.endsWith(".json")) continue
    const record = parseSessionState(await Bun.file(join(dir, file)).text())
    if (!record || at.getTime() - Date.parse(record.at) >= SESSIONS_WITHIN_MS) continue
    counts[record.state] = (counts[record.state] ?? 0) + 1
  }
  return counts
}

// Each job in ops/jobs.json not marked disabled: down with no readable heartbeat, as the Dashboard's ops.ts calls it, ok while its last result is ok and its beat is under three cycles (at least 10 minutes) old, else late.
const readJobs = async (
  ops: string,
  at: Date,
): Promise<{ down: string[]; late: string[]; ok: number }> => {
  const jobs = (await readJson(join(ops, "jobs.json")))?.jobs
  const down: string[] = []
  const late: string[] = []
  let ok = 0
  for (const job of Array.isArray(jobs) ? (jobs as Record<string, unknown>[]) : []) {
    if (job.disabled === true) continue
    const beat = await readJson(join(ops, `${String(job.heartbeat ?? job.name)}.json`))
    if (!beat) {
      down.push(String(job.name))
      continue
    }
    const window = Math.max(3 * Number(beat.cycleSeconds ?? 60), 600) * 1000
    const fresh = at.getTime() - Date.parse(String(beat.lastBeatAt)) < window
    if (fresh && beat.lastResult === "ok") ok++
    else late.push(String(job.name))
  }
  return { down, late, ok }
}

// Reads everything the beat prints, once: the Mac's load and memory through ops-machine's read, the CPU's idle share from top, and the battery from pmset.
export const readBeat = async (input: {
  at: Date
  data: string
  freeMin: number
  run: Run
  zone: string
}): Promise<Reading> => {
  const { at, data, run } = input
  const ops = join(data, "ops")
  const machine = await readMachine(run, ops, [], at)
  const top = (await run(["top", "-l", "2", "-s", "1", "-n", "0"])).out
  const cpu =
    top
      .split("\n")
      .filter((line) => line.startsWith("CPU usage"))
      .at(-1) ?? ""
  const idle = /([\d.]+)% idle/.exec(cpu)
  const batt = /(\d+)%; ([^;]+)/.exec((await run(["pmset", "-g", "batt"])).out)
  const jobs = await readJobs(ops, at)
  return {
    at,
    battery: batt ? { pct: Number(batt[1]), state: batt[2]!.trim() } : null,
    cores: machine.cores,
    down: jobs.down,
    freeMin: input.freeMin,
    freePct: machine.freePct,
    idlePct: idle ? Number(idle[1]) : null,
    late: jobs.late,
    load5: machine.load5,
    ok: jobs.ok,
    pressure: machine.pressure,
    sessions: await readSessions(data, at),
    zone: input.zone,
  }
}
