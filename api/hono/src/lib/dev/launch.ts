import "@packages/env/aliases"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"

import { SQL } from "bun"
import { RouteStore } from "portless"

import { type Attachment, attachment, cmuxHeld } from "@/lib/dashboard/cmux"
import {
  type DashboardRule,
  dashboardSource,
  type Fixture,
  loadFixture,
} from "@/lib/dashboard/fixture"
import {
  type Container,
  CONTAINER_LIST,
  containersOf,
  isLiveDatabase,
  type LiveDashboard,
  liveDatabaseHeld,
  livePair,
  unreusedLiveDatabase,
} from "@/lib/dev/live-dashboard"
import { listening, portlessDir } from "@/lib/dev/proxy"
import {
  GuardError,
  type GuardFailure,
  type Located,
  locate as locateOwner,
  prove as proveOwner,
} from "@/lib/sessions/guard"
import { cmuxSessions } from "@/lib/sessions/own"

// What `bun run dev` hands turbo: the shell's environment, less what would boot the wrong stage, plus the settings and the sha the stack runs with.

// The worktree commit recipe exports NODE_ENV=production and SKIP_ENV_VALIDATION=true for the pre-commit build; a stack started under them boots in the production stage on unchecked settings, so both are dropped, each for its reason, and PLAYGROUND_HERDR_ALONE, which would silence cmux on a stack cmux answers.
export const DROPPED: Record<string, string> = {
  PLAYGROUND_HERDR_ALONE: "so only the launcher sets it",
  NODE_ENV: "so the stage comes from .env",
  SKIP_ENV_VALIDATION: "so .env is validated",
}

// Every stack registers on portless's own proxy, https on 443 as `portless service install` keeps it, with the hosts file left alone.
export const PORTLESS = { PORTLESS_SYNC_HOSTS: "0" }

// The bare names the live dashboard takes beside its own `desk.`-prefixed names, as portless names their hosts.
const BARE_HOSTS = ["api.playground.localhost", "playground.localhost"]

// What the live dashboard's stack is told beyond any other's: that the bare names are its too, so the API trusts the bare web origin (.github/scripts/portless.ts). Its own URLs stay its `desk.`-prefixed names, so it works whatever the aliases hold.
export const dashboardEnv = (
  { branch }: Checkout,
  liveDashboard: LiveDashboard = livePair(),
): Record<string, string> => (branch === liveDashboard.branch ? { PLAYGROUND_BARE_NAMES: "1" } : {})

// Each bare name paired with the live dashboard's own name for the same app, whose route holds the port its stack bound.
export const dashboardAliasPairs = (prefix: string): [string, string][] =>
  BARE_HOSTS.map((host) => [`${prefix}.${host}`, host])

