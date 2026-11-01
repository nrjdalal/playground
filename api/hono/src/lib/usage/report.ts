import {
  kindOf,
  kindOfName,
  managerKindOfName,
  type RosterKind,
  slotOfName,
} from "@packages/config/kinds"
import { claudeEntry, claudeSession, type Database, db } from "@packages/db"
import { inArray, sql } from "drizzle-orm"

import { readAccounts } from "@/lib/dashboard/account"
import { cachedBy } from "@/lib/dashboard/agents"
import { readRoster, type Roster } from "@/lib/dashboard/roster"
import { shownHere } from "@/lib/sessions/read"
import { costOf, modelKey, priceOf } from "@/lib/usage/prices"
import { mergedPrs, type MergedPr } from "@/lib/usage/prs"
import {
  type AccountUsage,
  noUsageProblem,
  readUsage,
  type Usage,
  usagePath,
  type UsageWindow,
} from "@/lib/usage/window"
import { readZaiFailure, readZaiUsage, type ZaiUsage, zaiProblem } from "@/lib/usage/zai"

// What the Usage app shows: the usage windows with a forecast, and every assistant call in the claude_* tables over the last 7 days as tokens and API-equivalent dollars, by agent, session, model and hour, then each merged PR's cost. Read-only. Each message counts once, from its last line (highest seq), as the importer's own totals do.

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
const BUCKET_MS = 15 * 60 * 1000
const TOP_SESSIONS = 20
const CALIBRATION_GAP = 0.1
const READS_TTL_MS = 30_000

// One session's calls on one model in one 15-minute slot.
export type Bucket = {
  at: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h: number
  calls: number
  input: number
  model: string | null
  output: number
  sessionId: string
}

export type SessionRow = {
  agentType: string | null
  costUsd: number | null
  gitBranch: string | null
  id: string
  kind: string | null
  name: string | null
  parentId: string | null
  prUrls: string[]
  startedAt: number | null
  task: string | null
}

export type Spend = { calls: number; tokens: number; usd: number }

export type Role =
  | "dispatcher"
  | "fork"
  | "headless"
  | "lead"
  | "other"
  | "probe"
  | "reviewer"
  | "runner"
  | "subagent"
  | "tester"
  | "worker"

export type Forecast = { beforeReset: boolean; perHour: number; runsOutAt: string | null }

export type WindowView = UsageWindow & { forecast: Forecast | null }

export type UsageReport = {
  // Every account's own usage file, the main login first; with fewer than two the Usage windows show windows alone.
  accounts: AccountUsage[]
  agents: { label: string; role: Role; today: Spend; week: Spend }[]
  calibration: { claudeCodeUsd: number; sessions: number; usd: number } | null
  hours: { at: string; tokens: number; usd: number }[]
  models: { model: string; priced: boolean; today: Spend; week: Spend }[]
  problems: string[]
  prs: PrCost[]
  prsPending: boolean
  sessions: {
    id: string
    label: string
    parent: string | null
    role: Role
    today: Spend
    week: Spend
  }[]
  totals: { today: Spend; week: Spend }
  windows: {
    fiveHour: WindowView | null
    sevenDay: WindowView | null
    stale: boolean
    writtenAt: string
  } | null
  zai: ZaiUsage | null
}

export type PrCost = {
  fixes: number[]
  mergedAt: string
  number: number
  repo: string
  review: Spend
  rounds: number
  test: Spend
  title: string
  total: Spend
  url: string
  wallMinutes: number | null
  worker: string
  workerSpend: Spend
}

const zero = (): Spend => ({ calls: 0, tokens: 0, usd: 0 })

const tokensOf = (b: Bucket): number => b.input + b.output + b.cacheRead + b.cacheWrite

const usdOf = (b: Bucket): number => costOf(b.model, b) ?? 0

const add = (spend: Spend, b: Bucket, share = 1): void => {
  spend.calls += b.calls * share
  spend.tokens += tokensOf(b) * share
  spend.usd += usdOf(b) * share
}

