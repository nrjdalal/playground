import { readdir, rename } from "node:fs/promises"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { endFocus, startFocus } from "../pr-merge/held"

// playground focus: one session gets the Mac for a stretch, while every merge, every other session's heavy run and every new session but its own reviewer and tester and a priority start waits, and the Inbox holds what comes in quiet; focus.json in the data folder is the one record each part reads, every part ends at its `until` by itself, and ops-tick's focus-card beat posts the Inbox card once it has.

export const MAX_MINUTES = 180
const DEFAULT_MINUTES = 120
// ops' upkeep, which focus never holds (run-slot.sh's focus_spares names the same two)
export const UPKEEP = ["ops-dashboard", "ops-tick"]

export type Focus = { reason: string; session: string; since: string; until: string }

export type FocusDeps = {
  data: string
  heldPath: string
  now: () => Date
  runSlot: (args: string[]) => { code: number; err: string }
}

export const focusPath = (data: string) => join(data, "focus.json")

const readFocus = async (data: string, path = focusPath(data)): Promise<Focus | undefined> => {
  const file = Bun.file(path)
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

// Whether pid runs, for an ask the log closes with no start or end line
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Every run but the focus session's and ops' upkeep that queued in run-slot while focus stood, read from run-slot.runs.log's ask, start and end lines: how many, and their waits' seconds inside the focus window in all. An ask with neither line counts only when it came inside the window and its waiter still runs, since a waiter killed in the queue writes neither.
export function waits(
  log: string,
  focus: Focus,
  end: Date,
  running: (pid: number) => boolean = alive,
): { runs: number; seconds: number } {
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
    if (!waited.has(run) && (at < from || !running(Number(run.split(" ")[1])))) continue
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
  // a lapsed focus whose card has not posted yet is set aside for the beat, so a new focus never overwrites it
  const lapsed = held ? undefined : await readFocus(deps.data)
  if (lapsed)
    await rename(
      focusPath(deps.data),
      `${focusPath(deps.data)}.uncarded-${lapsed.since.replace(/[-:.]/g, "")}`,
    )
  const slot = deps.runSlot(["set", session, "focus", "--reason", reason, "--for", `${minutes}m`])
  if (slot.code !== 0) return fail(`run-slot.sh set refused focus: ${slot.err.trim()}`)
  let merges: { kept: boolean; line: string }
  try {
    merges = await startFocus(deps.heldPath, session, until)
  } catch (error) {
    await lift(deps.data, now)
    return fail(`focus is off, since merges could not be held: ${(error as Error).message}`, 1)
  }
  // the same session's on extends its focus, so what came in since it began stays quiet and its card counts from the start
  const since = held?.since ?? now.toISOString()
  const focus: Focus = { reason, session, since, until: until.toISOString() }
  await Bun.write(focusPath(deps.data), `${JSON.stringify(focus, null, 2)}\n`)
  console.log(
    `focus: ${session} until ${focus.until}: merges wait (${merges.line}), other sessions' heavy runs wait, new sessions are refused`,
  )
  return 0
}

// run-slot.focus lifted through the .lifted move, when it stands
const lift = async (data: string, now: Date) => {
  const path = join(data, "ops", "run-slot.focus")
  if (await Bun.file(path).exists()) await rename(path, `${path}.lifted-${stamp(now)}`)
}

// The measured line for a focus that ended at end, from run-slot.runs.log
const summary = async (data: string, focus: Focus, end: Date) => {
  const log = Bun.file(join(data, "ops", "run-slot.runs.log"))
  const { runs, seconds } = waits((await log.exists()) ? await log.text() : "", focus, end)
  return `${runs} runs queued while it stood, ${Math.floor(seconds / 60)}m${seconds % 60}s in all`
}

// off ends a standing focus at now, so its record lapses and the focus-card beat posts its card
const off = async (deps: FocusDeps): Promise<number> => {
  const now = deps.now()
  const focus = await readFocus(deps.data)
  await lift(deps.data, now)
  if (focus && now.getTime() < Date.parse(focus.until))
    await Bun.write(
      focusPath(deps.data),
      `${JSON.stringify({ ...focus, until: now.toISOString() }, null, 2)}\n`,
    )
  let merges: "kept" | "none" | "removed"
  try {
    merges = await endFocus(deps.heldPath)
  } catch (error) {
    return fail(`focus's merge hold stays: ${(error as Error).message}`, 1)
  }
  if (merges === "kept")
    console.log(`focus: merges stay held by another "*" line in ${deps.heldPath}`)
  if (!focus) {
    console.log("focus: none stands")
    return 0
  }
  console.log(
    `focus ended for ${focus.session}: ${await summary(deps.data, focus, now)} (measured from run-slot.runs.log)`,
  )
  return 0
}

export type FocusCard = {
  kind: "update"
  preview: { outcome: "finding"; text: string }
  title: string
}

// The focus-card beat: once a focus has lapsed, by off or at its end, the Inbox gets one update naming what queued while it stood, and its record is set aside as .ended so the card posts once; that is focus.json and each .uncarded record a later on set aside. post throws when a card did not post, which leaves its record for the next beat.
export async function focusCard(
  data: string,
  now: Date,
  post: (card: FocusCard, focus: Focus) => Promise<void>,
): Promise<"none" | "posted" | "standing"> {
  const names = (await readdir(data).catch(() => [] as string[])).filter(
    (name) => name === "focus.json" || name.startsWith("focus.json.uncarded-"),
  )
  const records: { focus: Focus; path: string }[] = []
  for (const name of names) {
    const focus = await readFocus(data, join(data, name))
    if (focus) records.push({ focus, path: join(data, name) })
  }
  let result: "none" | "posted" | "standing" = "none"
  // oldest first, so the cards read in the order the focuses stood
  for (const { focus, path } of records.sort((a, b) =>
    a.focus.since.localeCompare(b.focus.since),
  )) {
    if (now.getTime() < Date.parse(focus.until)) {
      if (result === "none") result = "standing"
      continue
    }
    await postCard(focus, data, post)
    await rename(
      path,
      `${focusPath(data)}.ended-${stamp(now)}-${focus.since.replace(/[-:.]/g, "")}`,
    )
    result = "posted"
  }
  return result
}

const postCard = async (
  focus: Focus,
  data: string,
  post: (card: FocusCard, focus: Focus) => Promise<void>,
) =>
  post(
    {
      kind: "update",
      preview: {
        outcome: "finding",
        text: `Focus was for: ${focus.reason}\nMeasured from run-slot.runs.log.\nWhat came into the Inbox while it stood counts again.`,
      },
      title: `Focus for ${focus.session} ended: ${await summary(data, focus, new Date(focus.until))}`,
    },
    focus,
  )

const fail = (why: string, code = 2) => {
  console.error(`playground: ${why}`)
  return code
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
