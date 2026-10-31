import { appendFile, readdir } from "node:fs/promises"
import { join } from "node:path"

import { kindOf, placedKindOf } from "@packages/config/kinds"

import { leadName } from "../ops-session-resume/resume"
import { factoryRepoOf } from "../playground/setting"
import { writeAtomic } from "../write-atomic"

export type Run = (
  argv: string[],
  options?: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number },
) => Promise<{ code: number; err: string; out: string }>

// cfg is Claude Code's config folder, data the factory's folder in it, ops the ops jobs' state, dashboard the live dashboard's checkout, main the main checkout, repo the checkout this job runs from, and factory the factory's GitHub repository (factory.repo by default).
export type Context = {
  cfg: string
  data: string
  dashboard: string
  factory?: () => Promise<string>
  load: () => number
  main: string
  now: () => number
  ops: string
  repo: string
  run: Run
}

type Json = Record<string, unknown>

export const HEADROOM = 85
export const IDLE_DB_AFTER = 7200
export const IDLE_DB_GAP = 900
export const PRUNE_EVERY = 21600
export const REVIEWER_LATE = 1200
export const STALE_EVERY = 14_400

const IDLE_SQL =
  "select count(*) from pg_stat_activity where backend_type = 'client backend' and pid <> pg_backend_pid()"
const PRUNES = [
  ["docker", "volume", "prune", "-f"],
  ["docker", "builder", "prune", "-f", "--filter", "until=24h"],
]
const WINDOWS = [
  ["5h", "f5", "r5", 3600, 1200],
  ["7d", "s7", "r7", 10800, 3600],
] as const

const here = (ctx: Context) => join(ctx.ops, "sweep")
const seconds = (ctx: Context) => ctx.now() / 1000
const stamp = (ctx: Context) => `${new Date(ctx.now()).toISOString().slice(0, 19)}Z`
const notifyArgv = (ctx: Context, text: string) => [
  "bash",
  join(ctx.repo, "scripts", "ops", "notify.sh"),
  "sweep",
  text,
]
const dashboardAsk = (ctx: Context, ...args: string[]) => [
  "bun",
  "run",
  "--silent",
  "--cwd",
  ctx.dashboard,
  "ask",
  ...args,
]

const readJson = async <T>(path: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await Bun.file(path).text()) as T
  } catch {
    return fallback
  }
}

const numbers = (value: unknown): Record<string, number> =>
  value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "number"))
    : {}

const alive = (pid: unknown) => {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Each live session's status by its name, from Claude Code's registry.
export async function registry(ctx: Context): Promise<Map<string, string>> {
  const dir = join(ctx.cfg, "sessions")
  const live = new Map<string, string>()
  for (const file of await readdir(dir).catch(() => [])) {
    if (!file.endsWith(".json")) continue
    const d = await readJson<Json | null>(join(dir, file), null)
    if (d && typeof d.name === "string" && d.name && alive(d.pid))
      live.set(d.name, typeof d.status === "string" ? d.status : "")
  }
  return live
}

// Records a usage sample, then projects each window to its reset from the recent rate (5h: the last hour, 7d: the last 3 hours).
export async function forecast(ctx: Context): Promise<Record<string, number>> {
  const samples = join(here(ctx), "usage-samples.jsonl")
  let s: Json
  let rows: Json[]
  try {
    const rl = JSON.parse(await Bun.file(join(ctx.data, "usage.json")).text()).rate_limits
    s = {
      // an account with no 5-hour window (usage.json leaves it out) projects its week alone
      f5: rl.five_hour?.used_percentage,
      r5: rl.five_hour?.resets_at,
      r7: rl.seven_day.resets_at,
      s7: rl.seven_day.used_percentage,
      t: Math.floor(seconds(ctx)),
    }
    await appendFile(samples, `${JSON.stringify(s)}\n`)
    rows = (await Bun.file(samples).text())
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Json)
  } catch {
    return {}
  }
  const t = s.t as number
  const out: Record<string, number> = {}
  for (const [key, u, r, look, need] of WINDOWS) {
    const used = s[u]
    const reset = s[r]
    // a window with no reset time (Anthropic sends null once a 5-hour window has reset at 0%) has nothing to project to
    if (typeof used !== "number" || typeof reset !== "number") continue
    const first = rows.find((x) => x[r] === reset && (x.t as number) >= t - look)
    if (!first || typeof first[u] !== "number") continue
    const span = t - (first.t as number)
    if (span < need || reset - t < 600) continue
    const rate = (used - first[u]) / span
    out[key] = Math.round((used + rate * (reset - t)) * 10) / 10
  }
  return out
}