const plus = (a: Spend, b: Spend): Spend => ({
  calls: a.calls + b.calls,
  tokens: a.tokens + b.tokens,
  usd: a.usd + b.usd,
})

// What the roster says of each session name: its kind, and for a reviewer or tester the worker it checks.
export type RosterLinks = { kinds: Map<string, RosterKind>; workers: Map<string, string> }

const NO_LINKS: RosterLinks = { kinds: new Map(), workers: new Map() }

export const rosterLinks = (roster: Roster | null): RosterLinks => ({
  kinds: new Map(
    (roster?.agents ?? []).flatMap((agent) =>
      agent.kind ? [[agent.name, agent.kind] as const] : [],
    ),
  ),
  workers: new Map(
    (roster?.agents ?? []).flatMap((agent) =>
      agent.worker ? [[agent.name, agent.worker] as const] : [],
    ),
  ),
})

const ROLE_OF_KIND: Record<RosterKind, Role> = {
  builder: "lead",
  dispatcher: "dispatcher",
  ops: "lead",
  optimizer: "lead",
  planner: "lead",
  probe: "probe",
  researcher: "worker",
  reviewer: "reviewer",
  runner: "runner",
  tester: "tester",
  worker: "worker",
}

// Pure: a session's role, from the roster's kind for its name, else from its name as the factory names its sessions, else from its session kind, as gluttony's report queries read it.
export function roleOf(
  session: Pick<SessionRow, "kind" | "name">,
  kinds: Map<string, RosterKind> = NO_LINKS.kinds,
): Role {
  const name = session.name ?? ""
  const kind = kinds.get(name)
  if (kind) return ROLE_OF_KIND[kind]
  if (slotOfName(name) !== null) return "dispatcher"
  if (managerKindOfName(name)) return "lead"
  const named = kindOfName(name)
  if (named) return ROLE_OF_KIND[named]
  if (session.kind === "subagent" || session.kind === "headless" || session.kind === "fork") {
    return session.kind
  }
  return "other"
}

// Pure: how a session is named on the page: its name, else its subagent type, else the slash command it ran, else its id's start.
export function labelOf(session: SessionRow): string {
  if (session.name) return session.name
  if (session.agentType) return session.agentType
  if (session.task?.startsWith("/")) return session.task.split(" ")[0] ?? session.task
  return `id:${session.id.slice(0, 8)}`
}

// Pure: the session at the top of a session's parents, which its spend rolls up to as an agent (a subagent's calls are its parent's work). A missing parent or a loop stops the climb.
export function rootOf(id: string, sessions: Map<string, SessionRow>): string {
  const seen = new Set<string>()
  let current = id
  while (!seen.has(current)) {
    seen.add(current)
    const parent = sessions.get(current)?.parentId
    if (!parent || !sessions.has(parent)) return current
    current = parent
  }
  return current
}

// Pure: at the window's burn so far, when it runs out and whether that comes before it resets. The window opened `hours` before its reset; with nothing used yet there is no burn to project.
export function forecastOf(window: UsageWindow, hours: number, now: Date): Forecast | null {
  if (!window.resetsAt) return null
  const resets = Date.parse(window.resetsAt)
  const elapsed = (now.getTime() - (resets - hours * HOUR_MS)) / HOUR_MS
  if (!(elapsed > 0) || window.usedPercent <= 0) {
    return { beforeReset: false, perHour: 0, runsOutAt: null }
  }
  const perHour = window.usedPercent / elapsed
  const left = Math.max(0, 100 - window.usedPercent)
  const runsOut = now.getTime() + (left / perHour) * HOUR_MS
  return { beforeReset: runsOut < resets, perHour, runsOutAt: new Date(runsOut).toISOString() }
}

