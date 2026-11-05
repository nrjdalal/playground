// auto_end.ts: ends a worker, reviewer or tester once its work is done, by SESSIONS.md#end (spawn.sh close, then its roster report), so no finished session sits idle.
// Two callers: ops-tick's auto-end beat every 5 minutes (sweep, over idle_sessions.ts's flags), and pr:merge and the train's land right after a merge (endMerged, over the PR's roster rows).
// Guards: only a worker, reviewer or tester is ever ended, never a manager, the dispatcher, a runner, the optimizer or a probe; it must be not busy for 10+ minutes; uncommitted or unpushed work in a worktree it used keeps it open, told to its lead.
// After a close, each worktree the session used is cleaned (cleanWorktree): its dev stack stopped, the worktree moved to the trash, its containers and branch removed, or kept with the reason.
// Every end and every refusal is one line for its lead; it signals nothing itself but through bun run dev:stop, which signals only the process groups that worktree's stack recorded.

import { basename, dirname, join } from "node:path"

import { kindOf, managerKindOfName } from "../../../packages/config/src/kinds"
import {
  type CollectInput,
  collect,
  liveInput,
  type Row,
  sessionPrs,
  workerOf,
} from "./idle_sessions"

export const QUIET_MINUTES = 10

const ENDABLE = new Set(["reviewer", "tester", "worker"])

// A roster status that already reads finished, so the row is left as it is.
const FINISHED = new Set(["closed", "done", "ended", "merged", "parked", "paused"])

export type Target = {
  kind: string | null
  lead?: string
  name: string
  refs: string[]
  sessionId?: string
  worker?: string
}

export type Line = { text: string; to: string }

export type EndDeps = {
  cleanup?: (target: Target) => Promise<string[]>
  close: (name: string) => Promise<{ ok: boolean; out: string }>
  report: (name: string, text: string) => Promise<void>
  unsaved: (target: Target) => Promise<string | null>
}

// The flag that ends a session, or null: checker-nothing ends a reviewer alone, which its worker resumes under the same name on its next push (rounds).
export function endsOn(row: Row): string | null {
  for (const why of row.why) {
    if (/^(?:checker-pr-done|checker-worker-gone|worker-prs-done)\b/.test(why)) return why
    if (why.startsWith("checker-nothing") && row.kind === "reviewer") return why
  }
  return null
}

// The lead a session's line goes to: its roster lead, else its worker's (resolved by the caller), else the builder seat, or ops for a checker whose worker holds the ops seat.
const leadOf = (lead?: string, worker?: string) =>
  lead ?? (managerKindOfName(worker ?? "") === "ops" ? "ops" : "builder")

// One session ended, its unsaved work checked first; the line for its lead either way, and a reviewer ended idle tells its worker too, who resumes it.
export async function endOne(target: Target, why: string, deps: EndDeps): Promise<Line[]> {
  const to = leadOf(target.lead, target.worker)
  if (!ENDABLE.has(target.kind ?? ""))
    return [{ text: `Not ended ${target.name} (${why}): a ${target.kind} is never ended`, to }]
  const unsaved = await deps.unsaved(target)
  if (unsaved)
    return [{ text: `Not ended ${target.name} (${why}): ${unsaved}; push it, then close it`, to }]
  const closed = await deps.close(target.name)
  if (!closed.ok)
    return [
      { text: `Not ended ${target.name} (${why}): spawn.sh close refused: ${closed.out}`, to },
    ]
  await deps.report(target.name, `ended automatically: ${why}`)
  const idle = why.startsWith("checker-nothing")
  const cleaned = deps.cleanup && !idle ? await deps.cleanup(target) : []
  const after = cleaned.length ? `; cleanup: ${cleaned.join("; ")}` : ""
  if (!idle) return [{ text: `Ended ${target.name}: ${why}${after}`, to }]
  const text = `Ended ${target.name}: ${why}${after}; resume it on the next push: scripts/spawn.sh resume ${target.name} <dir>`
  return target.worker && target.worker !== to
    ? [
        { text, to },
        { text, to: target.worker },
      ]
    : [{ text, to }]
}

// ops-tick's sweep: every session idle_sessions.ts flags with a flag that ends it.
export async function sweep(input: CollectInput, deps: EndDeps): Promise<Line[]> {
  const out: Line[] = []
  for (const row of await collect(input)) {
    const why = endsOn(row)
    if (!why) continue
    const sha = row.sha
      ? `, ${row.mergedPr ? `#${row.mergedPr} ` : ""}merged as ${row.sha.slice(0, 7)}`
      : ""
    out.push(...(await endOne(row, `${why}${sha}`, deps)))
  }
  return out
}

