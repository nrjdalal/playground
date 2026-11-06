import { rm } from "node:fs/promises"
import { join } from "node:path"

import type { Context } from "../ops-tick/tick"
import { MAX_MINUTES, standing } from "../playground/focus"
import { writeAtomic } from "../write-atomic"

// ops-firefighting-start: each beat reads the relay's firefighting.json and starts one --firefighting worker for each open ticket of firefighting.start.prefixes that the tracker's digest lists and no one holds, Urgent, High, Medium, Low and oldest first, at most CAP in progress but for an Urgent, which always starts; its start file keeps spawn.sh's load and slots gates open for those starts while one is open, and focus stands for an Urgent ticket's session alone.

// hours is the UTC start window, "HH:MM-HH:MM" (one past midnight wraps), empty for any time; consultFrom the UTC time inside it from which a ticket is the owner's call, told to the dispatcher rather than started; daysOff the UTC dates it starts nothing on.
export type StartConfig = {
  account?: string
  brief: string
  consultFrom?: string
  daysOff?: string[]
  freshMinutes: number
  hours?: string
  in?: string
  prefixes: string[]
}

export const CAP = 2
// The focus this job turns on reads with this reason, so it lowers only its own.
export const REASON = "Urgent SLA"
// The file spawn.sh's --firefighting reads for this job's starts: it passes the load and slots gates, never focus.
export const START_FILE = "firefighting-start.json"
const REARM_MS = 10 * 60_000
const ENDED = new Set(["closed", "done", "ended", "merged", "parked", "paused"])
const RANK: Record<string, number> = { High: 1, Low: 3, Medium: 2, Urgent: 0 }
// The relay's refresh skips closed lines, so a reopened ticket stays closed in firefighting.json: Linear is asked about each line first seen closed within REOPEN_DAYS, at most every LINEAR_MS.
const REOPEN_DAYS = 3
const LINEAR_MS = 5 * 60_000
const DONE = new Set(["canceled", "completed"])

// A ticket's line as the relay keeps it in firefighting.json.
type Line = {
  busy?: boolean
  id?: unknown
  open?: boolean
  shownAt?: number
  theirs?: boolean
  urgency?: string
  urgent?: boolean
}
type Row = { name?: string; status?: string; ticket?: string; title?: string }

// What a beat keeps between passes: when it first watched, the UTC day each roster row was first seen ended (empty for one already ended on the first beat), the session started for each ticket, the name a ticket whose start was refused keeps, the line last told for each, when each closed line was first seen closed, when Linear first read each of those open again (kept for a ticket card to read), and when Linear was last asked.
export type State = {
  closedSeen: Record<string, string>
  ended: Record<string, string>
  linearAt?: string
  named: Record<string, string>
  reopened: Record<string, string>
  started: Record<string, string>
  told: Record<string, string>
  // when the job first finished a fresh pass inside its window; a stale or out-of-window pass saves state but is no first beat
  watchingSince?: string
}

// linearStates reads each ticket's Linear state type (backlog, unstarted, started, completed, canceled, triage), a ticket Linear does not find left out; it throws when Linear cannot be read.
export type StartDeps = {
  config: StartConfig
  ctx: Context
  data: string
  linearStates: (ids: string[]) => Promise<Record<string, string>>
  name: () => Promise<string>
}

const readJson = async <T>(path: string): Promise<T | undefined> => {
  const file = Bun.file(path)
  if (!(await file.exists())) return undefined
  try {
    return (await file.json()) as T
  } catch {
    return undefined
  }
}

const rankOf = (line: Line) => (line.urgent === true ? 0 : (RANK[line.urgency ?? ""] ?? 4))
const isUrgent = (line: Line) => rankOf(line) === 0
export const lastLine = (out: string) => out.trim().split("\n").at(-1) ?? ""

export const statePath = (ops: string) => join(ops, "ops-firefighting-start.state.json")

