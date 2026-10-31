import { appendFile, lstat, mkdir, readdir, stat, unlink } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { dispatcherOf, kindOf, managerKindOfName, managerOf } from "@packages/config/kinds"
import { accountSettings, guardedOrgs, readPolicy } from "@packages/settings"

import {
  sweep as autoEndSweep,
  type Line,
  liveDeps,
} from "../../../../scripts/ops/optimizer/auto_end"
import { liveInput } from "../../../../scripts/ops/optimizer/idle_sessions"
import { writeAtomic } from "../write-atomic"
import { dashboardWatch } from "./dashboard-watch"

// ops-tick: runner-steady-tick's timed beats, run as a script with no model call. Each beat runs at its old cron, in machine wall time as CronCreate ran it, runs the same script, and queues what that script prints for the session it went to before, through notify.sh and the ops relay (ADR 0010); a beat whose script prints nothing sends nothing. The Lanes keeper comes in a later change; the 98% move to GLM is retired (Inbox #i827) for the account rotation (`scripts/ops/usage/login-flip.py`).
export const CYCLE_SECONDS = 60

export type Run = (
  argv: string[],
  timeoutMs?: number,
  stdin?: string,
) => Promise<{ code: number; out: string }>
// to is a manager kind (builder, ops, optimizer), dispatcher (the primary) or a session's name, as notify.sh takes it; true once the line is queued. A beat's own send never throws: a failed one is named in the heartbeat's result (guard).
// again: the beat finds this line again by itself until it marks it told, so a failed send of it is never kept to resend.
export type Send = (to: string, text: string, again?: boolean) => Promise<boolean>

export type Context = {
  now: Date
  ops: string
  repo: string
  run: Run
  send: Send
}

export type Beat = { cron: string; name: string; run: (ctx: Context) => Promise<void>; to: string }

const fieldOf = (field: string, min: number, max: number): Set<number> | null => {
  const values = new Set<number>()
  for (const part of field.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const from = m[1] === "*" ? min : Number(m[2])
    const to = m[1] === "*" ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : from
    const step = m[4] ? Number(m[4]) : 1
    if (from < min || to > max || from > to || step < 1) return null
    for (let n = from; n <= to; n += step) values.add(n)
  }
  return values
}

// Whether a 5-field cron names this minute, read in machine wall time, as CronCreate read the old crons.
export function cronMatches(cron: string, at: Date): boolean {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`not a 5-field cron: ${cron}`)
  const sets = fields.map((field, i) =>
    fieldOf(field, [0, 0, 1, 1, 0][i]!, [59, 23, 31, 12, 6][i]!),
  )
  if (sets.some((set) => set === null)) throw new Error(`unreadable cron: ${cron}`)
  const now = [at.getMinutes(), at.getHours(), at.getDate(), at.getMonth() + 1, at.getDay()]
  return sets.every((set, i) => set!.has(now[i]!))
}

// The next minute after from that the cron names, within 8 days.
export function nextDue(cron: string, from: Date): Date {
  const at = new Date(from)
  at.setSeconds(0, 0)
  for (let i = 0; i < 8 * 24 * 60; i++) {
    at.setMinutes(at.getMinutes() + 1)
    if (cronMatches(cron, at)) return new Date(at)
  }
  throw new Error(`no time in 8 days for ${cron}`)
}

const isoSeconds = (at: Date): string => at.toISOString().replace(/\.\d{3}Z$/, "Z")

const lines = (out: string): string[] =>
  out
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)

const python = (ctx: Context, path: string, isolated = true) =>
  ctx.run(["python3", ...(isolated ? ["-I"] : []), join(ctx.ops, path)])

const readJson = async (path: string): Promise<unknown> => JSON.parse(await Bun.file(path).text())

const fresh = (at: unknown, now: Date, ms: number): boolean =>
  typeof at === "string" && now.getTime() - Date.parse(at) <= ms

// The load averages, from sysctl's `{ 1m 5m 15m }`.
const loadOf = async (ctx: Context): Promise<number[]> =>
  (await ctx.run(["sysctl", "-n", "vm.loadavg"])).out
    .replace(/[{}]/g, "")
    .trim()
    .split(/\s+/)
    .map(Number)