// The ops jobs by reading ps alone: each job's script must be running, and each heartbeat ok and fresh.
export async function opsDown(ctx: Context): Promise<string[]> {
  const cmds = (await ctx.run(["ps", "-ax", "-o", "command="])).out
  let disabled = new Set<string>()
  try {
    const jobs = JSON.parse(await Bun.file(join(ctx.ops, "jobs.json")).text()).jobs as Json[]
    disabled = new Set(jobs.filter((j) => j.disabled).map((j) => String(j.name)))
  } catch {}
  const out = ([["dashboard", "dashboard/supervisor.sh"]] as const)
    .filter(([job, mark]) => !cmds.includes(mark) && !disabled.has(`ops-${job}`))
    .map(([job]) => `ops-down:${job}`)
  const files = (await readdir(ctx.ops).catch(() => [])).filter(
    (f) => f.startsWith("ops-") && f.endsWith(".json"),
  )
  for (const file of files) {
    try {
      const b = JSON.parse(await Bun.file(join(ctx.ops, file)).text()) as Json
      if (disabled.has(String(b.job))) continue
      const at = Date.parse(String(b.lastBeatAt))
      if (Number.isNaN(at)) throw new Error("lastBeatAt")
      // a waiting: beat has nothing to read yet, as opsRowOf reads it, so it is no failure
      if (b.lastResult !== "ok" && !String(b.lastResult).startsWith("waiting: "))
        out.push(`ops-failing:${b.job}`)
      if (ctx.now() - at > 3 * Number(b.cycleSeconds ?? 60) * 1000) out.push(`ops-stale:${b.job}`)
    } catch {
      out.push(`ops-beat-unreadable:${file}`)
    }
  }
  return out
}