const startOfToday = (now: Date): number => {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

// Pure: the 24 hours up to now, each starting on the hour in this machine's time, oldest first.
export function hourSlots(now: Date): number[] {
  const top = new Date(now)
  top.setMinutes(0, 0, 0)
  return Array.from({ length: 24 }, (_, i) => top.getTime() - (23 - i) * HOUR_MS)
}

// Pure: the costliest sessions of the week and of today, the week's order first, so the page's Today view has its own top as well as the week's.
function topSessions<T extends { today: Spend; week: Spend }>(
  bySession: Map<string, T>,
): [string, T][] {
  const all = [...bySession]
  const top = (period: "today" | "week") =>
    [...all]
      .filter(([, spend]) => spend[period].calls > 0)
      .sort(([, a], [, b]) => b[period].usd - a[period].usd)
      .slice(0, TOP_SESSIONS)
  const week = top("week")
  const kept = new Set(week.map(([id]) => id))
  return [...week, ...top("today").filter(([id]) => !kept.has(id))]
}

// Pure: the week's buckets as the page's tables, everything but the windows and the PRs.
export function summarize(
  buckets: Bucket[],
  sessions: Map<string, SessionRow>,
  now: Date,
  links: RosterLinks = NO_LINKS,
): Omit<UsageReport, "accounts" | "prs" | "prsPending" | "windows" | "zai"> {
  const today = startOfToday(now)
  const weekStart = now.getTime() - WEEK_MS
  const slots = hourSlots(now)
  const hours = slots.map(() => ({ tokens: 0, usd: 0 }))
  const totals = { today: zero(), week: zero() }
  const named = (id: string): SessionRow =>
    sessions.get(id) ?? {
      agentType: null,
      costUsd: null,
      gitBranch: null,
      id,
      kind: null,
      name: null,
      parentId: null,
      prUrls: [],
      startedAt: null,
      task: null,
    }
  // An agent is a name: the dispatcher restarts and a sin takes chore after chore, so the sessions at the top of their parents that share a name share a row.
  const agents = new Map<string, { role: Role; today: Spend; week: Spend }>()
  const agentOf = (id: string) => {
    const root = named(rootOf(id, sessions))
    const label = labelOf(root)
    let entry = agents.get(label)
    if (!entry)
      agents.set(label, (entry = { role: roleOf(root, links.kinds), today: zero(), week: zero() }))
    return entry
  }
  const bySession = new Map<string, { today: Spend; week: Spend }>()
  const models = new Map<string, { today: Spend; week: Spend }>()
  const unpriced = new Map<string, number>()
  const pick = <K>(map: Map<K, { today: Spend; week: Spend }>, key: K) => {
    let entry = map.get(key)
    if (!entry) map.set(key, (entry = { today: zero(), week: zero() }))
    return entry
  }
  for (const b of buckets) {
    if (b.at < weekStart - BUCKET_MS) continue
    const isToday = b.at >= today
    const tokens = tokensOf(b)
    const model = b.model ? modelKey(b.model) : "unknown"
    if (tokens > 0 && !priceOf(b.model)) unpriced.set(model, (unpriced.get(model) ?? 0) + tokens)
    const targets = [
      totals,
      agentOf(b.sessionId),
      pick(bySession, b.sessionId),
      ...(tokens > 0 ? [pick(models, model)] : []),
    ]
    for (const target of targets) {
      add(target.week, b)
      if (isToday) add(target.today, b)
    }
    const slot = Math.floor((b.at - (slots[0] ?? 0)) / HOUR_MS)
    const hour = hours[slot]
    if (hour) {
      hour.tokens += tokens
      hour.usd += usdOf(b)
    }
  }
  const byWeek = (a: { week: Spend }, b: { week: Spend }) => b.week.usd - a.week.usd
  const problems = [...unpriced].map(
    ([model, tokens]) =>
      `No price for ${model}: its ${Math.round(tokens).toLocaleString("en-US")} tokens count as $0`,
  )
  return {
    agents: [...agents].map(([label, agent]) => ({ label, ...agent })).sort(byWeek),
    calibration: calibrate(buckets, sessions, weekStart),
    hours: slots.map((at, i) => ({
      at: new Date(at).toISOString(),
      tokens: hours[i]?.tokens ?? 0,
      usd: hours[i]?.usd ?? 0,
    })),
    models: [...models]
      .map(([model, spend]) => ({ model, priced: Boolean(priceOf(model)), ...spend }))
      .sort(byWeek),
    problems,
    sessions: topSessions(bySession).map(([id, spend]) => {
      const session = named(id)
      const parent = session.parentId ? sessions.get(session.parentId) : undefined
      return {
        id,
        label: labelOf(session),
        parent: parent ? labelOf(parent) : null,
        role: roleOf(session, links.kinds),
        ...spend,
      }
    }),
    totals,
  }
}

// Pure: this table's dollars beside Claude Code's own totals, over the sessions that started inside the week and have exited (Claude Code writes its total only on exit), each with its subagents, so a wrong price shows as a gap.
export function calibrate(
  buckets: Bucket[],
  sessions: Map<string, SessionRow>,
  weekStart: number,
): UsageReport["calibration"] {
  const roots = new Map<string, number>()
  for (const session of sessions.values()) {
    if (session.costUsd !== null && !session.parentId && (session.startedAt ?? 0) >= weekStart) {
      roots.set(session.id, 0)
    }
  }
  if (roots.size === 0) return null
  for (const b of buckets) {
    const root = rootOf(b.sessionId, sessions)
    const sum = roots.get(root)
    if (sum !== undefined) roots.set(root, sum + usdOf(b))
  }
  let claudeCodeUsd = 0
  let usd = 0
  for (const [id, sum] of roots) {
    claudeCodeUsd += sessions.get(id)?.costUsd ?? 0
    usd += sum
  }
  return { claudeCodeUsd, sessions: roots.size, usd }
}

// Pure: each merged PR's cost: its worker session and that session's subagents, plus its share of its reviewer's and tester's calls made while the worker was on it (from the worker's start, or its previous merge, to this merge), split evenly where two of that worker's PRs were open at once. A checker is its worker's by the roster's worker link, else by the sin its name shares (reviewer-<sin> with worker-<sin>). A worker with several merged PRs gives each the calls inside its span.
export function prCosts(
  prs: MergedPr[],
  buckets: Bucket[],
  sessions: Map<string, SessionRow>,
  links: RosterLinks = NO_LINKS,
): PrCost[] {
  const workers = [...sessions.values()].filter((s) => roleOf(s, links.kinds) === "worker")
  const found = prs.flatMap((pr) => {
    const worker =
      workers.find((s) => s.prUrls.includes(pr.url)) ??
      workers.find(
        (s) =>
          s.gitBranch === pr.headRefName &&
          s.prUrls.length === 0 &&
          (s.startedAt ?? Infinity) <= Date.parse(pr.mergedAt),
      )
    return worker ? [{ pr, worker }] : []
  })
  // A PR's span runs from its worker's start, or from that worker's previous merge when it merged more than one, to its own merge. A 15-minute slot counts from the one holding the worker's start, but only after a previous merge, so a slot spanning that merge stays with the earlier PR.
  const windows = found.map(({ pr, worker }) => {
    const end = Date.parse(pr.mergedAt)
    const merges = found
      .filter((other) => other.worker.id === worker.id)
      .map((other) => Date.parse(other.pr.mergedAt))
    const earlier = merges.filter((at) => at < end)
    const begun = worker.startedAt ?? Date.parse(pr.createdAt)
    const previous = earlier.length > 0 ? Math.max(...earlier) : null
    const afterMerge = previous !== null && previous >= begun
    const start = afterMerge ? previous : begun
    return {
      end,
      first: earlier.length === 0,
      from: afterMerge ? start + 1 : start - BUCKET_MS,
      last: merges.every((at) => at <= end),
      sin: worker.name?.startsWith("worker-") ? worker.name.slice("worker-".length) : null,
      start,
      worker: worker.name,
    }
  })
  type Window = (typeof windows)[number]
  const holds = (w: Window, at: number) => at >= w.from && at <= w.end
  type Helper = { kind: "review" | "test"; sin: string | null; worker: string | null }
  const helperOf = (id: string): Helper | null => {
    const name = sessions.get(rootOf(id, sessions))?.name ?? ""
    const kind = kindOf(name, links.kinds.get(name))
    if (kind !== "reviewer" && kind !== "tester") return null
    return {
      kind: kind === "reviewer" ? "review" : "test",
      sin: /^(?:reviewer|tester)-(.+)$/.exec(name)?.[1] ?? null,
      worker: links.workers.get(name) ?? null,
    }
  }
  const checks = (helper: Helper, w: Window) =>
    helper.worker ? helper.worker === w.worker : helper.sin !== null && helper.sin === w.sin
  const rows = found.map(({ pr, worker }, i) => {
    const window = windows[i]!
    const workerSpend = zero()
    const review = zero()
    const test = zero()
    for (const b of buckets) {
      if (rootOf(b.sessionId, sessions) === worker.id) {
        // The worker's own calls go to the PR whose span holds them; its first PR also takes any before its start, and its last any after its merge.
        const mine =
          holds(window, b.at) ||
          (window.first && b.at < window.from) ||
          (window.last && b.at > window.end)
        if (mine) add(workerSpend, b)
        continue
      }
      const helper = helperOf(b.sessionId)
      if (!helper || !checks(helper, window) || !holds(window, b.at)) continue
      const open = windows.filter((w) => checks(helper, w) && holds(w, b.at)).length
      add(helper.kind === "review" ? review : test, b, 1 / Math.max(1, open))
    }
    return {
      fixes: pr.fixes,
      mergedAt: pr.mergedAt,
      number: pr.number,
      repo: pr.repo,
      review,
      rounds: pr.rounds,
      test,
      title: pr.title,
      total: plus(plus(workerSpend, review), test),
      url: pr.url,
      wallMinutes: Math.round((window.end - window.start) / 60_000),
      worker: worker.name ?? worker.id,
      workerSpend,
    }
  })
  return rows.sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
}

type Json = Record<string, unknown>

const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const time = (value: unknown): number | null => {
  if (value === null || value === undefined) return null
  const t = value instanceof Date ? value.getTime() : Date.parse(String(value))
  return Number.isNaN(t) ? null : t
}

// On a fixture stack, every read keeps to the sessions its own fixture's transcripts hold (shownHere), so rows a live config folder left in its database never show; nothing on the live dashboard.
const here = (session: string) => {
  const shown = shownHere(sql.raw(session))
  return shown ? sql`and ${shown}` : sql``
}

const rowsOf = (result: unknown): Json[] =>
  (Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? [])) as Json[]