// Points each alias at the port its stack's route holds now, so the aliases follow the stack to the ports portless picked at every start. It writes only what moved, leaves an alias whose route is not up, and never takes a name a running stack holds (portless's own conflict, no force).
export const syncAliases = (
  pairs: [string, string][],
  dir = portlessDir(),
): { failed: string[]; wrote: string[] } => {
  const store = new RouteStore(dir)
  const ports = new Map(store.loadRoutes().map((r) => [r.hostname, r.port]))
  const failed: string[] = []
  const wrote: string[] = []
  for (const [route, alias] of pairs) {
    const port = ports.get(route)
    if (port === undefined || ports.get(alias) === port) continue
    try {
      store.addRoute(alias, port, 0)
      wrote.push(`${alias} -> ${port}`)
    } catch (error) {
      failed.push(`${alias}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { failed, wrote }
}

// The bare names held in portless's routes, by an alias or a running stack.
export const heldBareHosts = (dir = portlessDir()): string[] =>
  new RouteStore(dir)
    .loadRoutes()
    .map((route) => route.hostname)
    .filter((host) => BARE_HOSTS.includes(host))

// Removes each alias of a bare name whose port nothing listens on, an earlier dashboard's leftover: portless reads an alias's pid 0 as alive and keeps it forever, so a stack taking the name would fail on its conflict. A live dashboard's alias answers, and its launcher writes it back within 2s of a restart.
export const clearStaleAliases = async (
  dir = portlessDir(),
  listens = listening,
): Promise<string[]> => {
  const store = new RouteStore(dir)
  const cleared: string[] = []
  for (const route of store.loadRoutes()) {
    if (route.pid !== 0 || !BARE_HOSTS.includes(route.hostname)) continue
    if (await listens(route.port)) continue
    store.removeRoute(route.hostname, 0)
    cleared.push(`${route.hostname} -> ${route.port}`)
  }
  return cleared
}

// The bare names a checkout portless gives them would find held, once each stale alias of theirs is cleared and named.
const heldAfterClearing = async (): Promise<string[]> => {
  for (const line of await clearStaleAliases()) {
    console.error(`dev: portless removed the stale alias ${line}, which nothing listens on`)
  }
  return heldBareHosts()
}

export type DevEnv = { env: Record<string, string>; notes: string[] }

// GIT_SHA is HEAD's short sha, which getBuildVersion() reports ahead of the one baked into @packages/env: turbo replays that build when only the commit moved, so /api/health would otherwise name an older commit.
export const devEnv = (shell: Record<string, string | undefined>, gitSha: string): DevEnv => {
  const env: Record<string, string> = {}
  const notes: string[] = []
  for (const [key, value] of Object.entries(shell)) {
    if (value === undefined) continue
    const reason = DROPPED[key]
    if (reason) {
      notes.push(`ignoring ${key}=${value} from the shell, ${reason}`)
      continue
    }
    env[key] = value
  }
  Object.assign(env, PORTLESS)
  if (gitSha) env.GIT_SHA = gitSha
  return { env, notes }
}

// The stack of a live dashboard that reads herdr alone: the API's cmux reads go quiet (herdrAlone in lib/dashboard/cmux.ts).
export const herdrAloneEnv = (env: Record<string, string>): Record<string, string> => ({
  ...env,
  PLAYGROUND_HERDR_ALONE: "1",
})

// What a fixture stack's processes are told of the fixture the launcher wrote for them: its folder, so they read that one, and that the launcher owns it, so a process outliving the stop never writes it back (fixture.ts's ensureFixture).
export const fixtureStackEnv = (
  env: Record<string, string>,
  dir: string,
): Record<string, string> => ({
  ...env,
  PLAYGROUND_FIXTURE_DIR: dir,
  PLAYGROUND_FIXTURE_LAUNCHED: "1",
})

// turbo's dry run, `--dry` or `--dry-run`, bare or `=json`: it starts nothing, so the checks that guard a start stay out of its way.
export const isDryRun = (args: string[]): boolean =>
  args.some((arg) => /^--dry(?:-run)?(?:=|$)/.test(arg))

const git = (root: string, args: string[]): string | null => {
  const result = Bun.spawnSync(["git", ...args], { cwd: root, stderr: "ignore", stdin: "ignore" })
  return result.exitCode === 0 ? result.stdout.toString().trim() : null
}

export type Checkout = {
  // null on a detached HEAD
  branch: string | null
  // a linked worktree, the only kind portless prefixes with its branch
  linked: boolean
}

// The branch and the kind of checkout, as portless reads them to name a stack.
export const checkoutOf = (root: string): Checkout => {
  const dir = (flag: string) => {
    const path = git(root, ["rev-parse", flag]) ?? ""
    return isAbsolute(path) ? path : resolve(root, path)
  }
  return {
    branch: git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    linked: dir("--git-dir") !== dir("--git-common-dir"),
  }
}

// The main checkout, whose code moves only through merged PRs, from any worktree of it; null outside git.
export const mainCheckoutOf = (root: string): string | null => {
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
  return common ? dirname(common) : null
}

// The settings the API reads that decide what its stack is: where the dashboard's data comes from (fixture.ts's dashboardSource, which also reads who runs the stack: Claude Code, a factory role, a test run), the folder a fixture stack's scratch copy sits in, and the database it writes.
export const API_SETTINGS = [
  "CLAUDECODE",
  "PLAYGROUND_CMUX_SESSIONS",
  "PLAYGROUND_FIXTURE",
  "PLAYGROUND_FIXTURE_DIR",
  "PLAYGROUND_HOSTED",
  "PLAYGROUND_LIVE_READS",
  "PLAYGROUND_ROLE",
  "NODE_ENV",
  "POSTGRES_URL",
] as const

export type ApiSettings = Partial<Record<(typeof API_SETTINGS)[number], string>>

export type SettingsRead = { ok: true; settings: ApiSettings } | { error: string; ok: false }

// API_SETTINGS as the API will read them: @packages/env's own loader, imported from api/hono as the API's working directory over the environment turbo hands the API, so .env and its stage's file (.env.local and the like) apply as they do there. An empty value reads as unset. The caller names the built loader by path, so root may be a scratch checkout with no build of its own.
export const apiSettings = (
  root: string,
  env: Record<string, string>,
  loader: string,
): SettingsRead => {
  const read = Bun.spawnSync(
    [
      process.execPath,
      "--no-env-file",
      "-e",
      `await import(${JSON.stringify(loader)}); process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(API_SETTINGS)}.map((key) => [key, process.env[key] || undefined]))))`,
    ],
    { cwd: join(root, "api/hono"), env, stderr: "pipe", stdin: "ignore", stdout: "pipe" },
  )
  if (read.exitCode !== 0) {
    return { error: read.stderr.toString().trim().slice(0, 500), ok: false }
  }
  return {
    ok: true,
    settings: JSON.parse(read.stdout.toString()) as ApiSettings,
  }
}

// The .env's gaps among the required keys, read in a fresh bun child of the API's working directory: @packages/env/gaps owns the schemas, the .env.example filter, the child and the refusal words. A module the build writes during the run is read in a fresh child process, since this process's resolver has cached the old dist for the whole package: it has already resolved other @packages/env exports, so a require or import here would miss the file the build just wrote. The caller names the built module by gapsPath, as it names apiSettings's loader. POSTGRES_URL is never a gap here, since with none the API serves its setup (SETUP_MODE, below).
export const envGaps = (
  root: string,
  env: Record<string, string>,
  gapsPath: string,
):
  | { error: string; ok: false }
  | { empty: string[]; missing: string[]; ok: true; refusal: string } => {
  const read = Bun.spawnSync(
    [
      process.execPath,
      "--no-env-file",
      "-e",
      `const { readEnvGaps } = await import(process.argv[2]); process.stdout.write(JSON.stringify(readEnvGaps(process.argv[1], process.env, ["POSTGRES_URL"])))`,
      join(root, "api/hono"),
      gapsPath,
    ],
    { cwd: join(root, "api/hono"), env, stderr: "pipe", stdin: "ignore", stdout: "pipe" },
  )
  if (read.exitCode !== 0) {
    return {
      error: read.stderr.toString().trim().slice(0, 500) || "the child gave no error",
      ok: false,
    }
  }
  // the child's verdict as read: a failed inner read stays ok: false
  return JSON.parse(read.stdout.toString())
}

export { livePair }

// Pure: whether a container is the live dashboard's database seen from a checkout on another branch, which the launcher and bun run ask both refuse.
export const othersLiveDashboard = (
  container: string,
  branch: string | null,
  liveDashboard: LiveDashboard = livePair(),
): boolean => isLiveDatabase(container, liveDashboard) && branch !== liveDashboard.branch

const UNPREFIXED = new Set(["main", "master"])

// The prefix portless gives a linked worktree's stack, as its cli.js names it (branchToPrefix and sanitizeForHostname): the branch's last segment, lowercased, with anything but letters, digits and hyphens turned to hyphens, runs of them merged and the ends trimmed; none on main or master, or when nothing is left. Its truncation of a label past 63 characters ends in a hash, so it never yields a short prefix such as dashboard.
export const prefixOf = (branch: string): string | null => {
  if (UNPREFIXED.has(branch)) return null
  const prefix = (branch.split("/").at(-1) ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
  return prefix || null
}

const OWN_DATABASE =
  "start this worktree's .env from .env.example and point POSTGRES_URL at a container of its own, published on loopback alone: `docker run -d --name playground-<worktree>-db -e POSTGRES_PASSWORD=<pw> -p 127.0.0.1::5432 postgres:alpine`, then `docker port playground-<worktree>-db 5432` for its port (the db-migration skill's step 3)"

// The fix for each way the guard refuses.
const FIX: Record<GuardFailure, string> = {
  "docker-down": "start Docker, then run `bun run dev` again",
  exposed: OWN_DATABASE,
  "no-docker": "install Docker or put `docker` on PATH, then run `bun run dev` again",
  "no-owner": `if this worktree's container has stopped, \`docker start playground-<worktree>-db\`, then \`docker port playground-<worktree>-db 5432\` for the port POSTGRES_URL names; if it has none, ${OWN_DATABASE}`,
  "not-postgres": OWN_DATABASE,
  "other-server": OWN_DATABASE,
  remote: OWN_DATABASE,
  vanished: "Docker is up, so run `bun run dev` again",
}