// Each answer of the owner's that its poster has not closed within 15 minutes (bun run ask stale): a live poster gets one outbox line, then at most one every STALE_EVERY seconds (4 hours) while it stays open, by the item's tag in stale-told.json; a poster with no live session is a finding.
export async function chaseStale(ctx: Context, live: Map<string, string>): Promise<string[]> {
  const r = await ctx.run(dashboardAsk(ctx, "stale", "--minutes", "15"))
  if (r.code) return ["stale-unreadable"]
  const path = join(here(ctx), "stale-told.json")
  const told = numbers(await readJson(path, {}))
  const now = seconds(ctx)
  const out: string[] = []
  const keep: Record<string, number> = {}
  for (const line of r.out.split("\n")) {
    const m = /^(#i\d+) (\S+) from ([^:]+): (.*?), answered (\d+)m ago/.exec(line)
    if (!m) continue
    const [, tag, item, who, state, minutes] = m as unknown as string[]
    const poster = who!.trim()
    keep[tag!] = told[tag!] ?? 0
    if (!live.has(poster)) {
      out.push(`stale-poster-down:${tag}:${poster}`)
      continue
    }
    if (now - keep[tag!]! < STALE_EVERY) continue
    keep[tag!] = now
    const text = `Inbox ${tag} (${item}): the owner answered ${minutes}m ago and it is not closed (${state}). Read it with \`bun run --cwd ${ctx.dashboard} ask get ${item} --ack\`; once a go is carried out, close it with \`bun run ask ack ${item} --link <url>\` (or --no-link "<why>").`
    await ctx.run(notifyArgv(ctx, text), {
      env: { ...process.env, NOTIFY_TO: poster },
      timeoutMs: 60_000,
    })
  }
  await writeAtomic(path, JSON.stringify(keep))
  return out
}

const pullOf = (pr: unknown, repo: string): number | undefined => {
  const m =
    /^#?(\d+)$/.exec(String(pr ?? "").trim()) ??
    new RegExp(`github\\.com/${repo}/pull/(\\d+)$`, "i").exec(String(pr ?? ""))
  return m ? Number(m[1]) : undefined
}

// A worker's PR whose head has been ready (its checks green) REVIEWER_LATE seconds with no review round (a ReviewBot verdict at any head) and no live session for the reviewer the roster names on it: one line to the worker's lead, once per head, since a reviewer started late or by hand left heads ready for over an hour.
export async function lateReviewers(
  ctx: Context,
  agents: Json[],
  live: Map<string, string>,
): Promise<string[]> {
  const open = agents.filter((a) => a.status !== "ended")
  if (!open.some((a) => a.pr && kindOf(String(a.name), a.kind) === "worker")) return []
  let repo: string
  try {
    repo = (await (ctx.factory ?? (() => factoryRepoOf()))()).toLowerCase()
  } catch {
    return ["reviewer-check-unreadable"]
  }
  const workers = new Map<number, string>()
  for (const a of open) {
    const n = pullOf(a.pr, repo)
    if (n !== undefined && kindOf(String(a.name), a.kind) === "worker")
      workers.set(n, String(a.name))
  }
  if (!workers.size) return []
  const fields =
    "state headRefOid comments(last: 100) { nodes { body } } commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes { ... on CheckRun { completedAt } ... on StatusContext { createdAt } } } } } } }"
  const [owner, name] = repo.split("/")
  const query = `{ repository(owner: "${owner}", name: "${name}") { ${[...workers.keys()].map((n) => `p${n}: pullRequest(number: ${n}) { ${fields} }`).join(" ")} } }`
  const r = await ctx.run(["gh", "api", "graphql", "-f", `query=${query}`], { timeoutMs: 60_000 })
  let pulls: Record<string, Json | null>
  try {
    pulls = JSON.parse(r.out).data.repository
  } catch {
    return ["reviewer-check-unreadable"]
  }
  const path = join(here(ctx), "reviewer-told.json")
  const told = (await readJson<Record<string, string>>(path, {})) ?? {}
  const keep: Record<string, string> = {}
  const now = seconds(ctx)
  for (const [n, worker] of workers) {
    const pr = pulls?.[`p${n}`] as {
      comments?: { nodes?: { body?: string }[] }
      commits?: {
        nodes?: {
          commit?: {
            statusCheckRollup?: {
              contexts?: { nodes?: { completedAt?: string; createdAt?: string }[] }
              state?: string
            }
          }
        }[]
      }
      headRefOid?: string
      state?: string
    } | null
    if (!pr || pr.state !== "OPEN" || !pr.headRefOid) continue
    if (told[n] === pr.headRefOid) keep[n] = pr.headRefOid
    const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup
    if (rollup?.state !== "SUCCESS") continue
    const readyAt = Math.max(
      0,
      ...(rollup.contexts?.nodes ?? []).map(
        (c) => Date.parse(c.completedAt ?? c.createdAt ?? "") / 1000 || 0,
      ),
    )
    if (!readyAt || now - readyAt < REVIEWER_LATE) continue
    if ((pr.comments?.nodes ?? []).some((c) => /^## ReviewBot · round /.test(c.body ?? "")))
      continue
    const reviewers = open.filter(
      (a) => kindOf(String(a.name), a.kind) === "reviewer" && pullOf(a.pr, repo) === n,
    )
    if (reviewers.some((a) => live.has(String(a.name)))) continue
    if (keep[n] === pr.headRefOid) continue
    keep[n] = pr.headRefOid
    const minutes = Math.floor((now - readyAt) / 60)
    const named = reviewers.map((a) => String(a.name)).join(", ")
    const text = `PR #${n} (${worker}): its head ${pr.headRefOid.slice(0, 7)} has been ready ${minutes}m with no review round and ${named ? `no live session for ${named}` : "no reviewer on the roster"}. Start its reviewer, or ask ${worker} to.`
    await ctx.run(notifyArgv(ctx, text), {
      env: { ...process.env, NOTIFY_TO: await leadName(ctx.ops, worker) },
      timeoutMs: 60_000,
    })
  }
  await writeAtomic(path, JSON.stringify(keep))
  return []
}

// run-slot's runner-box route, which falls back to this Mac without a word: one finding naming each precondition run-slot.sh box-off reports failing (no-ci-sh, no-ssh-key, runner-host-off, slot-off).
export async function boxRoute(ctx: Context): Promise<string[]> {
  const r = await ctx.run([join(ctx.ops, "run-slot.sh"), "box-off"], { timeoutMs: 60_000 })
  if (r.code) return ["box-route-unreadable"]
  const why = r.out.split(/\s+/).filter(Boolean)
  return why.length ? [`box-route-off:${why.join(",")}`] : []
}

// The dashboard database's container, the one publishing POSTGRES_URL's port from the dashboard's own .env, so it runs under any name; undefined when none passes.
export async function dashboardDb(ctx: Context): Promise<string | undefined> {
  const env = { ...process.env }
  delete env.POSTGRES_URL
  const r = await ctx.run(["bun", join(ctx.repo, "api", "hono", "src", "bin", "dashboard-db.ts")], {
    cwd: ctx.dashboard,
    env,
    timeoutMs: 60_000,
  })
  const name = r.out.trim()
  return r.code === 0 && name ? name : undefined
}

// A playground-* Postgres container with no client for IDLE_DB_AFTER seconds is a finding, read by its own client connections, since an owner's session can stay live long after its stack is down; the dashboard's own is never one, and when it cannot be found no container is judged.
export async function idleDbs(ctx: Context): Promise<string[]> {
  const ps = await ctx.run(
    ["docker", "ps", "--filter", "name=^playground-", "--format", "{{.Names}}"],
    {
      timeoutMs: 60_000,
    },
  )
  if (ps.code) return []
  const names = ps.out.split(/\s+/).filter(Boolean)
  const dashboard = names.length ? await dashboardDb(ctx) : undefined
  if (names.length && !dashboard) return ["dashboard-db-unknown"]
  const path = join(here(ctx), "idle-db.json")
  const now = seconds(ctx)
  // Only a pass that saw the containers writes the file, so one older than IDLE_DB_GAP means a blind gap a client may have come and gone in: every clock starts again.
  const written = await Bun.file(path)
    .stat()
    .then(
      (s) => s.mtimeMs / 1000,
      () => 0,
    )
  const since = now - written <= IDLE_DB_GAP ? numbers(await readJson(path, {})) : {}
  const out: string[] = []
  const keep: Record<string, number> = {}
  for (const name of names) {
    if (name === dashboard) continue
    const r = await ctx.run(["docker", "exec", name, "psql", "-U", "postgres", "-tAc", IDLE_SQL], {
      timeoutMs: 30_000,
    })
    if (r.code || r.out.trim() !== "0") continue
    keep[name] = since[name] ?? now
    if (now - keep[name]! >= IDLE_DB_AFTER) out.push(`idle-db:${name}`)
  }
  await writeAtomic(path, JSON.stringify(keep))
  return out
}

// One read of runners, probes, the managers' asks, unclosed answers, the ops jobs, idle databases, the runner-box route, late reviewers and the usage forecast.
export async function check(ctx: Context): Promise<string[]> {
  let roster: Json
  try {
    roster = JSON.parse(await Bun.file(join(ctx.data, "roster.json")).text())
  } catch (err) {
    const e = err as { code?: string; name?: string }
    return [`roster-unreadable:${e.code ?? e.name ?? "Error"}`]
  }
  const agents = (Array.isArray(roster.agents) ? roster.agents : []) as Json[]
  const live = await registry(ctx)
  const now = Math.floor(seconds(ctx))
  const seenPath = join(here(ctx), "probe-first-seen.json")
  const seen = numbers(await readJson(seenPath, {}))
  const recorded = new Set(agents.filter((a) => a.status !== "ended").map((a) => a.name))
  const kinds = new Map(agents.map((a) => [a.name, a.kind]))
  const found: string[] = []
  for (const a of agents) {
    const name = typeof a.name === "string" ? a.name : ""
    // a parked runner is down by design (runner-sharp-lynx, parked 18 Oct, read as down on every restart)
    if (a.status === "ended" || a.status === "parked") continue
    const kind = kindOf(name, kinds.get(name))
    if (kind === "runner") {
      if (!live.has(name)) found.push(`down:${name}`)
      else if (live.get(name) === "waiting") found.push(`waiting:${name}`)
    }
    if (kind === "probe" && !live.has(name)) found.push(`probe-gone-unended:${name}`)
    const placed = placedKindOf(name, kinds.get(name))
    if (placed !== "ops" && placed !== "dispatcher") continue
    for (const ask of String(a.asks ?? "")
      .split(/\s+/)
      .filter(Boolean)) {
      const r = await ctx.run(dashboardAsk(ctx, "get", /^\d+$/.test(ask) ? `#i${ask}` : ask), {
        timeoutMs: 60_000,
      })
      const brace = r.out.indexOf("{")
      let d: Json | null = null
      try {
        if (r.code === 0 && brace !== -1) d = JSON.parse(r.out.slice(brace)) as Json
      } catch {}
      if (!d || typeof d !== "object") found.push(`ask-unreadable:${ask}`)
      else if (d.status !== "open") found.push(`ask-answered:${ask}`)
    }
  }
  for (const name of Object.keys(seen)) if (!live.has(name)) delete seen[name]
  for (const name of live.keys()) {
    if (kindOf(name, kinds.get(name)) !== "probe") continue
    seen[name] ??= now
    const age = Math.floor((now - seen[name]!) / 60)
    if (age >= 15) found.push(`probe-over-15m:${name}`)
    if (!recorded.has(name) && age >= 10) found.push(`probe-unrecorded:${name}`)
  }
  await writeAtomic(seenPath, JSON.stringify(seen))
  found.push(...(await chaseStale(ctx, live)))
  found.push(...(await opsDown(ctx)))
  found.push(...(await idleDbs(ctx)))
  found.push(...(await boxRoute(ctx)))
  found.push(...(await lateReviewers(ctx, agents, live)))
  const projected = Object.values(await forecast(ctx))
  if (projected.length) found.push(projected.some((v) => v > HEADROOM) ? "no-headroom" : "headroom")
  return found
}

// Every 6 hours at a quiet minute, Docker's leftovers go: anonymous volumes no container uses (never --all, so no named volume) and build cache older than a day. Quiet: no dashboard roll in the last 5 minutes, no container in Created or Restarting, and a 1-minute load under 20.
export async function maybePrune(ctx: Context): Promise<void> {
  const statePath = join(here(ctx), "prune-state.json")
  const last = numbers(await readJson(statePath, {})).at ?? 0
  if (seconds(ctx) - last < PRUNE_EVERY) return
  const log = await Bun.file(join(ctx.ops, "dashboard", "supervisor.log"))
    .text()
    .catch(() => "")
  const cutoff = new Date(ctx.now() - 300_000).toISOString().slice(0, 19)
  const rolled = log
    .replace(/\n$/, "")
    .split("\n")
    .slice(-30)
    .some(
      (l) =>
        l.slice(0, 19) >= cutoff &&
        (/\b(main|canary) moved\b/.test(l) || l.includes("dev started") || l.includes("stopping")),
    )
  if (rolled) return
  const created = await ctx.run(
    ["docker", "ps", "-a", "--filter", "status=created", "--filter", "status=restarting", "-q"],
    { timeoutMs: 60_000 },
  )
  if (created.out.trim() || ctx.load() >= 20) return
  const freed: string[] = []
  for (const argv of PRUNES) {
    const r = await ctx.run(argv, { timeoutMs: 3_600_000 })
    const m = /Total(?: reclaimed space)?:\s*([\d.]+\s*[KMGT]?B)/.exec(r.out)
    freed.push(
      `\`${argv.slice(1).join(" ")}\` ${r.code ? `failed (exit ${r.code})` : `freed ${m?.[1] ?? "0B"}`}`,
    )
  }
  await writeAtomic(statePath, JSON.stringify({ at: seconds(ctx) }))
  await appendFile(
    join(ctx.ops, "ops-log.md"),
    `- ${stamp(ctx)} daily Docker prune (ops-sweep): ${freed.join("; ")}.\n`,
  )
}

// One sweep: restart any ops job that is down, clear stale run-slot holders, then tell ops each finding not already active (a known one never); a finding that clears and comes back is told again.
export async function pass(
  ctx: Context,
  active: Set<string>,
  known: Set<string>,
): Promise<{ active: Set<string>; result: string }> {
  const log = (line: string) => appendFile(join(here(ctx), "sweep.log"), `${stamp(ctx)} ${line}\n`)
  let result = "ok"
  let next = active
  await ctx.run(["python3", "-I", join(ctx.main, "scripts", "ops", "up.py")], {
    env: { ...process.env, OPS_UP_SKIP: "ops-sweep" },
    timeoutMs: 600_000,
  })
  try {
    const cleared = await ctx.run([join(ctx.ops, "run-slot.sh"), "clear-stale"], {
      timeoutMs: 60_000,
    })
    for (const line of cleared.out.split("\n")) if (line.includes("cleared")) await log(line)
  } catch {}
  try {
    const found = new Set(await check(ctx))
    const fresh = [...found].filter((f) => !active.has(f)).sort()
    next = new Set([...found, ...[...active].filter((f) => known.has(f))])
    if (fresh.length) {
      await log(fresh.join(" "))
      await ctx.run(notifyArgv(ctx, fresh.join(" ")), { timeoutMs: 60_000 })
    }
  } catch (err) {
    result = `error: ${err instanceof Error ? err.message : String(err)}`
  }
  try {
    await maybePrune(ctx)
  } catch (err) {
    result = `error: prune: ${err instanceof Error ? err.message : String(err)}`
  }
  return { active: next, result }
}

export const beat = (
  path: string,
  startedAt: Date,
  now: Date,
  cycleSeconds: number,
  lastResult: string,
) =>
  writeAtomic(
    path,
    `${JSON.stringify({
      cycleSeconds,
      job: "ops-sweep",
      lastBeatAt: now.toISOString(),
      lastResult: lastResult.slice(0, 120),
      pid: process.pid,
      startedAt: startedAt.toISOString(),
    })}\n`,
  )
