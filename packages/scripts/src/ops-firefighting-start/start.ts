import { rm } from "node:fs/promises"
import { join } from "node:path"

import type { Context } from "../ops-tick/tick"
import { MAX_MINUTES, standing } from "../playground/focus"
import { writeAtomic } from "../write-atomic"

// ops-firefighting-start: each beat reads the relay's firefighting.json and starts one --firefighting worker for each open ticket of firefighting.start.prefixes that no one holds, Urgent, High, Medium, Low and oldest first, at most CAP in progress but for an Urgent, which always starts; its start file keeps spawn.sh's load and slots gates open for those starts while one is open, and focus stands for an Urgent ticket's session alone.

export type StartConfig = {
  account?: string
  brief: string
  freshMinutes: number
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

// What a beat keeps between passes: the session started for each ticket, the line last told for each, when each closed line was first seen closed, when Linear first read each of those open again (the ticket card reads reopened), and when Linear was last asked.
export type State = {
  closedSeen: Record<string, string>
  linearAt?: string
  reopened: Record<string, string>
  started: Record<string, string>
  told: Record<string, string>
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
const lastLine = (out: string) => out.trim().split("\n").at(-1) ?? ""

export const statePath = (ops: string) => join(ops, "ops-firefighting-start.state.json")

export async function startPass({
  config,
  ctx,
  data,
  linearStates,
  name,
}: StartDeps): Promise<void> {
  const path = statePath(ctx.ops)
  const state: State = {
    closedSeen: {},
    reopened: {},
    started: {},
    told: {},
    ...(await readJson<State>(path)),
  }
  const save = () => writeAtomic(path, `${JSON.stringify(state, null, 2)}\n`)
  const tell = async (id: string, text: string) => {
    if (state.told[id] === text) return
    state.told[id] = text
    await save()
    await ctx.send("builder", text)
  }
  const ticket = new RegExp(
    `^(?:${config.prefixes.map((p) => p.replace(/[^A-Za-z0-9]/g, "")).join("|")})-\\d+$`,
  )
  const relay = join(data, "firefighting.json")
  const ff = await readJson<{ lastTry?: number; lines?: Record<string, Line> }>(relay)
  // The relay writes lastTry on every pass inside its window, quiet ones included, and nothing outside it, so lines older than freshMinutes are a closed window's or a stopped relay's: none starts from them, and a focus already standing is left to the session working its ticket.
  const wrote =
    typeof ff?.lastTry === "number"
      ? ff.lastTry
      : (await Bun.file(relay).exists())
        ? Bun.file(relay).lastModified
        : undefined
  if (wrote === undefined || ctx.now.getTime() - wrote > config.freshMinutes * 60_000) {
    await tell(
      "",
      `Starting nothing: firefighting.json's lines are stale since ${wrote === undefined ? "never written" : new Date(wrote).toISOString()}`,
    )
    await rm(join(data, START_FILE), { force: true })
    return
  }
  delete state.told[""]
  const all = Object.values(ff?.lines ?? {})
  const lines = config.prefixes.length
    ? all.filter((l): l is Line & { id: string } => typeof l?.id === "string" && ticket.test(l.id))
    : []
  const rows = (await readJson<{ agents?: Row[] }>(join(data, "roster.json")))?.agents ?? []
  const live = rows.filter((r) => !ENDED.has(r.status ?? ""))
  const rowOf = (session: string) => rows.find((r) => r.name === session)
  // A ticket is held by a live row that carries it or whose title it leads, or by the session this job started for it while that row is not ended, or not yet written.
  const held = (id: string) =>
    live.some((r) => r.ticket === id || r.title === id || (r.title ?? "").startsWith(`${id} `)) ||
    (state.started[id] !== undefined && !ENDED.has(rowOf(state.started[id]!)?.status ?? ""))
  for (const line of lines)
    if (line.theirs === true) await tell(line.id, `Skipped ${line.id}: someone else took it`)
  await reopen(lines, state, ctx.now, linearStates, tell)
  const open = lines.filter(
    (l) => (l.open === true || state.reopened[l.id] !== undefined) && l.theirs !== true,
  )
  const ids = new Set(open.map((l) => l.id))
  for (const id of Object.keys(state.started)) if (!ids.has(id)) delete state.started[id]
  for (const key of Object.keys(state.told))
    if (key && key !== "linear" && !lines.some((l) => key === l.id || key === `${l.id} reopened`))
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
  for (const line of queue) {
    const id = line.id
    if (rankOf(line) !== 0 && inProgress >= CAP) {
      await tell(
        id,
        `Waiting on ${id} (${line.urgency ?? "no urgency"}): ${inProgress} in progress, the cap is ${CAP}`,
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
    if (rankOf(line) === 0) {
      const f = await standing(data, ctx.now)
      if (f?.reason.startsWith(REASON)) {
        heldBy ??= f.session
        await focus(ctx, ["off"])
      }
    }
    const session = await name()
    const brief = `brief-${session}.md`
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
    const spawned = await ctx.run(argv, 300_000)
    if (spawned.code !== 0) {
      await tell(
        id,
        `Not started for ${id}: ${lastLine(spawned.out) || `spawn.sh exited ${spawned.code}`}`,
      )
      continue
    }
    state.started[id] = session
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
      .filter((l) => rankOf(l) === 0)
      .map((l) => l.id)
      .sort(),
    state,
    heldBy,
  )
  await save()
}

// Each closed line not theirs, first seen closed within REOPEN_DAYS, is asked of Linear at most every LINEAR_MS; one Linear reads open again is marked reopened, told once, and joins the queue, and one it reads done again loses the mark.
async function reopen(
  lines: (Line & { id: string })[],
  state: State,
  now: Date,
  linearStates: StartDeps["linearStates"],
  tell: (id: string, text: string) => Promise<void>,
): Promise<void> {
  const closed = lines.filter((l) => l.open !== true && l.theirs !== true)
  for (const l of closed) state.closedSeen[l.id] ??= now.toISOString()
  for (const id of Object.keys(state.closedSeen))
    if (!closed.some((l) => l.id === id)) delete state.closedSeen[id]
  for (const id of Object.keys(state.reopened))
    if (!closed.some((l) => l.id === id)) delete state.reopened[id]
  const recent = closed
    .map((l) => l.id)
    .filter((id) => now.getTime() - Date.parse(state.closedSeen[id]!) <= REOPEN_DAYS * 86_400_000)
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

const focus = (ctx: Context, args: string[]) =>
  ctx.run([
    process.execPath,
    join(ctx.repo, "packages", "scripts", "src", "playground", "cli.ts"),
    "focus",
    ...args,
  ])

// While an open Urgent ticket has a session this job started, focus stands for one such session (the one holding it, else `prefer`, the one that held it before this pass lowered it, else the newest), re-armed under 10 minutes left; once none is open, the focus this job set is lowered and a hand-set one is left.
async function holdFocus(
  ctx: Context,
  data: string,
  urgent: string[],
  state: State,
  prefer?: string,
): Promise<void> {
  const now = ctx.now
  const standingFocus = await standing(data, now)
  const ours = standingFocus?.reason.startsWith(REASON) ?? false
  const sessions = urgent.map((id) => state.started[id]).filter((s): s is string => s !== undefined)
  if (!sessions.length) {
    if (ours && !urgent.length) await focus(ctx, ["off"])
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
  if (!standingFocus) await on()
  else if (
    ours &&
    (Date.parse(standingFocus.until) - now.getTime() < REARM_MS ||
      standingFocus.session !== session)
  ) {
    await focus(ctx, ["off"])
    await on()
  }
}