// Every assistant call since `since`, as 15-minute buckets per session and model; `ids` narrows it to those sessions.
export async function readBuckets(
  database: Database,
  since: number,
  ids?: string[],
): Promise<Bucket[]> {
  if (ids && ids.length === 0) return []
  const only = ids ? sql`and ${inArray(claudeEntry.sessionId, ids)}` : sql``
  const result = await database.execute(sql`
    select session_id, model, date_bin('15 minutes', at, timestamptz '2000-01-01') as at,
      count(*)::int as calls,
      coalesce(sum(input_tokens), 0)::float8 as input,
      coalesce(sum(output_tokens), 0)::float8 as output,
      coalesce(sum(cache_read_tokens), 0)::float8 as cache_read,
      coalesce(sum(cache_creation_tokens), 0)::float8 as cache_write,
      coalesce(sum(write_1h), 0)::float8 as cache_write_1h
    from (
      select distinct on (session_id, message_id) session_id, model, at,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        ((raw #>> '{}')::jsonb #>> '{message,usage,cache_creation,ephemeral_1h_input_tokens}')::bigint as write_1h
      from claude_entry
      where type = 'assistant' and message_id is not null and input_tokens is not null
        and at >= ${new Date(since).toISOString()}::timestamptz ${only} ${here(`"claude_entry"."session_id"`)}
      order by session_id, message_id, seq desc
    ) calls
    group by 1, 2, 3
  `)
  return rowsOf(result).map((row) => ({
    at: time(row.at) ?? 0,
    cacheRead: num(row.cache_read),
    cacheWrite: num(row.cache_write),
    cacheWrite1h: num(row.cache_write_1h),
    calls: num(row.calls),
    input: num(row.input),
    model: typeof row.model === "string" ? row.model : null,
    output: num(row.output),
    sessionId: String(row.session_id),
  }))
}