// Names the dashboard's paused file over 30 minutes old to ops, once a file; roll-now is left to Update now and `playground update`, so the dashboard's roll holds stand.
const rollGate = async (ctx: Context) => {
  const dashboard = join(ctx.ops, "dashboard")
  const paused = await stat(join(dashboard, "paused")).catch(() => null)
  if (!paused) return
  const age = ctx.now.getTime() - paused.mtimeMs
  const told = join(ctx.ops, "tick", `paused-told-${Math.floor(paused.mtimeMs / 1000)}`)
  if (age <= 30 * 60_000 || (await Bun.file(told).exists())) return
  if (await ctx.send("ops", `ops/dashboard/paused is ${Math.floor(age / 60_000)} min old`, true))
    await Bun.write(told, "")
}

// The usage marks, the login flip, the load, the train's slot wait and the near-limit marks, each routed as the old tick routed it.
const tick = async (ctx: Context) => {
  const marks = lines((await python(ctx, "usage/week-marks.py", false)).out)
  for (const line of marks.filter((l) => l.includes("ALERT"))) {
    if (/ALERT 9[78]\b/.test(line))
      await ctx.run(["python3", "-I", join(ctx.ops, "inbox-alert.py"), line])
    await ctx.send("builder", line)
  }
  if (ctx.now.getMinutes() === 3 && marks[0]) await ctx.send("builder", `usage: ${marks[0]}`, true)
  const flip = (await python(ctx, "usage/login-flip.py")).out.trim()
  if (flip.includes("switch due")) await ctx.send("dispatcher", flip)
  const [, load5 = 0] = await loadOf(ctx)
  if (load5 > 15) {
    const report = lines((await python(ctx, "unstick/load-report.py", false)).out).slice(0, 4)
    await ctx.send("builder", `load5 ${load5}: ${report.map((l) => l.trim()).join(" ")}`, true)
  }
  for (const line of lines((await python(ctx, "usage/near-limit.py")).out))
    await ctx.send(line.includes("ALERT") ? "builder" : "dispatcher", line)
  await switchWatch(ctx)
}

// The account the switch watch reads, the one the factory moves off at a full week: usage.switchAccount in the data folder's policy, none while it is unset or the policy cannot be read.
export const switchAccount = async (ops: string): Promise<string> => {
  const read = await readPolicy(join(ops, ".."))
  return read.refusal === undefined ? accountSettings.get(read.settings, "usage.switchAccount") : ""
}

// While usage.json reads that account: its week at 98% told to ops, and at 100% ops-unstick's move file written for 4 hours with its text sent to both dispatchers and both leads, each once a week, marked in usage/switch-watch.json once sent (told100 once all four are), so a failed send goes again on the next tick. The move itself is the account rotation's.
const switchWatch = async (ctx: Context) => {
  const usage = (await readJson(join(ctx.ops, "..", "usage.json")).catch(() => null)) as {
    account?: string
    rate_limits?: { seven_day?: { resets_at?: number; used_percentage?: number } }
  } | null
  const account = await switchAccount(ctx.ops)
  if (!account || usage?.account !== account) return
  const handle = `${account.split("@")[0]}@`
  const week = usage.rate_limits?.seven_day ?? {}
  const used = Number(week.used_percentage ?? 0)
  const resets = Number(week.resets_at ?? 0) * 1000
  const marksPath = join(ctx.ops, "usage", "switch-watch.json")
  const marks = ((await readJson(marksPath).catch(() => ({}))) ?? {}) as Record<string, string>
  const told = (key: string) => {
    const at = Date.parse(`${marks[key]?.slice(0, 16)}Z`)
    return !Number.isNaN(at) && at > resets - 7 * 86_400_000
  }
  const mark = (key: string) => {
    marks[key] = `${isoSeconds(ctx.now).slice(0, 16)}Z`
    return writeAtomic(marksPath, JSON.stringify(marks))
  }
  if (
    used >= 98 &&
    !told("told98") &&
    (await ctx.send(
      "ops",
      `${handle} week at ${Math.round(used)}% (${isoSeconds(ctx.now).slice(11, 16)}Z)`,
      true,
    ))
  )
    await mark("told98")
  if (used >= 100 && !told("told100")) {
    const move = join(ctx.ops, "unstick", "move.json")
    const roster = (await readJson(join(ctx.ops, "..", "roster.json")).catch(() => null)) as {
      agents?: unknown
    } | null
    const [first, second] = [dispatcherOf(roster?.agents, 1), dispatcherOf(roster?.agents, 2)]
    if (!told("moved100")) {
      const text = JSON.stringify({
        to: second,
        until: isoSeconds(new Date(ctx.now.getTime() + 4 * 3_600_000)),
      })
      await writeAtomic(move, `${text}\n`)
      await mark("moved100")
    }
    const text = (await Bun.file(move).text()).trim()
    let all = true
    for (const to of [second, first, "builder", "ops"]) {
      if (told(`told100 ${to}`)) continue
      if (await ctx.send(to, `${handle} week at 100%: wrote ${move}: ${text}`, true))
        await mark(`told100 ${to}`)
      else all = false
    }
    if (all) await mark("told100")
  }
}

