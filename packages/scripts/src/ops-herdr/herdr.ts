import { readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { homedir, userInfo } from "node:os"
import { join } from "node:path"

import { envValue } from "@packages/config/org"
import { dataDir, dataDirOf } from "@packages/env/data-dir"

import { writeAtomic } from "../write-atomic"
import { assetOf, herdrPath, PIN_SOURCE, pinnedSum } from "./pin"

export const CYCLE_SECONDS = 60

// Two separate herdr servers: factory for every session, probes for drills and upgrades.
export const HERDR_SESSIONS = ["factory", "probes"]

export type Pin = { path: string; sha256: string; tag: string; version: string }
export type Found = { sha256: string; version: string }

// The pin as this machine reads it: Playground's own copy at the data folder's bin/herdr and the PR-owned sum of its release asset, tagged by the asset's key; a machine with no pinned asset reads an empty sum, which pinProblem names.
export const pinFor = (
  env: Record<string, string | undefined>,
  asset: string | null = assetOf(),
): Pin => ({
  path: herdrPath(env),
  sha256: asset ? pinnedSum(asset) : "",
  tag: asset ?? `${process.platform}-${process.arch}`,
  version: PIN_SOURCE.version,
})

// The config is PR-owned: the job copies it into the herdr folder, so it changes only through a reviewed PR.
export const CONFIG_SOURCE = readFileSync(join(import.meta.dir, "config.toml"), "utf8")

export const dataFolder = (env: Record<string, string | undefined>): string => dataDir(env)

// The sockets follow HOME, as herdr's own state folder does, never CLAUDE_CONFIG_DIR or PLAYGROUND_DATA_DIR, so a session on another Claude login reaches the same servers rather than starting a second factory on one state. PLAYGROUND_HERDR_DIR and PLAYGROUND_HERDR_SESSIONS move a scratch server off the factory's socket and session names.
export const herdrDir = (env: Record<string, string | undefined>): string =>
  envValue(env, "PLAYGROUND_HERDR_DIR") || join(dataDirOf({}, env.HOME || homedir()), "herdr")

// A server's name is a word, as spawn.sh takes it, since it names a socket file and a state folder, and never default, herdr's own server; any other name in the list is skipped and named on every beat.
const WORD = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const serverNames = (
  env: Record<string, string | undefined>,
): { sessions: string[]; skipped: string[] } => {
  const names =
    envValue(env, "PLAYGROUND_HERDR_SESSIONS")?.split(",").filter(Boolean) ?? HERDR_SESSIONS
  return {
    sessions: names.filter((name) => WORD.test(name) && name !== DEFAULT_SERVER),
    skipped: names.filter((name) => !WORD.test(name) || name === DEFAULT_SERVER),
  }
}

export const sessionsOf = (env: Record<string, string | undefined>): string[] =>
  serverNames(env).sessions

const BASICS = ["HOME", "LANG", "LOGNAME", "PATH", "SHELL", "TERM", "USER"] as const

// herdr's own default server, on ~/.config/herdr/herdr.sock, which no factory job starts; ops:herdr reaches it only to stop it.
export const DEFAULT_SERVER = "default"

// This uid's account name and login shell as /usr/bin/dscl reads them, for a start from a GUI app or env -i: Bun's userInfo() takes them from USER and SHELL, else "unknown" (measured on 1.4.3), macOS has an account named unknown whose shell is /usr/bin/false, and herdr refuses every pane of a server whose SHELL it cannot find. PLAYGROUND_DSCL names a fake dscl inside the test sandbox alone.
function account(env: Record<string, string | undefined>): { name?: string; shell?: string } {
  const dscl = (env.TEST_SANDBOX_HOME && env.PLAYGROUND_DSCL) || "/usr/bin/dscl"
  const read = (...args: string[]): string => {
    try {
      const done = Bun.spawnSync([dscl, ".", ...args])
      return done.exitCode === 0 ? done.stdout.toString() : ""
    } catch {
      return ""
    }
  }
  const name = read("-search", "/Users", "UniqueID", String(process.getuid?.())).split(/\s/)[0]
  if (!name) return {}
  return {
    name,
    shell: read("-read", `/Users/${name}`, "UserShell").split("UserShell:")[1]?.trim(),
  }
}

// The shell basics alone, so a herdr call with no session or socket of its own reaches the default server.
export function basicEnv(env: Record<string, string | undefined>): Record<string, string> {
  const user = userInfo()
  const found = env.SHELL && env.USER && env.LOGNAME ? {} : account(env)
  const fallback: Record<(typeof BASICS)[number], string> = {
    HOME: user.homedir,
    LANG: "en_US.UTF-8",
    LOGNAME: found.name || user.username,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    SHELL: found.shell || "/bin/zsh",
    TERM: "xterm-256color",
    USER: found.name || user.username,
  }
  return Object.fromEntries(BASICS.map((name) => [name, env[name] || fallback[name]]))
}

// The server's whole environment, as env -i with the basics alone, so no session's token reaches a pane. herdr's socket follows HERDR_SOCKET_PATH only when the session comes from HERDR_SESSION, not --session (measured on 0.9.5); its state and log stay in ~/.config/herdr/sessions/<name>, since only XDG_CONFIG_HOME moves them and every pane would inherit that.
export function serverEnv(
  env: Record<string, string | undefined>,
  dir: string,
  session: string,
): Record<string, string> {
  return {
    ...basicEnv(env),
    HERDR_CONFIG_PATH: join(dir, "config.toml"),
    HERDR_SESSION: session,
    HERDR_SOCKET_PATH: join(dir, `${session}.sock`),
  }
}

const FORBIDDEN = /^(CLAUDE_CODE_|CMUX_)/

// What a pane's environment holds, as names and lengths alone, and the names no pane may carry.
export function envReport(env: Record<string, string | undefined>): {
  forbidden: string[]
  lines: string[]
} {
  const names = Object.keys(env).toSorted()
  return {
    forbidden: names.filter((name) => FORBIDDEN.test(name)),
    lines: names.map((name) => `${name} ${env[name]?.length ?? 0}`),
  }
}

export function pinProblem(pin: Pin, found: Found | null): string | null {
  if (!pin.sha256)
    return `the pin names no herdr ${pin.version} sha256 for release asset ${pin.tag}`
  if (!found)
    return `herdr at ${pin.path} cannot be read; the pin names ${pin.version} ${pin.sha256}`
  if (found.sha256 === pin.sha256 && found.version === pin.version) return null
  return `herdr at ${pin.path} is ${found.version} ${found.sha256}; the pin names ${pin.version} ${pin.sha256}`
}

type PaneEntry = { agent?: unknown; cwd?: unknown; pane_id?: unknown }

// The panes `pane list` answered with, or null when its answer does not read.
const panesOf = (list: unknown): PaneEntry[] | null => {
  const panes = (list as { result?: { panes?: unknown } } | null)?.result?.panes
  return Array.isArray(panes) ? (panes as PaneEntry[]) : null
}

// A stop exits every pane, a turn in flight included (L5), so it waits until the session holds none; the default server's shell panes (herdr leaves out `agent`) are no one's work, so there it waits only on a pane running an agent.
export function stopRefusal(session: string, list: unknown): string | null {
  const all = panesOf(list)
  if (!all) return `refusing to stop ${session}: cannot read its panes`
  const panes = session === DEFAULT_SERVER ? all.filter((pane) => pane.agent != null) : all
  if (panes.length === 0) return null
  const names = panes.map((pane) => `${String(pane.agent ?? pane.pane_id)} (${String(pane.cwd)})`)
  return `refusing to stop ${session}: ${panes.length} live, ${names.join(", ")}`
}

// One line for playground status: a server down, or up with the sessions its panes hold, a pane counting while it names an agent.
export function statusLine(session: string, up: boolean, list: unknown): string {
  if (!up) return `herdr ${session}: down`
  const panes = panesOf(list)
  if (!panes) return `herdr ${session}: up, its panes cannot be read`
  const n = panes.filter((pane) => Boolean(pane.agent)).length
  return `herdr ${session}: up, ${n} ${n === 1 ? "session" : "sessions"}`
}

// status's lines, one a server, its panes read only while it is up; a status that cannot be read reads down.
export async function serverStatusLines(
  sessions: string[],
  running: (session: string) => Promise<boolean>,
  paneList: (session: string) => unknown,
): Promise<string[]> {
  const lines: string[] = []
  for (const session of sessions) {
    const up = await running(session).catch(() => false)
    lines.push(statusLine(session, up, up ? paneList(session) : null))
  }
  return lines
}

// What attach opens, a client on the pinned binary with the server's own environment, or why it opens nothing: a server not in the list, a binary off the pin, or a server that is down, since a bare herdr would start one off the pin's checks and env -i.
export function attachPlan(
  env: Record<string, string | undefined>,
  dir: string,
  session: string,
  sessions: string[],
  pin: Pin,
  found: Found | null,
  up: boolean,
): { argv: string[]; env: Record<string, string> } | { error: string } {
  if (!sessions.includes(session)) return { error: `attach takes one of ${sessions.join(", ")}` }
  const pinned = pinProblem(pin, found)
  if (pinned)
    return {
      error: `${pinned}; playground herdr pin puts herdr ${pin.version} back at ${pin.path}, or move the pin in a PR to packages/scripts/src/ops-herdr/pin.json`,
    }
  if (!up)
    return {
      error: `${session} is not running; playground, or bun run ops:herdr start, brings it up`,
    }
  return { argv: [pin.path], env: serverEnv(env, dir, session) }
}

const LOADED = /herdr server started|"api\.request\.start".*method="server\.reload_config"/
const CONFIG_WARNING = /\sWARN herdr::config[\w:]*: (?:config diagnostic )?(.*)$/

// herdr falls back to a default on a bad config value with only a log warning, logged right after the server starts or a reload's request line (measured on 0.9.5), so the beat reads the warnings since the last of those, and a config fixed by a reload clears.
export function configWarnings(log: string): string[] {
  const lines = log.split("\n")
  const start = lines.findLastIndex((line) => LOADED.test(line))
  return lines
    .slice(start + 1)
    .map((line) => CONFIG_WARNING.exec(line)?.[1]?.trim())
    .filter((warning): warning is string => Boolean(warning))
}

export type CycleDeps = {
  found: () => Promise<Found | null>
  log: (session: string) => Promise<string | null>
  // Whether a server's restore is still owed (owedFile).
  owed: (session: string) => Owed
  pin: Pin
  // spawn.sh restore for one server: null once every session its resume records place there is back, else what failed (restoreProblem).
  restore: (session: string) => Promise<string | null>
  running: (session: string) => Promise<boolean>
  sessions: string[]
  // The names in the list that are not a server's (serverNames).
  skipped: string[]
  start: (session: string) => Promise<string | null>
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// Set as a server starts, and cleared once restore passes, so a session restore's gate refused comes back on a later cycle.
export type Owed = { get: () => Promise<boolean>; set: (owed: boolean) => Promise<void> }

// A file beside the server's socket, so the job finishes a restore that `start` (bun run dev, the dispatcher) began and the gate cut short.
export const owedFile = (dir: string, session: string): Owed => {
  const path = join(dir, `${session}.restore`)
  return {
    get: () => Bun.file(path).exists(),
    set: async (owed) => {
      if (owed) await writeAtomic(path, `${new Date().toISOString()}\n`)
      else await rm(path, { force: true })
    },
  }
}

// One beat: "ok", or every problem, a throw included, so the beat names it. A server that is down starts only on the pinned binary, and every server that starts restores its own sessions; one that runs is never restarted, a changed binary included, since a stop exits every pane.
export async function cycle(deps: CycleDeps): Promise<string> {
  const problems = deps.skipped.map(
    (name) => `${name}: not a herdr server name (a word of a-z, 0-9 and -), skipped`,
  )
  try {
    const pinned = pinProblem(deps.pin, await deps.found())
    if (pinned) problems.push(pinned)
    for (const session of deps.sessions) {
      let up: boolean
      try {
        up = await deps.running(session)
      } catch (err) {
        problems.push(`${session}: cannot read its status: ${messageOf(err)}`)
        continue
      }
      if (!up) {
        if (pinned) {
          problems.push(`${session}: down, not started on an unpinned binary`)
          continue
        }
        // Owed before the start, since a start that gives up at 10s leaves a server that still comes up, which the next cycle finds running.
        await deps.owed(session).set(true)
        const failed = await deps.start(session)
        if (failed) problems.push(`${session}: ${failed}`)
        up = !failed
      }
      if (up) {
        try {
          if (await deps.owed(session).get()) {
            const failed = await deps.restore(session)
            if (failed) problems.push(`${session}: ${failed}`)
            else await deps.owed(session).set(false)
          }
        } catch (err) {
          problems.push(`${session}: restore: ${messageOf(err)}`)
        }
      }
      for (const warning of configWarnings((await deps.log(session)) ?? "")) {
        problems.push(`${session}: ${warning}`)
      }
    }
  } catch (err) {
    problems.push(messageOf(err))
  }
  return problems.length === 0 ? "ok" : problems.join("; ")
}

// start's one check, for bun run dev and the dispatcher: a line for each server it started, then ok, that all were up when it started none, or the problems.
export async function startOnce(deps: CycleDeps): Promise<{ lines: string[]; ok: boolean }> {
  const started: string[] = []
  const result = await cycle({
    ...deps,
    start: async (session) => {
      const failed = await deps.start(session)
      if (!failed) started.push(session)
      return failed
    },
  })
  const lines = started.map((session) => `started ${session}`)
  if (result !== "ok") lines.push(result)
  else lines.push(started.length > 0 ? "ok" : `all were up: ${deps.sessions.join(", ")}`)
  return { lines, ok: result === "ok" }
}

// The job: a check now and every cycle, each beating its result, a changed binary included; a check still running at a cycle beats as failing, so one that hangs still shows.
export function runJob(deps: CycleDeps, path: string, every = CYCLE_SECONDS * 1000): () => void {
  const startedAt = new Date()
  let checking = false
  const pulse = (result: string) =>
    beat(path, startedAt, new Date(), result).catch((err) => console.error(err))
  const check = async () => {
    checking = true
    const result = await cycle(deps)
    checking = false
    console.log(`${new Date().toISOString()} ${result}`)
    await pulse(result)
  }
  void check()
  const timer = setInterval(() => {
    void (checking ? pulse("still checking herdr from the last cycle") : check())
  }, every)
  return () => clearInterval(timer)
}

// spawn.sh restore runs with the job's own environment, pointed at the server the job started, since a scratch server moves both names.
export const restoreEnv = (
  env: Record<string, string | undefined>,
  dir: string,
  session: string,
): Record<string, string | undefined> => ({
  ...env,
  PLAYGROUND_HERDR_DIR: dir,
  PLAYGROUND_HERDR_SESSION: session,
})

// spawn.sh restore prints one line a session and exits 1 when any was not restored, so the beat names those lines, else its last line.
export function restoreProblem(code: number, output: string): string | null {
  if (code === 0) return null
  const lines = output.split("\n").filter(Boolean)
  const missed = lines.filter((line) => line.startsWith("not restored: "))
  return `restore: ${missed.length > 0 ? missed.join("; ") : (lines.at(-1) ?? `exited ${code}`)}`
}

// The heartbeat api/hono/src/lib/dashboard/ops.ts reads.
export const beat = (path: string, startedAt: Date, now: Date, lastResult: string) =>
  writeAtomic(
    path,
    `${JSON.stringify({
      cycleSeconds: CYCLE_SECONDS,
      job: "ops-herdr",
      lastBeatAt: now.toISOString(),
      lastResult,
      pid: process.pid,
      startedAt: startedAt.toISOString(),
    })}\n`,
  )