const SESSION_COLUMNS = sql`id, name, kind, agent_type, task, parent_id, started_at, git_branch, pr_urls, cost_usd`

const sessionOf = (row: Json): SessionRow => ({
  agentType: typeof row.agent_type === "string" ? row.agent_type : null,
  costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : num(row.cost_usd),
  gitBranch: typeof row.git_branch === "string" ? row.git_branch : null,
  id: String(row.id),
  kind: typeof row.kind === "string" ? row.kind : null,
  name: typeof row.name === "string" ? row.name : null,
  parentId: typeof row.parent_id === "string" ? row.parent_id : null,
  prUrls: Array.isArray(row.pr_urls) ? row.pr_urls.map(String) : [],
  startedAt: time(row.started_at),
  task: typeof row.task === "string" ? row.task : null,
})

// The sessions named, and every parent above them, so each rolls up to its agent.
export async function readSessions(
  database: Database,
  ids: Iterable<string>,
): Promise<Map<string, SessionRow>> {
  const sessions = new Map<string, SessionRow>()
  let wanted = [...new Set(ids)]
  for (let depth = 0; wanted.length > 0 && depth < 6; depth++) {
    const result = await database.execute(
      sql`select ${SESSION_COLUMNS} from claude_session where ${inArray(claudeSession.id, wanted)} ${here(`"claude_session"."id"`)}`,
    )
    for (const row of rowsOf(result)) sessions.set(String(row.id), sessionOf(row))
    wanted = [...new Set([...sessions.values()].map((s) => s.parentId))].filter(
      (id): id is string => id !== null && !sessions.has(id),
    )
  }
  return sessions
}