// The sessions ops-unstick reads on the usage-limit screen, each named to the builder once with the account ops-unstick read from its resume record, past the ones already told, and the account with the lowest week, by its newest usage file read in the last hour, whose 5-hour window is under spawn.sh's 90% cap, never a stuck session's own.
const limitWatch = async (ctx: Context) => {
  const state = (await readJson(join(ctx.ops, "unstick", "state.json")).catch(() => null)) as {
    blocked?: Record<string, { account?: string; kind?: string; name?: string }>
    writtenAt?: string
  } | null
  if (!state || !fresh(state.writtenAt, ctx.now, 3 * 60_000)) return
  const told = new Set(
    lines(
      await Bun.file(join(ctx.ops, "usage", "limit-told.txt"))
        .text()
        .catch(() => ""),
    ).map((l) => l.trim()),
  )
  const accounts = new Map<string, string | undefined>()
  for (const b of Object.values(state.blocked ?? {}))
    if (b.kind?.startsWith("usage-limit") && b.name && !told.has(b.name))
      accounts.set(b.name, b.account)
  if (!accounts.size) return
  const stuck = new Set(accounts.values())
  type Reading = {
    account: string
    rate_limits?: {
      five_hour?: { used_percentage?: number }
      seven_day?: { used_percentage?: number }
    }
    writtenAt: string
  }
  const newest = new Map<string, Reading>()
  for await (const path of new Bun.Glob("usage*.json").scan(join(ctx.ops, ".."))) {
    const u = (await readJson(join(ctx.ops, "..", path)).catch(() => null)) as Reading | null
    if (!u?.account || typeof u.writtenAt !== "string") continue
    if (!fresh(u.writtenAt, ctx.now, 60 * 60_000)) continue
    if ((newest.get(u.account)?.writtenAt ?? "") < u.writtenAt) newest.set(u.account, u)
  }
  let best: { account: string; week: number } | undefined
  for (const u of newest.values()) {
    const week = u.rate_limits?.seven_day?.used_percentage
    if (typeof week !== "number" || week >= 100) continue
    if ((u.rate_limits?.five_hour?.used_percentage ?? 0) >= 90) continue
    if (stuck.has(u.account)) continue
    if (!best || week < best.week) best = { account: u.account, week }
  }
  const names = [...accounts.keys()].sort()
  const sessions = names
    .map((name) => (accounts.get(name) ? `${name} (${accounts.get(name)})` : name))
    .join(" ")
  const sent = await ctx.send(
    "builder",
    `${sessions} show the usage-limit screen. ${
      best
        ? `Move each to ${best.account}, the account with the most room (week ${Math.round(best.week)}%), from its handoff.`
        : "No account has room: each waits for its reset."
    }`,
    true,
  )
  if (!sent) return
  await mkdir(join(ctx.ops, "usage"), { recursive: true })
  await appendFile(join(ctx.ops, "usage", "limit-told.txt"), `${names.join("\n")}\n`)
}

// The lead a felled session goes back to, by its kind as ops' sweep reads it: a reviewer or tester of ops' own to ops, a worker, reviewer or tester to the builder, a runner to ops, anyone else to the dispatcher.
export function leadOf(name: string, worker: unknown, kind?: unknown): string {
  const k = kindOf(name, kind)
  if ((k === "reviewer" || k === "tester") && managerKindOfName(String(worker)) === "ops")
    return "ops"
  if (k === "worker" || k === "reviewer" || k === "tester") return "builder"
  return k === "runner" ? "ops" : "dispatcher"
}

// The session that sends every queued ops line (ADR 0010), so its own resume line could never reach a lead while it is down.
const RELAY = "runner-plain-relay"
// Its brief, the resume's first prompt, since the brief has it start its wait task again, without which it relays nothing.
const RELAY_BRIEF = "brief-runner-plain-relay.md"