// Right after a merge: the PR's worker, reviewer and tester by their roster pr. A worker the roster gave a next task holds no pr of this PR (assign clears it), and a checker whose worker's row names another PR may serve it, so neither is ended, nor is one with another of its PRs open, as the sweep holds it, nor one whose roster prs list holds a PR or issue not merged or closed. One with no live session has its row ended; a busy one, or one quiet under 10 minutes, is left to the sweep.
export async function endMerged(
  url: string,
  sha: string,
  input: CollectInput,
  deps: EndDeps,
): Promise<Line[]> {
  const pr = await input.prState(url)
  const why = `#${/\/pull\/(\d+)/.exec(url)?.[1]} merged as ${sha.slice(0, 7)}`
  const out: Line[] = []
  for (const r of Object.values(input.roster)) {
    const name = r.name
    if (!name || r.pr !== url || FINISHED.has(r.status ?? "")) continue
    const kind = kindOf(name, r.kind)
    if (!ENDABLE.has(kind ?? "")) continue
    const worker = kind === "worker" ? undefined : workerOf(name, r.worker)
    const next = worker ? input.roster[worker]?.pr : undefined
    if (next && next !== url) continue
    const lead = r.lead ?? (worker ? input.roster[worker]?.lead : undefined)
    const queued = await Promise.all(
      (r.prs ?? []).filter((u) => u !== url).map((u) => input.prState(u)),
    )
    if (queued.some((s) => s === null || (s.state !== "merged" && s.state !== "closed"))) continue
    const d = input.sessions[name]
    if (!d) {
      await deps.report(name, `ended automatically: ${why}, with no live session`)
      out.push({
        text: `Ended ${name}'s row: ${why}, with no live session`,
        to: leadOf(lead, worker),
      })
      continue
    }
    const quiet = (input.now - (d.statusUpdatedAt || d.updatedAt || input.now * 1000) / 1000) / 60
    if (d.status === "busy" || !(quiet >= QUIET_MINUTES)) continue
    const others = (await sessionPrs(input, name, worker, d.sessionId)).filter((u) => u !== url)
    const states = await Promise.all(others.map((u) => input.prState(u)))
    // A failed read (null) holds too, as collect holds on it: a rate limit is no proof a PR closed.
    if (states.some((s) => s === null || s.state === "open")) continue
    const target = {
      kind,
      lead,
      name,
      refs: pr?.ref ? [pr.ref] : [],
      sessionId: d.sessionId,
      worker,
    }
    out.push(...(await endOne(target, why, deps)))
  }
  return out
}

// The wiring below is the only code that touches the machine.

const REPO = join(import.meta.dir, "..", "..", "..")

const runIn = async (argv: string[]): Promise<{ code: number; out: string }> => {
  const proc = Bun.spawn(argv, { stderr: "pipe", stdout: "pipe", timeout: 120_000 })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code: await proc.exited, out: `${out}${err}`.trim() }
}

const git = async (dir: string, args: string[]) => {
  const { code, out } = await runIn(["git", "-C", dir, ...args])
  return code === 0 ? out : null
}

// The folders a session's transcript ran in, or null when it could not be read.
async function cwdsOf(sessionId: string, projectsDir: string): Promise<string[] | null> {
  const cwds = new Set<string>()
  try {
    for (const rel of new Bun.Glob(`*/${sessionId}.jsonl`).scanSync({ cwd: projectsDir })) {
      const text = await Bun.file(join(projectsDir, rel)).text()
      for (const m of text.matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)) cwds.add(JSON.parse(`"${m[1]}"`))
    }
  } catch {
    return null
  }
  return [...cwds]
}