export async function startPass({
  config,
  ctx,
  data,
  linearStates,
  name,
}: StartDeps): Promise<void> {
  const path = statePath(ctx.ops)
  const kept = await readJson<State>(path)
  const state: State = {
    closedSeen: {},
    ended: {},
    named: {},
    reopened: {},
    started: {},
    told: {},
    ...kept,
  }
  const save = () => writeAtomic(path, `${JSON.stringify(state, null, 2)}\n`)
  const tell = async (id: string, text: string, to = "builder") => {
    if (state.told[id] === text) return
    state.told[id] = text
    await save()
    await ctx.send(to, text)
  }
  const ticket = new RegExp(
    `^(?:${config.prefixes.map((p) => p.replace(/[^A-Za-z0-9]/g, "")).join("|")})-\\d+$`,
  )
  // The roster keeps no end time, so the job notes the day it first sees each row ended, on every beat, stale or outside the window too; a ticket whose row ended today never starts again today. A row already ended on the job's very first beat, with no state yet, ended before the job ran and counts on no day.
  const day = ctx.now.toISOString().slice(0, 10)
  const roster = await readJson<{ agents?: Row[] }>(join(data, "roster.json"))
  const rows = roster?.agents ?? []
  const rowOf = (session: string) => rows.find((r) => r.name === session)
  const rowsFor = (id: string) =>
    rows.filter((r) => r.ticket === id || r.title === id || (r.title ?? "").startsWith(`${id} `))
  const firstBeat = state.watchingSince === undefined
  for (const r of rows)
    if (r.name && ENDED.has(r.status ?? "")) state.ended[r.name] ??= kept ? day : ""
  // a beat that reads no roster file keeps every ended day it noted
  for (const rowName of roster ? Object.keys(state.ended) : [])
    if (!rows.some((r) => r.name === rowName && ENDED.has(r.status ?? "")))
      delete state.ended[rowName]
  const relay = join(data, "firefighting.json")
  const ff = await readJson<{
    clock?: Record<string, unknown>
    lastTry?: number
    lines?: Record<string, Line>
  }>(relay)
  // The relay writes lastTry on every pass inside its window, quiet ones included, and nothing outside it, so lines older than freshMinutes are a closed window's or a stopped relay's, and a file that does not parse holds no lines to trust: none starts from them, and a focus already standing is left to the session working its ticket.
  const exists = await Bun.file(relay).exists()
  const wrote =
    typeof ff?.lastTry === "number"
      ? ff.lastTry
      : ff && exists
        ? Bun.file(relay).lastModified
        : undefined
  if (wrote === undefined || ctx.now.getTime() - wrote > config.freshMinutes * 60_000) {
    await tell(
      "",
      wrote === undefined && exists
        ? "Starting nothing: firefighting.json does not parse"
        : `Starting nothing: firefighting.json's lines are stale since ${wrote === undefined ? "never written" : new Date(wrote).toISOString()}`,
    )
    await rm(join(data, START_FILE), { force: true })
    await save()
    return
  }
  delete state.told[""]
  // The owner takes tickets only inside the start window: outside it, or on a day off, nothing starts and the start file goes, while a focus already standing is left to its session; the line names the window, never the beat's time or day, so a closed stretch is told once, and the next close once more.
  if (!inWindow(config, ctx.now)) {
    await tell(
      "window",
      `Starting nothing: outside the start window (hours ${config.hours || "any time"}, days off ${(config.daysOff ?? []).join(", ") || "none"})`,
    )
    await rm(join(data, START_FILE), { force: true })
    await save()
    return
  }
  delete state.told.window
  // A ticket taken in the window's last stretch cannot be finished before it ends, so from consultFrom on the job asks the owner through the dispatcher instead of starting one; on the owner's yes the dispatcher hands it to the Builder, who starts it with spawn.sh worker … --firefighting.
  const consult = lastStretch(config, ctx.now)
  const all = Object.values(ff?.lines ?? {})
  const matched = config.prefixes.length
    ? all.filter((l): l is Line & { id: string } => typeof l?.id === "string" && ticket.test(l.id))
    : []
  // Only a ticket the tracker's digest lists is a firefighting one: the relay keeps it in the file's clock map, while a line a mention elsewhere named (an integration or port ask) has no entry, so it never starts; a file with no clock map starts nothing.
  const listed = new Set(Object.keys(ff?.clock ?? {}))
  for (const line of matched)
    if (!listed.has(line.id) && line.open === true)
      await tell(line.id, `Skipped ${line.id}: no digest of the tracker lists it`)
  const lines = matched.filter((l) => listed.has(l.id))
  const endedToday = (id: string) => rowsFor(id).find((r) => r.name && state.ended[r.name] === day)
  // A ticket is held by a live row that carries it or whose title it leads, or by the session this job started for it while that row is not ended, or not yet written.
  const held = (id: string) =>
    rowsFor(id).some((r) => !ENDED.has(r.status ?? "")) ||
    (state.started[id] !== undefined && !ENDED.has(rowOf(state.started[id]!)?.status ?? ""))
  for (const line of lines)
    if (line.theirs === true && line.open === true)
      await tell(line.id, `Skipped ${line.id}: someone else took it`)
  await reopen(lines, state, ctx.now, linearStates, tell, firstBeat)
  const open = lines.filter(
    (l) => (l.open === true || state.reopened[l.id] !== undefined) && l.theirs !== true,
  )
  const ids = new Set(open.map((l) => l.id))
  for (const id of Object.keys(state.started)) if (!ids.has(id)) delete state.started[id]
  // a ticket that closed while its start was refused frees its name and its brief
  for (const [id, session] of Object.entries(state.named))
    if (!ids.has(id)) {
      await rm(join(data, `brief-${session}.md`), { force: true })
      delete state.named[id]
    }
  for (const key of Object.keys(state.told))
    if (key && key !== "linear" && !matched.some((l) => key === l.id || key === `${l.id} reopened`))
      delete state.told[key]
  // The start file names every open ticket this job serves, so it stands while one is open and goes once none is.
  const startFile = join(data, START_FILE)
  if (open.length) {
    const had = await readJson<{ ids?: string[]; since?: string }>(startFile)
    const at = ctx.now.toISOString()
    const named = [...ids].sort()
    if (had?.ids?.join() !== named.join())
      await writeAtomic(
        startFile,
        `${JSON.stringify({ ids: named, since: had?.since ?? at, updatedAt: at })}\n`,
      )
  } else await rm(startFile, { force: true })
  let inProgress = open.filter((l) => held(l.id)).length
  const queue = open
    .filter((l) => l.busy !== true && !held(l.id))
    .sort((a, b) => rankOf(a) - rankOf(b) || (a.shownAt ?? Infinity) - (b.shownAt ?? Infinity))
  // An Urgent start passes this job's own focus, which spawn.sh's start file never does: the focus is lowered for the start and raised again for the session that held it.
  let heldBy: string | undefined
  // an Urgent session this job started that is still live holds every lower line, focus file or not, since an Urgent ticket outranks the rest
  const liveUrgent = open
    .filter(isUrgent)
    .map((l) => state.started[l.id])
    .find((s) => s !== undefined && !ENDED.has(rowOf(s)?.status ?? ""))
  // an Urgent that reaches its start in this pass holds every later High, Medium or Low in it, named as the focus raised after the loop will name it: the session of the last such ticket by ID
  let urgentId: string | undefined
  let urgentStarted: string | undefined
  for (const line of queue) {
    const id = line.id
    const ended = endedToday(id)
    if (ended) {
      await tell(id, `Not starting ${id} again today: ${ended.name}, its session, ended today`)
      continue
    }
    if (!isUrgent(line) && inProgress >= CAP) {
      await tell(
        id,
        `Waiting on ${id} (${line.urgency ?? "no urgency"}): the cap of ${CAP} in progress is reached`,
      )
      continue
    }
    // a ticket ended today or held by the cap is no ticket to ask the owner about
    if (consult) {
      await tell(
        id,
        `consult ${id} (${line.urgency ?? "no urgency"}): it came in after ${config.consultFrom}Z, the start window's last stretch, so the owner decides whether to take it; a yes goes to the Builder, who starts it`,
        "dispatcher",
      )
      continue
    }
    if (!config.in) {
      await tell(
        id,
        `Not started for ${id}: firefighting.start.in names no folder for its --in; set it with playground settings set firefighting.start.in <folder> --reason "<why>"`,
      )
      continue
    }
    const template = Bun.file(join(data, config.brief))
    if (!(await template.exists())) {
      await tell(
        id,
        `Not started for ${id}: the standing brief ${config.brief}, which firefighting.start.brief names, is not in ${data}`,
      )
      continue
    }
    // spawn.sh lets every --firefighting start past focus while the relay's stop file stands, and cannot tell an Urgent from the rest, so the job holds its own: a High, Medium or Low waits while any focus stands.
    const f = await standing(data, ctx.now)
    const holder = f?.session ?? heldBy ?? urgentStarted ?? liveUrgent
    if (holder && !isUrgent(line)) {
      await tell(
        id,
        `Waiting on ${id} (${line.urgency ?? "no urgency"}): focus stands for ${holder}`,
      )
      continue
    }
    if (f?.reason.startsWith(REASON)) {
      heldBy ??= f.session
      await focus(ctx, ["off"])
    }
    // a ticket keeps the name its first try took, so a refused start retries under it, with one brief
    const session = state.named[id] ?? (await name())
    state.named[id] = session
    await save()
    const brief = `brief-${session}.md`
    // a retry under the kept name reuses the brief its first try wrote
    if (!(await Bun.file(join(data, brief)).exists()))
      await Bun.write(
        join(data, brief),
        (await template.text()).replaceAll("{TICKET}", id).replaceAll("{NAME}", session),
      )
    const argv = [
      join(ctx.repo, "scripts", "spawn.sh"),
      "worker",
      session,
      brief,
      "--title",
      `${id} firefight`,
      "--in",
      config.in,
      "--size",
      "medium",
      "--firefighting",
      ...(config.account ? ["--account", config.account] : []),
    ]
    if (isUrgent(line) && (urgentId === undefined || id > urgentId)) {
      urgentId = id
      urgentStarted = session
    }
    const spawned = await ctx.run(argv, 300_000)
    // told once per reason: the session's name is taken out, so the same refusal reads the same on every retry
    if (spawned.code !== 0) {
      const why = lastLine(spawned.out).replace(/^spawn\.sh refuses \S+: /, "")
      await tell(id, `Not started for ${id}: ${why || `spawn.sh exited ${spawned.code}`}`)
      continue
    }
    state.started[id] = session
    delete state.named[id]
    inProgress++
    await save()
    const set = await ctx.run([
      process.execPath,
      join(ctx.repo, "scripts", "roster.ts"),
      "set",
      session,
      `ticket=${id}`,
    ])
    const unset = set.code === 0 ? "" : `; its roster row lacks ticket=${id}: ${lastLine(set.out)}`
    await tell(
      id,
      `Started ${session} for ${id} (${line.urgency ?? "no urgency"}) with --firefighting, from ${config.brief}${unset}`,
    )
  }
  await holdFocus(
    ctx,
    data,
    open
      .filter(isUrgent)
      .map((l) => l.id)
      .sort(),
    state,
    (session) => !ENDED.has(rowOf(session)?.status ?? ""),
    heldBy,
  )
  state.watchingSince ??= ctx.now.toISOString()
  await save()
}