// What the stack's dashboard reads, and the rule of dashboardSource's that chose it: the live machine, the fixture the launcher writes for it, or, on a stack of the hosted build, nothing. A live dashboard reads herdr alone (`cmux: false`) unless it opts in to cmux's sessions (`reason` null), or when cmux would not answer it while cmux held no live factory session (`reason` says why).
export type Dashboard =
  | { fixture: Fixture; kind: "fixture"; rule: DashboardRule }
  | { kind: "hosted" }
  | { cmux: false; kind: "live"; reason: string | null; rule: DashboardRule }
  | { cmux: true; kind: "live"; rule: DashboardRule }

export type Preflight =
  | { dashboard: Dashboard; ok: true; proof: string }
  | { ok: false; refusal: string }

const refuse = (refusal: string): Preflight => ({ ok: false, refusal })

const refuseFor = (error: unknown): Preflight =>
  error instanceof GuardError
    ? refuse(`${error.message}; ${FIX[error.failure]}`)
    : refuse(`${error instanceof Error ? error.message : String(error)}; ${OWN_DATABASE}`)

const FIXTURE_FIX =
  "point PLAYGROUND_FIXTURE at a dashboard fixture file (api/hono/src/fixtures/dashboard.json is the shape), or set it to shipped for that one"

// The fix for each way a stack started from here could not read cmux.
const UNATTACHED: Record<Exclude<Attachment["state"], "attached">, (detail: string) => string> = {
  detached: () =>
    "this process does not descend from a cmux terminal, so cmux would refuse the stack's API every read (turbo passes it no capability token); start `bun run dev` in a cmux terminal, or as a background task of an agent session running in one, never detached with `( … &)` or `nohup`",
  missing: () =>
    "cmux is not installed or not on PATH, and the dashboard reads every session through it; install cmux, then start `bun run dev` in one of its terminals",
  unreachable: (detail) =>
    `cmux did not answer a read (${detail}); make sure cmux is running and answering, then start \`bun run dev\` in one of its terminals`,
}