// The relay's resume line run here, through spawn.sh's capacity gate, rather than queued for the relay itself; never marked told, since a resume keeps the session id and the same line comes back with the next outage, so a relay still down is tried again at the next sweep; a failure is named to ops, where it waits for the relay like any other line, while relay-watch's Inbox alert stands for it.
const resumeRelay = async (ctx: Context, line: string): Promise<boolean> => {
  const argv = line.trim().split(/\s+/)
  const { code, out } = await ctx.run(
    argv.includes("--brief") ? argv : [...argv, "--brief", RELAY_BRIEF],
    120_000,
  )
  if (code === 0) {
    await ctx.send("ops", `Resumed ${RELAY}: ${line.trim()}`, true)
    return true
  }
  await ctx.send(
    "ops",
    `Felled ${RELAY}; its resume failed (exit ${code}): ${lines(out).at(-1) ?? ""}`,
    true,
  )
  return false
}

// A session the roster holds on purpose, or a probe, is never named as felled.
const HELD = new Set(["ended", "parked", "paused", "starting"])

type Agent = { kind?: unknown; name?: string; status?: string; worker?: unknown }

// Each resume line up.py prints, once a line, to the felled session's lead, with the SendMessage line under it.
const felled = async (ctx: Context, upPy: string, agents: Map<string | undefined, Agent>) => {
  const toldPath = join(ctx.ops, "tick", "sweep-told.txt")
  const told = new Set(
    lines(
      await Bun.file(toldPath)
        .text()
        .catch(() => ""),
    ),
  )
  const out = (await ctx.run(["python3", "-I", upPy, "--sessions"])).out.split("\n")
  const sent: string[] = []
  for (const [i, line] of out.entries()) {
    const name = /^\S*spawn\.sh resume (\S+) /.exec(line)?.[1]
    if (!name) continue
    const agent = agents.get(name)
    if (kindOf(name, agent?.kind) === "probe" || HELD.has(agent?.status ?? "")) continue
    if (name === RELAY) {
      await resumeRelay(ctx, line)
      continue
    }
    if (told.has(line)) continue
    const then = out[i + 1]?.startsWith("  then") ? ` ${out[i + 1]!.trim()}` : ""
    if (
      await ctx.send(
        leadOf(name, agent?.worker, agent?.kind),
        `Felled: ${line.trim()}${then}`,
        true,
      )
    )
      sent.push(line)
  }
  if (!sent.length) return
  await mkdir(join(ctx.ops, "tick"), { recursive: true })
  await appendFile(toldPath, sent.map((line) => `${line}\n`).join(""))
}

// ops-up every 5 minutes, so a job that went down (a reboot, a quit cmux) comes back with no hand step, each line it prints told to ops once until it changes.
const up = async (ctx: Context) => {
  const toldPath = join(ctx.ops, "tick", "up-told.txt")
  const told = new Set(
    lines(
      await Bun.file(toldPath)
        .text()
        .catch(() => ""),
    ),
  )
  const said = lines(
    (await ctx.run(["python3", "-I", join(ctx.repo, "scripts", "ops", "up.py")], 600_000)).out,
  )
  for (const line of said) if (!told.has(line)) await ctx.send("ops", line)
  await mkdir(join(ctx.ops, "tick"), { recursive: true })
  await Bun.write(toldPath, said.map((line) => `${line}\n`).join(""))
}

// load5 at 30 or more, told once a crossing and cleared under 22.5.
const highLoad = async (ctx: Context) => {
  const [, load5 = 0] = await loadOf(ctx)
  const toldPath = join(ctx.ops, "tick", "load-told")
  const told = await Bun.file(toldPath).exists()
  if (load5 >= 30 && !told) {
    await mkdir(join(ctx.ops, "tick"), { recursive: true })
    await Bun.write(toldPath, "")
    await ctx.send("dispatcher", `load5 ${load5} (passed 30); lanes drop to 12`)
    await ctx.send("ops", `load5 ${load5}: lanes drop to 12`)
  } else if (load5 < 22.5 && told) await unlink(toldPath)
}