// The worktrees a session used: each linked worktree its transcript ran in, and for a worker each worktree on its PRs' branches; null when its transcript cannot be read.
export async function worktreesOf(target: Target, projectsDir: string): Promise<string[] | null> {
  const dirs = new Set<string>()
  const cwds = target.sessionId ? await cwdsOf(target.sessionId, projectsDir) : []
  if (!cwds) return null
  for (const cwd of cwds) {
    const top = await git(cwd, ["rev-parse", "--show-toplevel"])
    if (!top) continue
    // Every session starts in the main checkout (its git dir is the common one), so what sits there untracked is not this session's work.
    const [gitDir, commonDir] = (
      (await git(top, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"])) ??
      ""
    ).split("\n")
    if (!gitDir || gitDir !== commonDir) dirs.add(top)
    if (target.kind !== "worker" || !target.refs.length) continue
    const list = (await git(top, ["worktree", "list", "--porcelain"])) ?? ""
    for (const block of list.split("\n\n")) {
      const path = /^worktree (.+)$/m.exec(block)?.[1]
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
      if (path && branch && target.refs.includes(branch)) dirs.add(path)
    }
  }
  return [...dirs]
}

// Why the work in a worktree the session used is not saved, or null.
export async function unsavedLive(target: Target, projectsDir: string): Promise<string | null> {
  const dirs = await worktreesOf(target, projectsDir)
  if (!dirs) return `could not check its transcript in ${projectsDir}`
  // A failed read is no proof the work is saved, so it holds the end too.
  for (const dir of dirs) {
    const status = await git(dir, ["status", "--porcelain"])
    if (status === null) return `could not check ${dir}`
    if (status) return `uncommitted work in ${dir}`
    const ahead = await git(dir, ["rev-list", "--count", "HEAD", "--not", "--remotes"])
    if (ahead === null) return `could not check ${dir}`
    if (Number(ahead) > 0) return `unpushed commits in ${dir}`
  }
  return null
}

// What one worktree's cleanup reads and runs, so a test hands it fakes: git in a folder, the main checkout, the live dashboard's branch, the live session or clone holding a worktree, its dev stack's stop, playground rm --worktree, the containers docker lists and its remove, and whether a name is the live dashboard's database.
export type CleanupDeps = {
  containers: () => Promise<string[] | null>
  devStop: (dir: string) => Promise<{ ok: boolean; out: string }>
  git: (dir: string, args: string[]) => Promise<string | null>
  held: (path: string) => Promise<string | null>
  live: (container: string) => boolean
  liveBranch: string
  main: string
  removeContainer: (name: string) => Promise<boolean>
  rm: (path: string, reason: string) => Promise<{ ok: boolean; out: string }>
}

// Pure: the containers a worktree's cleanup may remove, playground-<worktree>-db and -redis as AGENTS.md names a worktree's own, for a folder directly in <main>/.claude/worktrees alone and never the live dashboard's database.
export const containersFor = (
  path: string,
  main: string,
  live: (container: string) => boolean,
): string[] => {
  if (dirname(path) !== join(main, ".claude", "worktrees")) return []
  const name = basename(path).replace(/[^a-zA-Z0-9_.-]/g, "-")
  return [`playground-${name}-db`, `playground-${name}-redis`].filter((c) => !live(c))
}

// One worktree a closed session used, cleaned once its work is saved: a Playground worktree's dev stack stopped, the worktree moved to the trash by playground rm (which refuses one a live session or a process holds), then its containers removed by exact name; another repo's worktree removed by git with no force flag, then pruned; then its branch deleted. The line saying what went, or why it stayed.
export async function cleanWorktree(
  path: string,
  reason: string,
  deps: CleanupDeps,
): Promise<string> {
  const [gitDir, commonDir] = (
    (await deps.git(path, [
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
      "--git-common-dir",
    ])) ?? ""
  ).split("\n")
  if (!gitDir || !commonDir || gitDir === commonDir) return `kept ${path}: not a linked worktree`
  const branch = await deps.git(path, ["symbolic-ref", "--short", "-q", "HEAD"])
  if (branch === deps.liveBranch) return `kept ${path}: the live dashboard's checkout`
  const status = await deps.git(path, ["status", "--porcelain"])
  if (status === null) return `kept ${path}: could not read its git status`
  if (status) return `kept ${path}: uncommitted work`
  const ahead = await deps.git(path, ["rev-list", "--count", "HEAD", "--not", "--remotes"])
  if (ahead === null) return `kept ${path}: could not count its unpushed commits`
  if (Number(ahead) > 0) return `kept ${path}: unpushed commits`
  const repo = dirname(commonDir)
  const gone: string[] = []
  let listed: string[] | null = []
  if (repo === deps.main) {
    const own = containersFor(path, deps.main, deps.live)
    if (!own.length)
      return `kept ${path}: not a worktree in ${join(deps.main, ".claude", "worktrees")}`
    const holder = await deps.held(path)
    if (holder) return `kept ${path}: ${holder}`
    const stopped = await deps.devStop(path)
    if (!stopped.ok && !stopped.out.includes("no stack is recorded"))
      return `kept ${path}: ${stopped.out}`
    const moved = await deps.rm(path, reason)
    if (!moved.ok) return `kept ${path}: ${moved.out}`
    listed = await deps.containers()
    if (listed)
      for (const name of own)
        if (listed.includes(name) && (await deps.removeContainer(name))) gone.push(name)
  } else {
    if ((await deps.git(repo, ["worktree", "remove", path])) === null)
      return `kept ${path}: git worktree remove refused it`
    await deps.git(repo, ["worktree", "prune"])
  }
  const deleted = branch ? (await deps.git(repo, ["branch", "-D", branch])) !== null : false
  const containers = listed
    ? gone.length
      ? `, containers ${gone.join(", ")}`
      : ""
    : ", its containers kept since docker ps could not list them"
  return `removed ${path}${containers}${deleted ? `, branch ${branch}` : ""}`
}

// This machine's cleanup deps: git, the main checkout this one belongs to, bun run dev:stop in the worktree, playground rm --worktree from this checkout, docker ps -a and docker rm -fv, and the live dashboard's database name.
async function cleanupDeps(): Promise<CleanupDeps | null> {
  const common = await git(REPO, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  if (!common) return null
  const { isLiveDatabase, livePair } = await import("../../../api/hono/src/lib/dev/live-dashboard")
  const { rmDeps } = await import("../../../packages/scripts/src/playground/rm")
  const { worktreeRefusal } = await import("../../../packages/safe-delete/src/index")
  const STATUSES = (await import("../../roster-statuses.json")).default
  const pair = livePair()
  const rm = rmDeps(REPO)
  return {
    containers: async () => {
      const { code, out } = await runIn(["docker", "ps", "-a", "--format", "{{.Names}}"])
      return code === 0 ? out.split("\n").filter(Boolean) : null
    },
    devStop: async (dir) => {
      const { code, out } = await runIn(["bun", "run", "--cwd", dir, "dev:stop"])
      const lines = out.split("\n")
      return { ok: code === 0, out: lines.find((l) => l.startsWith("dev:stop:")) ?? lines.at(-1)! }
    },
    git,
    // rm's roster and clone holders alone: its process check would see the stack dev:stop is about to stop, and its saved-work checks run after the stop
    held: async (path) =>
      worktreeRefusal(
        path,
        { home: rm.home, main: rm.main, trash: join(rm.data, "trash") },
        {
          clones: rm.clones(),
          discard: true,
          live: STATUSES.live,
          merged: () => null,
          procs: [],
          roster: join(rm.data, "roster.json"),
        },
      ),
    live: (container) => isLiveDatabase(container, pair),
    liveBranch: pair.branch,
    main: dirname(common),
    removeContainer: async (name) => (await runIn(["docker", "rm", "-fv", name])).code === 0,
    rm: async (path, reason) => {
      const cli = join(REPO, "packages", "scripts", "src", "playground", "cli.ts")
      const argv = [process.execPath, "--no-env-file", cli, "rm", "--worktree", path]
      const { code, out } = await runIn([...argv, "--reason", reason])
      return { ok: code === 0, out: out.split("\n").at(-1) ?? "" }
    },
  }
}

// After a session closes, each worktree it used, one at a time.
export const cleanupLive =
  (projectsDir: string) =>
  async (target: Target): Promise<string[]> => {
    const dirs = await worktreesOf(target, projectsDir)
    if (!dirs) return [`could not read its transcript in ${projectsDir}, so nothing was cleaned`]
    if (!dirs.length) return []
    const deps = await cleanupDeps()
    if (!deps) return ["could not find the main checkout, so nothing was cleaned"]
    const lines: string[] = []
    for (const dir of dirs) lines.push(await cleanWorktree(dir, `${target.name} ended`, deps))
    return lines
  }

export const liveDeps = (projectsDir: string): EndDeps => ({
  cleanup: cleanupLive(projectsDir),
  close: async (name) => {
    const { code, out } = await runIn(["bash", join(REPO, "scripts", "spawn.sh"), "close", name])
    return { ok: code === 0, out: out.split("\n").at(-1) ?? "" }
  },
  report: async (name, text) =>
    void (await runIn([
      process.execPath,
      join(REPO, "scripts", "roster.ts"),
      "report",
      name,
      text,
      "status=ended",
    ])),
  unsaved: (target) => unsavedLive(target, projectsDir),
})

// pr:merge's and the train's end of a merged PR's sessions on the live machine, each line sent to its lead.
export async function endMergedLive(
  url: string,
  sha: string,
  send: (to: string, text: string) => Promise<boolean>,
): Promise<void> {
  const input = await liveInput(1, Date.now() / 1000)
  for (const line of await endMerged(url, sha, input, liveDeps(input.projectsDir ?? "")))
    await send(line.to, line.text)
}