// Each closed line not theirs, first seen closed within REOPEN_DAYS, is asked of Linear at most every LINEAR_MS; one Linear reads open again is marked reopened, told once, and joins the queue, and one it reads done again loses the mark.
async function reopen(
  lines: (Line & { id: string })[],
  state: State,
  now: Date,
  linearStates: StartDeps["linearStates"],
  tell: (id: string, text: string) => Promise<void>,
  firstBeat: boolean,
): Promise<void> {
  const closed = lines.filter((l) => l.open !== true && l.theirs !== true)
  // On the first beat, before the job has finished a fresh pass, a line already closed closed before the job ran, at a time no line holds, so it counts as closed long ago and is never asked.
  const seen = firstBeat ? new Date(0).toISOString() : now.toISOString()
  for (const l of closed) state.closedSeen[l.id] ??= seen
  for (const id of Object.keys(state.closedSeen))
    if (!closed.some((l) => l.id === id)) delete state.closedSeen[id]
  for (const id of Object.keys(state.reopened))
    if (!closed.some((l) => l.id === id)) delete state.reopened[id]
  // a line marked reopened is asked past REOPEN_DAYS too, so the mark goes once Linear reads it done again
  const recent = closed
    .map((l) => l.id)
    .filter(
      (id) =>
        state.reopened[id] !== undefined ||
        now.getTime() - Date.parse(state.closedSeen[id]!) <= REOPEN_DAYS * 86_400_000,
    )
  if (!recent.length || (state.linearAt && now.getTime() - Date.parse(state.linearAt) < LINEAR_MS))
    return
  state.linearAt = now.toISOString()
  let read: Record<string, string>
  try {
    read = await linearStates(recent)
  } catch (err) {
    await tell(
      "linear",
      `Reopened tickets unread: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
    )
    return
  }
  delete state.told.linear
  for (const id of recent) {
    const type = read[id]
    if (type === undefined) continue
    if (DONE.has(type)) {
      delete state.reopened[id]
      delete state.told[`${id} reopened`]
    } else if (state.reopened[id] === undefined) {
      state.reopened[id] = now.toISOString()
      await tell(`${id} reopened`, `${id} reopened`)
    }
  }
}

// From `from` up to `to`, both HH:MM, wrapping past midnight when `to` is the earlier.
const within = (at: string, from: string, to: string) =>
  from <= to ? at >= from && at < to : at >= from || at < to

// Inside config.hours at `now` (UTC), and on no day of config.daysOff.
const inWindow = (config: StartConfig, now: Date): boolean => {
  const iso = now.toISOString()
  if ((config.daysOff ?? []).includes(iso.slice(0, 10))) return false
  const [from, to] = (config.hours ?? "").split("-")
  return !from || !to || within(iso.slice(11, 16), from, to)
}

// From config.consultFrom to the window's end, read inside the window: up to midnight with no hours set, and never for a consultFrom outside the hours.
const lastStretch = (config: StartConfig, now: Date): boolean => {
  if (!config.consultFrom) return false
  const at = now.toISOString().slice(11, 16)
  const [from, to] = (config.hours ?? "").split("-")
  if (!from || !to) return at >= config.consultFrom
  return within(config.consultFrom, from, to) && within(at, config.consultFrom, to)
}

const focus = (ctx: Context, args: string[]) =>
  ctx.run([
    process.execPath,
    join(ctx.repo, "packages", "scripts", "src", "playground", "cli.ts"),
    "focus",
    ...args,
  ])

// While an open Urgent ticket has a session this job started whose roster row has not ended, focus stands for one such session (the one holding it, else `prefer`, the one that held it before this pass lowered it, else the newest), re-armed under 10 minutes left; once no such live session is left, whether no Urgent is open, each such session has ended, or every open Urgent is one another session holds, the focus this job set is lowered and a hand-set one is left.
async function holdFocus(
  ctx: Context,
  data: string,
  urgent: string[],
  state: State,
  live: (session: string) => boolean,
  prefer?: string,
): Promise<void> {
  const now = ctx.now
  const standingFocus = await standing(data, now)
  const ours = standingFocus?.reason.startsWith(REASON) ?? false
  const started = urgent.map((id) => state.started[id]).filter((s): s is string => s !== undefined)
  // a session whose roster row ended holds no focus, though its ticket stays open
  const sessions = started.filter(live)
  if (!sessions.length) {
    if (ours) await focus(ctx, ["off"])
    return
  }
  const session =
    [standingFocus?.session, prefer].find((s) => s !== undefined && sessions.includes(s)) ??
    sessions.at(-1)!
  const on = () =>
    focus(ctx, [
      "on",
      "--session",
      session,
      "--reason",
      `${REASON} ${urgent.join(" ")} open`,
      "--for",
      String(MAX_MINUTES),
    ])
  // the same session's on extends its focus, so a re-arm needs no off and posts no focus-ended card; a new session takes an off first, since on refuses while another's focus stands
  if (!standingFocus) await on()
  else if (ours && standingFocus.session !== session) {
    await focus(ctx, ["off"])
    await on()
  } else if (ours && Date.parse(standingFocus.until) - now.getTime() < REARM_MS) await on()
}