// The sweep, as Ops' tick-loop runs it: felled sessions and high load, each step on its own, so one that fails is named to ops and the rest still run.
const sweep = async (ctx: Context) => {
  const upPy = join(ctx.repo, "scripts", "ops", "up.py")
  const roster = (await readJson(join(ctx.ops, "..", "roster.json")).catch(() => null)) as {
    agents?: Agent[]
  } | null
  const steps: [string, () => Promise<void>][] = [
    ...(roster?.agents
      ? [
          ["felled", () => felled(ctx, upPy, new Map(roster.agents!.map((a) => [a.name, a])))] as [
            string,
            () => Promise<void>,
          ],
        ]
      : []),
    ["load", () => highLoad(ctx)],
  ]
  for (const [name, step] of steps) {
    try {
      await step()
    } catch (err) {
      await ctx.send(
        "ops",
        `ops-tick sweep: ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

const liveEnds = async (now: Date): Promise<Line[]> => {
  const input = await liveInput(1, now.getTime() / 1000)
  return autoEndSweep(input, liveDeps(input.projectsDir ?? ""))
}

// Ends each worker, reviewer and tester whose work is done (auto_end.ts), one line to its lead for each; a session it could not end is told once until its line changes.
export const autoEnd =
  (ends: (now: Date) => Promise<Line[]> = liveEnds) =>
  async (ctx: Context) => {
    const toldPath = join(ctx.ops, "tick", "auto-end-told.txt")
    const told = new Set(
      lines(
        await Bun.file(toldPath)
          .text()
          .catch(() => ""),
      ),
    )
    const said = await ends(ctx.now)
    for (const line of said) if (!told.has(line.text)) await ctx.send(line.to, line.text)
    await mkdir(join(ctx.ops, "tick"), { recursive: true })
    await Bun.write(toldPath, said.map((line) => `${line.text}\n`).join(""))
  }

// One GLM credits line in ops/log/glm-credits.log: ops-zai-usage's file while its beat is ok within 15 minutes, else the endpoint read once.
const glmCredits = async (ctx: Context) => {
  const beat = (await readJson(join(ctx.ops, "ops-zai-usage.json")).catch(() => null)) as {
    lastBeatAt?: string
    lastResult?: string
  } | null
  let line: string
  if (beat?.lastResult === "ok" && fresh(beat.lastBeatAt, ctx.now, 15 * 60_000)) {
    const usage = (await readJson(join(ctx.ops, "..", "zai-usage.json")).catch(() => null)) as {
      windows?: unknown
    } | null
    line = `cache ${JSON.stringify(usage?.windows ?? null)}`
  } else {
    line = `fresh ${lines((await python(ctx, "usage/glm-credits.py")).out)[0] ?? ""}`
  }
  await mkdir(join(ctx.ops, "log"), { recursive: true })
  await appendFile(
    join(ctx.ops, "log", "glm-credits.log"),
    `${isoSeconds(ctx.now)} ${line.slice(0, 300)}\n`,
  )
}

// The other checkouts whose worktrees the sweep lists: each git checkout in the home folder's folder for an org ext.links guards in the data folder's policy, none while it is unset or the policy cannot be read.
export const sweepRepos = async (ops: string, home = homedir()): Promise<string[]> => {
  const read = await readPolicy(join(ops, ".."))
  const repos: string[] = []
  for (const org of read.refusal === undefined ? guardedOrgs(read.settings.values) : []) {
    const names = await readdir(join(home, org)).catch(() => [] as string[])
    for (const name of names.sort())
      if ((await stat(join(home, org, name, ".git")).catch(() => null))?.isDirectory())
        repos.push(join(home, org, name))
  }
  return repos
}

// The shared turbo cache's entries last modified over 7 days ago, removed once a week; a missing or unreadable folder logs and removes nothing.
const TURBO_CACHE = join(homedir(), ".cache", "turbo", "playground")
export const turboPrune =
  (dir = TURBO_CACHE) =>
  async (ctx: Context) => {
    const cutoff = ctx.now.getTime() - 7 * 86_400_000
    let removed = 0
    let kept = 0
    let freed = 0
    let failure = ""
    const entries = await readdir(dir, { withFileTypes: true }).catch(
      (err: NodeJS.ErrnoException) => {
        failure =
          err.code === "ENOENT"
            ? `no folder ${dir}`
            : `unreadable ${dir}: ${err.code ?? err.message}`
        return null
      },
    )
    for (const entry of entries ?? []) {
      if (!entry.isFile()) continue
      const path = join(dir, entry.name)
      const info = await lstat(path).catch(() => null)
      if (!info) continue
      if (info.mtimeMs >= cutoff) {
        kept++
        continue
      }
      const gone = await unlink(path)
        .then(() => true)
        .catch(() => false)
      if (!gone) continue
      removed++
      freed += info.size
    }
    const line = entries
      ? `removed ${removed}, kept ${kept}, freed ${Math.round(freed / 1_048_576)} MB`
      : failure
    await mkdir(join(ctx.ops, "log"), { recursive: true })
    await appendFile(join(ctx.ops, "log", "turbo-prune.log"), `${isoSeconds(ctx.now)} ${line}\n`)
  }

// The worktrees past the factory's stale rule, listed and never removed: the optimizer gives the remove.
const worktreeSweep = async (ctx: Context) => {
  const { out } = await ctx.run(
    [
      join(ctx.ops, "run-slot.sh"),
      "ops-tick",
      "--",
      "uv",
      "run",
      "--python",
      "3.13",
      "python",
      "-I",
      join(ctx.ops, "optimizer", "sweep.py"),
      ctx.repo,
      ...(await sweepRepos(ctx.ops)),
    ],
    60 * 60_000,
  )
  const head = "Worktree sweep (dry): "
  // notify.sh cuts each line at 400 characters, so the list goes in as many sends as it takes, each of whole lines
  const room = 400 - head.length
  const sends: string[] = []
  for (const line of lines(out)) {
    const last = sends.length - 1
    if (last >= 0 && sends[last]!.length + 1 + line.length <= room) sends[last] += `\n${line}`
    else sends.push(line)
  }
  for (const text of sends) await ctx.send("optimizer", `${head}${text}`, true)
}

const words = (text: string) => async (ctx: Context) => void (await ctx.send("optimizer", text))

// Every worktree of the repo's clone on canary, and the leads worktree on its leads branch, kept at the head of the origin branch each tracks (canary's, and for leads the branch the install cloned, which spawn.sh's cut sets: main on a public install), so every session runs that line rather than the live checkout: a fast-forward pull, never in one holding an open change, a pull that changed bun.lock or a package.json then installing through run-slot as redeploy-pull.sh does and owing that install in tick/canary-pull-owed.json until one exits 0, and a pull or install that fails named to ops once a failure, marked by its words in tick/canary-pull-told.json and cleared once that worktree pulls and owes no install.
const canaryPull = async (ctx: Context) => {
  const list = await ctx.run(["git", "-C", ctx.repo, "worktree", "list", "--porcelain"])
  const trees = list.out
    .split("\n\n")
    .filter((block) =>
      block.split("\n").some((line) => /^branch refs\/heads\/(canary|leads)$/.test(line)),
    )
    .map((block) => block.split("\n")[0]!.replace(/^worktree /, ""))
  const toldPath = join(ctx.ops, "tick", "canary-pull-told.json")
  const told = ((await readJson(toldPath).catch(() => null)) ?? {}) as Record<string, string>
  const before = JSON.stringify(told)
  const owedPath = join(ctx.ops, "tick", "canary-pull-owed.json")
  const owed = new Set(((await readJson(owedPath).catch(() => null)) ?? []) as string[])
  const owedBefore = JSON.stringify([...owed])
  for (const tree of trees) {
    if ((await ctx.run(["git", "-C", tree, "status", "--porcelain"])).out.trim()) continue
    const old = (await ctx.run(["git", "-C", tree, "rev-parse", "HEAD"])).out.trim()
    const pull = await ctx.run(["git", "-C", tree, "pull", "--ff-only", "-q"], 120_000)
    let text = ""
    if (pull.code !== 0)
      text = `canary-pull: ${tree} did not fast-forward: ${lines(pull.out).at(-1) ?? `exit ${pull.code}`}`
    else {
      const changed = await ctx.run(["git", "-C", tree, "diff", "--name-only", old, "HEAD"])
      if (owed.has(tree) || /(^|\/)(bun\.lock|package\.json)$/m.test(changed.out)) {
        const install = await ctx.run(
          [
            join(ctx.ops, "run-slot.sh"),
            "ops-tick",
            "--",
            "bun",
            "install",
            "--frozen-lockfile",
            "--ignore-scripts",
            "--cwd",
            tree,
          ],
          30 * 60_000,
        )
        if (install.code === 0) owed.delete(tree)
        else {
          owed.add(tree)
          text = `canary-pull: ${tree} did not install: ${lines(install.out).at(-1) ?? `exit ${install.code}`}`
        }
      }
    }
    if (!text) delete told[tree]
    else if (told[tree] !== text && (await ctx.send("ops", text, true))) told[tree] = text
  }
  if (JSON.stringify(told) !== before) await writeAtomic(toldPath, JSON.stringify(told))
  if (JSON.stringify([...owed]) !== owedBefore)
    await writeAtomic(owedPath, JSON.stringify([...owed]))
}

// relay-watch's cycle; the relay is down once an ops line has waited two of them with no cursor of the relay's moving.
const RELAY_CYCLE_MS = 5 * 60_000

// The newest time the relay moved one of its cursors (relay.py, dm-relay.py's two), 0 with none.
const relayMovedAt = async (outbox: string): Promise<number> => {
  const times = await Promise.all(
    ["cursor.json", "dm-cursor.json", "linear-cursor.json"].map(
      async (file) => (await stat(join(outbox, file)).catch(() => null))?.mtimeMs ?? 0,
    ),
  )
  return Math.max(...times)
}

type RelayWatch = { at?: string; by?: string; id?: string; pendingSince?: string }

// The ops relay's watch from outside it: wait.py's own peek (which moves nothing) is timed from the first cycle it reads pending, and one Inbox alert update is posted straight to the dashboard with bun run ask, under the ops manager's name, once a line has waited two cycles with no cursor of the relay's moving since, since the relay rewrites its cursors only when a line is pending; the alert is resolved once a cursor moves after it, or when its item is gone; its id is kept in tick/relay-watch.json, so it is posted once a stop.
const relayWatch = async (ctx: Context) => {
  const outbox = join(ctx.ops, "outbox")
  const statePath = join(ctx.ops, "tick", "relay-watch.json")
  const state = (await readJson(statePath).catch(() => null)) as RelayWatch | null
  const moved = await relayMovedAt(outbox)
  if (state?.id && state.by) {
    if (moved <= Date.parse(state.at ?? "")) return
    const done = await ctx.run([
      "bun",
      "run",
      "--cwd",
      ctx.repo,
      "ask",
      "resolve",
      state.id,
      "--by",
      state.by,
      "--note",
      `The relay moved its cursor again at ${isoSeconds(new Date(moved))}`,
    ])
    if (done.code !== 0 && !done.out.includes("no inbox item"))
      throw new Error(`bun run ask resolve ${state.id}: ${lines(done.out).at(-1)}`)
    await unlink(statePath)
    return
  }
  const peek = (await ctx.run(["python3", "-I", join(outbox, "wait.py"), "--max", "0"])).out.trim()
  if (!peek.startsWith("pending:")) {
    if (state) await unlink(statePath)
    return
  }
  const since = Date.parse(state?.pendingSince ?? "")
  if (Number.isNaN(since) || moved > since) {
    await writeAtomic(statePath, JSON.stringify({ pendingSince: ctx.now.toISOString() }))
    return
  }
  if (ctx.now.getTime() - since < 2 * RELAY_CYCLE_MS) return
  const roster = (await readJson(join(ctx.ops, "..", "roster.json")).catch(() => null)) as {
    agents?: unknown
  } | null
  const by = managerOf(roster?.agents, "ops")
  const item = {
    from: by,
    kind: "update",
    preview: { outcome: "alert" },
    title: `The ops relay is down: no ops line has gone out ${moved ? `since ${isoSeconds(new Date(moved))}` : "with no run on record"}. Resume ${RELAY}.`,
  }
  const posted = await ctx.run(
    ["bun", "run", "--cwd", ctx.repo, "ask", "new"],
    120_000,
    JSON.stringify(item),
  )
  const id = lines(posted.out)
    .map((l) => l.trim())
    .find((l) => /^[0-9a-f-]{36}$/.test(l))
  if (posted.code !== 0 || !id) throw new Error(`bun run ask new: ${lines(posted.out).at(-1)}`)
  await writeAtomic(
    statePath,
    JSON.stringify({ at: ctx.now.toISOString(), by, id, pendingSince: state?.pendingSince }),
  )
}

// Each beat at its old cron, with the target its output goes to.
export const BEATS: Beat[] = [
  { cron: "*/5 * * * *", name: "roll-gate", run: rollGate, to: "ops" },
  { cron: "*/5 * * * *", name: "up", run: up, to: "ops" },
  { cron: "3,18,33,48 * * * *", name: "tick", run: tick, to: "builder, dispatcher, ops" },
  { cron: "5,15,25,35,45,55 * * * *", name: "usage-limit-watch", run: limitWatch, to: "builder" },
  { cron: "7,37 * * * *", name: "sweep", run: sweep, to: "the session's lead, ops, dispatcher" },
  { cron: "*/5 * * * *", name: "auto-end", run: autoEnd(), to: "the session's lead" },
  {
    cron: "17,47 * * * *",
    name: "planner-sweep",
    run: async (ctx) =>
      void (await ctx.run(["python3", "-I", join(ctx.ops, "..", "planner", "sweep.py")])),
    to: "nobody: its output is kept",
  },
  { cron: "43 * * * *", name: "glm-credits", run: glmCredits, to: "ops/log/glm-credits.log" },
  {
    cron: "12,27,42,57 * * * *",
    name: "optimizer-flow",
    run: words("optimizer flow"),
    to: "optimizer",
  },
  {
    cron: "45 * * * *",
    name: "optimizer-burn",
    run: words("optimizer burn check"),
    to: "optimizer",
  },
  { cron: "7 */2 * * *", name: "optimizer-tick", run: words("optimizer tick"), to: "optimizer" },
  { cron: "13 21 * * *", name: "optimizer-daily", run: words("optimizer daily"), to: "optimizer" },
  { cron: "17 */2 * * *", name: "worktree-sweep", run: worktreeSweep, to: "optimizer" },
  { cron: "29 3 * * 0", name: "turbo-prune", run: turboPrune(), to: "ops/log/turbo-prune.log" },
  { cron: "*/5 * * * *", name: "canary-pull", run: canaryPull, to: "ops, once a failed pull" },
  { cron: "*/5 * * * *", name: "relay-watch", run: relayWatch, to: "the Inbox, by bun run ask" },
  {
    cron: "* * * * *",
    name: "dashboard-watch",
    run: dashboardWatch,
    to: "ops and a macOS banner",
  },
]

// The minute a beat last started, so a cycle that lands twice in one minute starts it once, and a beat still running is not started again.
const minuteOf = (at: Date): string => `${at.toDateString()} ${at.getHours()}:${at.getMinutes()}`

export type Runner = {
  failures: Map<string, string>
  running: Set<string>
  started: Map<string, string>
  unsent: Map<string, Unsent[]>
}
export const runner = (): Runner => ({
  failures: new Map(),
  running: new Set(),
  started: new Map(),
  unsent: new Map(),
})

export type Unsent = { text: string; to: string }

// The beat's context with a send that never throws: a failed send is named in failed and reads false, so the beat goes on and nothing it marks as told is lost, and is kept in unsent for the beat's next run unless the beat finds it again itself (again), so a line whose words change each run goes out once, as it reads then; each line is tried once a run, so a line still failing stays one copy in unsent.
export const guard = (ctx: Context, failed: string[], unsent: Unsent[] = []): Context => {
  const tried = new Map<string, Promise<boolean>>()
  const attempt = async (to: string, text: string, again?: boolean) => {
    try {
      return await ctx.send(to, text, again)
    } catch (err) {
      failed.push(`send to ${to} failed: ${err instanceof Error ? err.message : String(err)}`)
      if (!again) unsent.push({ text, to })
      return false
    }
  }
  return {
    ...ctx,
    send: (to, text, again) => {
      const key = `${to}\n${text}`
      const known = tried.get(key)
      if (known) return known
      const result = attempt(to, text, again)
      tried.set(key, result)
      return result
    },
  }
}

// Starts every beat due this minute, each on its own so a slow one holds no other; a beat that throws or fails a send is kept by name until it next runs clean.
export function cycle(ctx: Context, state: Runner, beats: Beat[] = BEATS): Promise<void>[] {
  const minute = minuteOf(ctx.now)
  return beats
    .filter(
      (b) =>
        cronMatches(b.cron, ctx.now) &&
        state.started.get(b.name) !== minute &&
        !state.running.has(b.name),
    )
    .map(async (b) => {
      state.started.set(b.name, minute)
      state.running.add(b.name)
      const failed: string[] = []
      const unsent: Unsent[] = []
      const guarded = guard(ctx, failed, unsent)
      try {
        for (const line of state.unsent.get(b.name) ?? []) await guarded.send(line.to, line.text)
        await b.run(guarded)
        if (failed.length) state.failures.set(b.name, failed.join("; "))
        else state.failures.delete(b.name)
      } catch (err) {
        state.failures.set(b.name, err instanceof Error ? err.message : String(err))
      } finally {
        state.unsent.set(b.name, unsent)
        state.running.delete(b.name)
      }
    })
}

// The beat's result: ok, or each beat that failed and why.
export const resultOf = (state: Runner): string =>
  state.failures.size
    ? [...state.failures].map(([name, why]) => `${name}: ${why}`).join("; ")
    : "ok"

// The heartbeat api/hono/src/lib/dashboard/ops.ts reads.
export const beat = (
  path: string,
  startedAt: Date,
  now: Date,
  lastResult: string,
  job = "ops-tick",
) =>
  writeAtomic(
    path,
    `${JSON.stringify({
      cycleSeconds: CYCLE_SECONDS,
      job,
      lastBeatAt: now.toISOString(),
      lastResult,
      pid: process.pid,
      startedAt: startedAt.toISOString(),
    })}\n`,
  )