// The worker, reviewer and tester sessions that could have worked on a PR merged this week, with every session started under them: those named for it, and the names the roster gives one of those kinds.
export async function readPrSessions(
  database: Database,
  since: number,
  names: string[] = [],
): Promise<Map<string, SessionRow>> {
  const named = names.length > 0 ? sql` or ${inArray(claudeSession.name, names)}` : sql``
  const result = await database.execute(sql`
    with recursive tree as (
      select ${SESSION_COLUMNS} from claude_session
      where (name like 'worker-%' or name like 'reviewer-%' or name like 'tester-%'${named})
        and last_active_at >= ${new Date(since).toISOString()}::timestamptz ${here(`"claude_session"."id"`)}
      union
      select c.id, c.name, c.kind, c.agent_type, c.task, c.parent_id, c.started_at, c.git_branch, c.pr_urls, c.cost_usd
      from claude_session c join tree t on c.parent_id = t.id ${here(`"c"."id"`)}
    )
    select * from tree
  `)
  return new Map(rowsOf(result).map((row) => [String(row.id), sessionOf(row)]))
}

const view = (window: UsageWindow | null, hours: number, now: Date): WindowView | null =>
  window ? { ...window, forecast: forecastOf(window, hours, now) } : null

export const windowsOf = (usage: Usage | null, now: Date): UsageReport["windows"] =>
  usage
    ? {
        fiveHour: view(usage.fiveHour, 5, now),
        sevenDay: view(usage.sevenDay, 7 * 24, now),
        stale: usage.stale,
        writtenAt: usage.writtenAt,
      }
    : null