// The worktree's database needs the schema the migration makes: a fresh container has none, and a stack booted on it signs nobody in, which verify only reports later as a sign-in timeout.
export const tableCount = async (url: string): Promise<number> => {
  const sql = new SQL(url, { connectionTimeout: 5, max: 1 })
  try {
    const [row] =
      await sql`select count(*)::int as count from information_schema.tables where table_schema = 'public'`
    return row?.count ?? 0
  } finally {
    await sql.close()
  }
}

// The live machine's registry, named here rather than through the dashboard's own reader, which follows this process's source: the launcher reads the API's settings, so a live-reads stack set in .env alone still reads a fixture's folder from here.
const liveHeld = () =>
  cmuxHeld(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "sessions"))

// Every container with its state, from `docker ps -a`; none when Docker does not answer, since first run's setup then checks again itself.
const containerList = (): Container[] => {
  const listed = Bun.spawnSync(["docker", ...CONTAINER_LIST], { stderr: "ignore", stdin: "ignore" })
  return listed.exitCode === 0 ? containersOf(listed.stdout.toString()) : []
}

export type Guard = {
  attach?: () => Promise<Attachment>
  bare?: () => string[] | Promise<string[]>
  containers?: () => Container[]
  held?: () => Promise<string[] | null>
  liveDashboard?: LiveDashboard
  locate?: (url: string) => Located
  prove?: (url: string, located: Located) => Promise<string>
  root?: string
  tables?: (url: string) => Promise<number>
}

// With no POSTGRES_URL the API serves its first-run setup alone (api/hono/src/main.ts), which starts a container of the checkout's own, the live dashboard's database on its own branch.
const SETUP_MODE =
  "none yet: POSTGRES_URL is unset, so the dashboard opens on its first run, whose database check starts a local container"

