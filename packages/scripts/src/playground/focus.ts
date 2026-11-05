import { rename } from "node:fs/promises"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { endFocus, startFocus } from "../pr-merge/held"

// playground focus: one session gets the Mac for a stretch, while every merge, every other session's heavy run and every new session waits; focus.json in the data folder is the one record each part reads, and every part ends at its `until` by itself.

export const MAX_MINUTES = 180
const DEFAULT_MINUTES = 120
// ops' upkeep, which focus never holds (run-slot.sh's focus_holds names the same two)
const UPKEEP = ["ops-dashboard", "ops-tick"]

export type Focus = { reason: string; session: string; since: string; until: string }

export type FocusDeps = {
  data: string
  heldPath: string
  now: () => Date
  runSlot: (args: string[]) => { code: number; err: string }
}

export const focusPath = (data: string) => join(data, "focus.json")

const readFocus = async (data: string): Promise<Focus | undefined> => {
  const file = Bun.file(focusPath(data))
  if (!(await file.exists())) return undefined
  try {
    return (await file.json()) as Focus
  } catch {
    return undefined
  }
}

// The focus standing at `now`, or undefined when none was turned on or it has lapsed
export async function standing(data: string, now: Date): Promise<Focus | undefined> {
  const focus = await readFocus(data)
  return focus && now.getTime() < Date.parse(focus.until) ? focus : undefined
}

const stamp = (at: Date) => at.toISOString().replace(/[-:]/g, "").slice(0, 13) + "Z"

// Every run but the focus session's and ops' upkeep that waited in run-slot while focus stood, read from run-slot.runs.log's ask and start lines: how many, and their waits' seconds inside the focus window in all
export function waits(log: string, focus: Focus, end: Date): { runs: number; seconds: number } {
  const from = Date.parse(focus.since)
  const to = Math.min(end.getTime(), Date.parse(focus.until))
  const asked = new Map<string, number>()
  const waited = new Map<string, number>()
  for (const line of log.split("\n")) {
    const [iso, kind, who, pid] = line.split(" ")
    if (!iso || !who || !pid || who === focus.session || UPKEEP.includes(who)) continue
    const at = Date.parse(iso)
    const run = `${who} ${pid}`
    if (kind === "ask") asked.set(run, at)
    else if ((kind === "start" || kind === "end") && asked.has(run) && !waited.has(run))
      waited.set(run, at)
  }
  let runs = 0
  let ms = 0
  for (const [run, at] of asked) {
    const overlap = Math.min(waited.get(run) ?? to, to) - Math.max(at, from)
    if (overlap <= 0) continue
    runs++
    ms += overlap
  }
  return { runs, seconds: Math.round(ms / 1000) }
}

const on = async (args: string[], deps: FocusDeps): Promise<number> => {
  let values: { for?: string; reason?: string; session?: string }
  try {
    values = parseArgs({
      args,
      options: { for: { type: "string" }, reason: { type: "string" }, session: { type: "string" } },
    }).values
  } catch (error) {
    return fail((error as Error).message)
  }
  const session = values.session ?? ""
  const reason = (values.reason ?? "").trim()
  const minutes = Number(values.for ?? DEFAULT_MINUTES)
  if (!/^[A-Za-z0-9._#-]+$/.test(session)) return fail("focus on takes --session <name>")
  if (!reason) return fail('focus on takes --reason "<why>"')
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES)
    return fail(`focus on takes --for 1 to ${MAX_MINUTES} minutes`)
  const now = deps.now()
  const held = await standing(deps.data, now)
  if (held && held.session !== session)
    return fail(
      `focus stands for ${held.session} until ${held.until}; playground focus off ends it`,
    )
  const until = new Date(now.getTime() + minutes * 60_000)
  const slot = deps.runSlot(["set", session, "focus", "--reason", reason, "--for", `${minutes}m`])
  if (slot.code !== 0) return fail(`run-slot.sh set refused focus: ${slot.err.trim()}`)
  const merges = await startFocus(deps.heldPath, session, until)
  const focus: Focus = { reason, session, since: now.toISOString(), until: until.toISOString() }
  await Bun.write(focusPath(deps.data), `${JSON.stringify(focus, null, 2)}\n`)
  console.log(
    `focus: ${session} until ${focus.until}: merges wait (${merges.line}), other sessions' heavy runs wait, new sessions are refused`,
  )
  return 0
}

const off = async (deps: FocusDeps): Promise<number> => {
  const now = deps.now()
  const focus = await readFocus(deps.data)
  await endFocus(deps.heldPath)
  const ops = join(deps.data, "ops")
  const switchFile = join(ops, "run-slot.focus")
  if (await Bun.file(switchFile).exists())
    await rename(switchFile, `${switchFile}.lifted-${stamp(now)}`)
  if (!focus) {
    console.log("focus: none stands")
    return 0
  }
  await rename(focusPath(deps.data), `${focusPath(deps.data)}.ended-${stamp(now)}`)
  const log = Bun.file(join(ops, "run-slot.runs.log"))
  const { runs, seconds } = waits((await log.exists()) ? await log.text() : "", focus, now)
  console.log(
    `focus ended for ${focus.session}: ${runs} runs waited ${Math.floor(seconds / 60)}m${seconds % 60}s in all (measured from run-slot.runs.log)`,
  )
  return 0
}

const fail = (why: string) => {
  console.error(`playground: ${why}`)
  return 2
}

export async function runFocus([verb, ...args]: string[], deps: FocusDeps): Promise<number> {
  if (verb === "on") return on(args, deps)
  if (verb === "off") return off(deps)
  if (verb !== undefined) return fail(`no focus ${verb}; playground focus on, off, or bare`)
  const focus = await standing(deps.data, deps.now())
  console.log(
    focus
      ? `focus: ${focus.session} until ${focus.until}, since ${focus.since}: ${focus.reason}`
      : "focus: none stands",
  )
  return 0
}