export type WeekReads = {
  buckets: Bucket[]
  prBuckets: Bucket[]
  prSessions: Map<string, SessionRow>
  sessions: Map<string, SessionRow>
}

// Everything the report reads from the claude_* tables for the week up to `now`: every call as buckets with their sessions, and the sessions that could have worked on a merged PR with their own calls from as far back as they started.
export async function readWeek(
  database: Database,
  now: number,
  names: string[] = [],
): Promise<WeekReads> {
  const weekStart = now - WEEK_MS
  const [buckets, prSessions] = await Promise.all([
    readBuckets(database, weekStart),
    readPrSessions(database, weekStart, names),
  ])
  const sessions = await readSessions(
    database,
    buckets.map((b) => b.sessionId),
  )
  const since = Math.min(
    ...[...prSessions.values()].map((s) => s.startedAt ?? weekStart),
    weekStart,
  )
  const prBuckets = await readBuckets(database, since, [...prSessions.keys()])
  return { buckets, prBuckets, prSessions, sessions }
}

// The week's reads scan claude_entry (it has no index on at or type), so they are kept for 30s and served stale while they refresh: a page polling every few seconds while GitHub's PRs load reruns only the GitHub join.
const weekReads = cachedBy(READS_TTL_MS, async () => {
  const { kinds } = rosterLinks((await readRoster()).roster)
  const names = [...kinds].flatMap(([name, kind]) =>
    kind === "researcher" || kind === "reviewer" || kind === "tester" || kind === "worker"
      ? [name]
      : [],
  )
  return readWeek(db, Date.now(), names)
})

// The banner's line for the usage file at path as readUsage read it, or null while its windows are fresh.
export async function usageProblem(
  usage: Usage | null,
  path = usagePath(),
): Promise<string | null> {
  if (!usage) return noUsageProblem(path)
  return usage.stale ? `The usage windows are stale: last written ${usage.writtenAt}` : null
}

export async function usageReport(now = new Date()): Promise<UsageReport> {
  const weekStart = now.getTime() - WEEK_MS
  const [
    accounts,
    usage,
    zai,
    zaiFailure,
    { buckets, prBuckets, prSessions, sessions },
    { roster },
  ] = await Promise.all([
    readAccounts(),
    readUsage(),
    readZaiUsage(),
    readZaiFailure(),
    weekReads("week"),
    readRoster(),
  ])
  const links = rosterLinks(roster)
  const summary = summarize(buckets, sessions, now, links)
  const problems = [...summary.problems]
  const usageLine = await usageProblem(usage)
  if (usageLine) problems.push(usageLine)
  const zaiLine = zaiFailure ?? zaiProblem(zai)
  if (zaiLine) problems.push(zaiLine)
  const cal = summary.calibration
  if (cal && cal.claudeCodeUsd > 0) {
    const gap = Math.abs(cal.usd - cal.claudeCodeUsd) / cal.claudeCodeUsd
    if (gap > CALIBRATION_GAP) {
      problems.push(
        `Prices here differ from Claude Code's own totals by ${Math.round(gap * 100)}% over ${cal.sessions} exited ${cal.sessions === 1 ? "session" : "sessions"} ($${cal.usd.toFixed(2)} here, $${cal.claudeCodeUsd.toFixed(2)} by Claude Code)`,
      )
    }
  }
  const repos = new Set<string>()
  for (const s of prSessions.values()) {
    for (const url of s.prUrls) {
      const match = /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(url)
      if (match?.[1]) repos.add(match[1])
    }
  }
  const merged = await mergedPrs([...repos].sort(), weekStart)
  problems.push(...merged.problems)
  let prs: PrCost[] = []
  if (merged.prs.length > 0) {
    prs = prCosts(merged.prs, prBuckets, new Map([...sessions, ...prSessions]), links)
  }
  return {
    ...summary,
    accounts,
    problems,
    prs,
    prsPending: merged.pending,
    windows: windowsOf(usage, now),
    zai,
  }
}