// Whether the stack may start here, checked before turbo runs and cheapest first: the branch, and for a checkout portless gives the bare names, whether a running stack or a live alias holds them, then the API's settings (read only once the branch passes), then where its dashboard reads from: nothing on a hosted build, a fixture that must load, or the live machine, read through herdr alone unless the stack opts in to cmux's sessions (PLAYGROUND_CMUX_SESSIONS), when it needs cmux to answer this process as it would the stack's API, or else no session live in cmux, read from ps and Claude's registry, when the dashboard reads herdr alone (a fixture stack never asks cmux, so it never opens the live socket); then POSTGRES_URL's container, refused by name before anything runs inside it or connects, then the proof that it is that container's own Postgres, then that its database has the schema the migration makes. The first refusal names its fix.
export async function preflight(
  { branch, linked }: Checkout,
  readSettings: () => SettingsRead,
  {
    attach = attachment,
    bare = heldAfterClearing,
    containers = containerList,
    held = liveHeld,
    liveDashboard = livePair(),
    locate = locateOwner,
    prove = proveOwner,
    root = process.cwd(),
    tables = tableCount,
  }: Guard = {},
): Promise<Preflight> {
  if (branch === null) {
    return refuse(
      "this checkout is on a detached HEAD, so portless gives its stack no branch prefix and it would claim the bare playground.localhost names; create a local branch first: `git switch -c <name>`",
    )
  }
  const prefix = prefixOf(branch)
  if (linked && prefix === null) {
    return refuse(
      `this worktree is on ${branch}, which portless gives no branch prefix, so its stack would claim the bare playground.localhost names; create a branch of its own first: \`git switch -c <name>\``,
    )
  }
  const taken = linked || process.env.PORTLESS === "0" ? [] : await bare()
  if (taken.length > 0) {
    return refuse(
      `this checkout is not a linked worktree, so portless gives its stack the bare names, and the live dashboard's aliases or another stack already hold them (${taken.join(", ")}); start the stack in a worktree of its own under .claude/worktrees/ instead`,
    )
  }
  if (linked && branch !== liveDashboard.branch && prefix === prefixOf(liveDashboard.branch)) {
    return refuse(
      `branch ${branch} takes portless's prefix ${prefix}, the live dashboard's own, so its stack would claim the ${prefix}.playground.localhost names; rename it first: \`git branch -m <name>\``,
    )
  }
  const read = readSettings()
  if (!read.ok) return refuse(`the API's settings could not be read: ${read.error}`)
  const source = dashboardSource({ branch, env: read.settings, root })
  if (source.kind === "refused") return refuse(source.reason)
  let dashboard: Dashboard =
    source.kind === "hosted" ? { kind: "hosted" } : { cmux: true, kind: "live", rule: source.rule }
  if (source.kind === "fixture") {
    const loaded = loadFixture(source.file)
    if (!loaded.ok) return refuse(`${loaded.error}; ${FIXTURE_FIX}`)
    dashboard = { fixture: loaded.fixture, kind: "fixture", rule: source.rule }
  } else if (source.kind === "live" && !cmuxSessions(read.settings.PLAYGROUND_CMUX_SESSIONS)) {
    dashboard = { cmux: false, kind: "live", reason: null, rule: source.rule }
  } else if (source.kind === "live") {
    const reach = await attach()
    if (reach.state !== "attached") {
      const fix = UNATTACHED[reach.state](reach.detail)
      const sessions = await held()
      if (sessions === null) {
        return refuse(
          `${fix}; whether a factory session is live in cmux could not be read from ps and Claude's registry, so the dashboard cannot read herdr alone`,
        )
      }
      if (sessions.length > 0) {
        return refuse(
          `${fix}; the dashboard reads herdr alone only while no factory session is live in cmux, and ${sessions.length} ${sessions.length === 1 ? "is" : "are"}: ${sessions.slice(0, 5).join(", ")}${sessions.length > 5 ? ", ..." : ""}`,
        )
      }
      dashboard = { cmux: false, kind: "live", reason: reach.detail, rule: source.rule }
    }
  }
  const url = read.settings.POSTGRES_URL
  if (!url && branch === liveDashboard.branch) {
    const existing = unreusedLiveDatabase(containers(), liveDashboard)
    if (existing) {
      return refuse(`POSTGRES_URL is unset, but ${liveDatabaseHeld(existing)}`)
    }
  }
  if (!url) return { dashboard, ok: true, proof: SETUP_MODE }
  let located: Located
  try {
    located = locate(url)
  } catch (error) {
    return refuseFor(error)
  }
  if (othersLiveDashboard(located.owner.name, branch, liveDashboard)) {
    return refuse(
      `POSTGRES_URL points at ${liveDashboard.database}, the live dashboard's database, which only its own checkout (branch ${liveDashboard.branch}) uses; ${OWN_DATABASE}`,
    )
  }
  try {
    const proof = await prove(url, located)
    if ((await tables(url)) === 0) return refuse("database has no tables: run bun run db:migrate")
    return { dashboard, ok: true, proof }
  } catch (error) {
    return refuseFor(error)
  }
}
