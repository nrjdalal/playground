import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { loadavg } from "node:os"
import { basename, join } from "node:path"

import { SQL } from "bun"
import { drizzle } from "drizzle-orm/bun-sql"
import { migrate as drizzleMigrate } from "drizzle-orm/bun-sql/migrator"

import { branchOf, checkoutRoot, fixtureVibe, readsLive } from "@/lib/dashboard/fixture"
import { readStacks, type Stack, VIBE_RECORD } from "@/lib/dashboard/stacks"
import {
  CONTAINER_LIST,
  containersOf,
  isLiveDatabase,
  type LiveDashboard,
  livePair,
} from "@/lib/dev/live-dashboard"
import { dataDir } from "@/lib/sessions/paths"

// A Vibeground: a worktree's own stack started from the Preview pane on a copy of the live database, seeded by one pg_dump read of it, the copy's only touch of the live one; Stop ends the stack and removes the copy, keeping the worktree. Every command is a fixed argv built here from a listed worktree's path, never from a request's words.

const LOG = ".turbo/vibe-dev.log"
const SAVED_ENV = ".env.vibe-saved"
// the stack's own data folder, a clone of the live one, so its settings and store edits stay in the copy
const DATA = ".turbo/vibe-data"
// the live data folder's parts a Vibeground never reads: the transcript archive, the ops binaries, database dumps and debug logs
const DATA_LEFT = new Set(["archive", "bin", "debug", "dumps"])
const MIGRATIONS = "packages/db/drizzle"
const DUMP_TIMEOUT_MS = 5 * 60_000
const READY_TRIES = 60
// the environment a Vibeground's commands get from the API's own, so the live stack's settings (its database above all) never reach the copy, while the same user's HOME keeps its Keychain and tools
const KEPT_ENV = ["HOME", "LANG", "LOGNAME", "PATH", "SHELL", "TMPDIR", "USER"]

export class VibeError extends Error {}

export type RunResult = { code: number; stderr: string; stdout: string }
export type Run = (args: string[], env?: Record<string, string>) => Promise<RunResult>
export type Pipe = (
  from: string[],
  to: string[],
  timeoutMs: number,
) => Promise<{ bytes: number; error: string | null }>

export type Deps = {
  // clones the data folder from into the one named to, but its parts in DATA_LEFT
  copyData: (from: string, to: string) => void
  // docker's own argv, its first word dropped
  docker: Run
  // starts `bun run dev` in the worktree, in its own process group, logging to the file named, on the data folder named
  launch: (path: string, log: string, data: string) => void
  live: () => LiveDashboard
  load5: () => number
  migrate: (url: string, folder: string) => Promise<void>
  // docker's from | docker's to, the first stopped by its own handle past timeoutMs
  pipe: Pipe
  readsLive: () => boolean
  secret: () => string
  stacks: () => Promise<Stack[]>
  // `bun run dev:stop` in the worktree, on the data folder named
  stop: (path: string, data: string) => Promise<RunResult>
  wait: (ms: number) => Promise<void>
}

export type Seeded = { bytes: number; ms: number }

// Pure: the copy's container, the worktree's folder name made safe and a hash of its whole path, so two worktrees, of one folder name in two repos included, never share one.
export const copyName = (path: string): string =>
  `playground-vibe-${basename(path).replace(/[^a-zA-Z0-9_.-]/g, "-")}-${new Bun.CryptoHasher("sha256").update(path).digest("hex").slice(0, 8)}-db`

// Pure: the one command that reads the live database: pg_dump inside its container over the local socket, so no password or URL is in it; claude_* tables keep their shape and leave their rows, the transcripts.
export const dumpArgv = (live: string): string[] => [
  "exec",
  live,
  "pg_dump",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "--no-owner",
  "--no-privileges",
  "--exclude-table-data=claude_*",
]

// Pure: the copy reads the dump as one transaction, stopping at its first error.
export const restoreArgv = (copy: string): string[] => [
  "exec",
  "-i",
  copy,
  "psql",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-q",
  "-v",
  "ON_ERROR_STOP=1",
  "--single-transaction",
]

// Pure: why the machine has no room for this Vibeground, else null: none while the 5-minute load is over 30, one at a time while it is over 15.
export const loadRefusal = (load5: number, running: number): string | null => {
  if (load5 > 30)
    return `the 5-minute load is ${load5.toFixed(1)}, over 30; try again once it falls`
  if (load5 > 15 && running > 0) {
    return `the 5-minute load is ${load5.toFixed(1)}, over 15, and a Vibeground already runs; stop it first`
  }
  return null
}

// Pure: a .env's text with key set to value, replacing its line or adding one.
export const setKey = (text: string, key: string, value: string): string => {
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, "m")
  if (re.test(text)) return text.replace(re, () => line)
  return `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${line}\n`
}

// Pure: the stack's .env, the worktree's own .env.example with the copy's database, a fresh secret, and the live machine's reads, so a key the branch adds comes with it; cmux's sessions stay off, so it reads the sessions Playground started.
export const vibeEnv = (example: string, url: string, secret: string): string =>
  [
    ["BETTER_AUTH_SECRET", secret],
    ["PLAYGROUND_CMUX_SESSIONS", ""],
    ["PLAYGROUND_LIVE_READS", "true"],
    ["POSTGRES_URL", url],
  ].reduce((text, [key, value]) => setKey(text, key!, value!), example)

// This checkout's branch while it runs as a Vibeground (the launcher's record in its .turbo), else null, for the badge its own pages wear.
export const ownVibe = (
  root: string | null = checkoutRoot(),
  has: (path: string) => boolean = existsSync,
  branch: (root: string) => string | null = branchOf,
): string | null => (root && has(join(root, VIBE_RECORD)) ? branch(root) : null)

// Pure: the API's environment cut to what a Vibeground's commands need.
export const childEnv = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(KEPT_ENV.flatMap((key) => (env[key] ? [[key, env[key]!]] : [])))

// Pure: why this listed worktree cannot start, else null: a running one, a checkout's own folder (only a linked worktree takes a Vibeground's .env), the live dashboard's, or a worktree that is not Playground-shaped.
export const startRefusal = (
  stack: Stack | undefined,
  live: LiveDashboard,
  linked: (path: string) => boolean,
  has: (path: string) => boolean,
): string | null => {
  if (!stack?.path) return "no worktree on this machine is at that path"
  if (stack.url) return `${stack.branch ?? stack.name} is already running`
  if (stack.vibe) return `${stack.branch ?? stack.name} is already started; Stop it first`
  if (stack.branch === live.branch) return "that worktree is the live dashboard's own"
  if (!stack.branch) return "that worktree has no branch checked out"
  if (!linked(stack.path)) return "Start runs a linked worktree, never a checkout's own folder"
  if (!has(join(stack.path, ".env.example")) || !has(join(stack.path, MIGRATIONS))) {
    return "that worktree has no .env.example and packages/db/drizzle, so it is not a Playground stack"
  }
  return null
}

const run =
  (command: string): Run =>
  async (args, env) => {
    const child = Bun.spawn([command, ...args], {
      env: env ? { ...childEnv(process.env), ...env } : childEnv(process.env),
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { code, stderr, stdout }
  }

const pipe: Pipe = async (from, to, timeoutMs) => {
  const env = childEnv(process.env)
  const dump = Bun.spawn(["docker", ...from], {
    env,
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  })
  let bytes = 0
  const counted = dump.stdout.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        controller.enqueue(chunk)
      },
    }),
  )
  const restore = Bun.spawn(["docker", ...to], {
    env,
    stderr: "pipe",
    stdin: counted,
    stdout: "ignore",
  })
  let late = false
  const timer = setTimeout(() => {
    late = true
    dump.kill()
  }, timeoutMs)
  const [dumped, restored, dumpErr, restoreErr] = await Promise.all([
    dump.exited,
    restore.exited,
    new Response(dump.stderr).text(),
    new Response(restore.stderr).text(),
  ])
  clearTimeout(timer)
  const said = (text: string) => text.trim().split("\n").at(-1) ?? ""
  if (late) return { bytes, error: `the dump took over ${timeoutMs / 1000}s and was stopped` }
  if (dumped !== 0) return { bytes, error: `pg_dump exited ${dumped}: ${said(dumpErr)}` }
  if (restored !== 0) return { bytes, error: `psql exited ${restored}: ${said(restoreErr)}` }
  return { bytes, error: null }
}

const migrate = async (url: string, folder: string) => {
  const client = new SQL(url)
  try {
    await drizzleMigrate(drizzle({ client }), { migrationsFolder: folder })
  } finally {
    await client.close()
  }
}

// Folders, files and symlinks alone, since a socket (herdr's, in the live folder) cannot be copied and belongs to the process serving it.
const copyable = (path: string): boolean => {
  const kind = lstatSync(path)
  return kind.isDirectory() || kind.isFile() || kind.isSymbolicLink()
}

export const copyData = (from: string, to: string) => {
  mkdirSync(to, { recursive: true })
  for (const part of readdirSync(from)) {
    if (DATA_LEFT.has(part)) continue
    cpSync(join(from, part), join(to, part), {
      filter: copyable,
      recursive: true,
      verbatimSymlinks: true,
    })
  }
}

const launch = (path: string, log: string, data: string) => {
  const out = openSync(log, "a")
  const child = Bun.spawn([process.execPath, "run", "dev", "--ui", "stream"], {
    cwd: path,
    detached: true,
    env: { ...childEnv(process.env), PLAYGROUND_DATA_DIR: data },
    stderr: out,
    stdin: "ignore",
    stdout: out,
  })
  child.unref()
}

const stop = async (path: string, data: string): Promise<RunResult> => {
  const child = Bun.spawn([process.execPath, "run", "dev:stop"], {
    cwd: path,
    env: { ...childEnv(process.env), PLAYGROUND_DATA_DIR: data },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { code, stderr, stdout }
}

export const DEPS: Deps = {
  copyData,
  docker: run("docker"),
  launch,
  live: () => livePair(),
  load5: () => loadavg()[1] ?? 0,
  migrate,
  pipe,
  readsLive,
  secret: () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
  stacks: readStacks,
  stop,
  wait: Bun.sleep,
}

const linked = (path: string): boolean => {
  try {
    return statSync(join(path, ".git")).isFile()
  } catch {
    return false
  }
}

// The live database's container, running, by its name alone; none or several is a refusal, since the seed must read exactly that one.
const liveContainer = async (deps: Deps): Promise<string> => {
  const listed = await deps.docker(CONTAINER_LIST)
  if (listed.code !== 0) throw new VibeError("Docker could not list its containers; is it running?")
  const live = deps.live()
  const found = containersOf(listed.stdout).filter(
    (container) => container.state === "running" && isLiveDatabase(container.name, live),
  )
  if (found.length !== 1) {
    throw new VibeError(
      found.length
        ? `${found.length} live databases run (${found.map((c) => c.name).join(", ")}), so the seed cannot tell which to read`
        : `the live database (${live.database}) is not running, so there is nothing to copy`,
    )
  }
  return found[0]!.name
}

// Starts a listed, stopped worktree as a Vibeground: its own container, seeded by one pg_dump of the live database, migrated by the branch's own migrations, its .env from its own .env.example, and `bun run dev`; a fixture stack marks its made-up worktree running instead. A failure removes the copy and puts the worktree's .env back.
export async function startVibe(path: string, deps: Deps = DEPS): Promise<Seeded> {
  const stacks = await deps.stacks()
  if (!deps.readsLive()) {
    const stack = stacks.find((s) => s.path === path)
    if (!stack) throw new VibeError("no worktree on this machine is at that path")
    if (stack.url) throw new VibeError(`${stack.branch ?? stack.name} is already running`)
    fixtureVibe(path, true)
    return { bytes: 0, ms: 0 }
  }
  const refused =
    startRefusal(
      stacks.find((s) => s.path === path),
      deps.live(),
      linked,
      existsSync,
    ) ?? loadRefusal(deps.load5(), stacks.filter((s) => s.vibe).length)
  if (refused) throw new VibeError(refused)
  // the record claims the worktree before anything awaits, so a second Start, a re-pick's while this one seeds included, is refused above and never removes this copy
  const record = join(path, VIBE_RECORD)
  if (existsSync(record)) throw new VibeError("that worktree is already started; Stop it first")
  const copy = copyName(path)
  // this Start's own id: a Stop takes the record and a later Start writes its own, so after each await this one goes on, and cleans up, only while the record is still its own
  const id = crypto.randomUUID()
  writeRecord(path, { container: copy, env: false, id, started: new Date().toISOString() })
  const owns = () => readVibe(path)?.id === id
  const still = () => {
    if (!owns()) throw new VibeError("it was stopped while it started")
  }
  const password = deps.secret()
  const envFile = join(path, ".env")
  const saved = join(path, SAVED_ENV)
  const started = Date.now()
  let wrote = false
  try {
    const live = await liveContainer(deps)
    still()
    await deps.docker(["rm", "-fv", copy])
    still()
    const ran = await deps.docker(
      [
        "run",
        "-d",
        "--name",
        copy,
        "-e",
        "POSTGRES_PASSWORD",
        "-p",
        "127.0.0.1::5432",
        "postgres:alpine",
      ],
      { POSTGRES_PASSWORD: password },
    )
    if (ran.code !== 0) throw new VibeError(`docker run: ${ran.stderr.trim().split("\n").at(-1)}`)
    let ready = false
    for (let tries = 0; tries < READY_TRIES && !ready; tries++) {
      if (tries > 0) await deps.wait(1_000)
      still()
      ready =
        (await deps.docker(["exec", copy, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]))
          .code === 0
    }
    if (!ready) throw new VibeError(`Postgres in ${copy} did not start in ${READY_TRIES} seconds`)
    const port = (await deps.docker(["port", copy, "5432"])).stdout.match(/127\.0\.0\.1:(\d+)/)?.[1]
    if (!port) throw new VibeError(`${copy} published no loopback port`)
    still()
    const seeded = await deps.pipe(dumpArgv(live), restoreArgv(copy), DUMP_TIMEOUT_MS)
    if (seeded.error) throw new VibeError(`the copy could not be seeded: ${seeded.error}`)
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`
    still()
    await deps.migrate(url, join(path, MIGRATIONS))
    still()
    deps.copyData(dataDir(), join(path, DATA))
    if (existsSync(envFile) && !existsSync(saved)) renameSync(envFile, saved)
    wrote = true
    writeFileSync(
      envFile,
      vibeEnv(readFileSync(join(path, ".env.example"), "utf8"), url, deps.secret()),
      { mode: 0o600 },
    )
    writeRecord(path, { container: copy, env: true, id, started: new Date().toISOString() })
    deps.launch(path, join(path, LOG), join(path, DATA))
    return { bytes: seeded.bytes, ms: Date.now() - started }
  } catch (error) {
    // a Stop already took this Start's copy and record, and a later Start's are its own
    if (owns()) {
      await deps.docker(["rm", "-fv", copy])
      rmSync(record, { force: true })
      rmSync(join(path, DATA), { force: true, recursive: true })
      if (wrote) restoreEnv(path)
    }
    throw error instanceof VibeError ? error : new VibeError(String(error))
  }
}

// The record: the copy's container, whether Start has put its .env in place yet, so a Stop while it seeds leaves the worktree's own .env alone, the id of the Start or Stop that wrote it, and whether a Stop holds it, so a second Stop is refused rather than putting the .env back twice.
type VibeRecord = {
  container: string
  env: boolean
  id: string
  started: string
  stopping?: boolean
}
const STOP_STALE_MS = 10 * 60_000
const writeRecord = (path: string, record: VibeRecord) =>
  writeFileSync(join(path, VIBE_RECORD), `${JSON.stringify(record)}\n`)

// The worktree's own .env back as it was before Start, or none when it had none.
const restoreEnv = (path: string) => {
  const saved = join(path, SAVED_ENV)
  if (existsSync(saved)) renameSync(saved, join(path, ".env"))
  else rmSync(join(path, ".env"), { force: true })
}

const readVibe = (
  path: string,
): { container: string; env: boolean; id: unknown; started: unknown; stopping: boolean } | null => {
  try {
    const record = JSON.parse(readFileSync(join(path, VIBE_RECORD), "utf8")) as {
      container?: unknown
      env?: unknown
      id?: unknown
      started?: unknown
      stopping?: unknown
    }
    return typeof record.container === "string"
      ? {
          container: record.container,
          env: record.env !== false,
          id: record.id,
          started: record.started,
          stopping: record.stopping === true,
        }
      : null
  } catch {
    return null
  }
}

// Stops a Vibeground: `bun run dev:stop` through the stack's own record, then the copy removed with docker rm -fv and the worktree's .env put back; the worktree stays. A fixture stack marks its made-up worktree stopped.
export async function stopVibe(path: string, deps: Deps = DEPS): Promise<void> {
  const stack = (await deps.stacks()).find((s) => s.path === path)
  if (!stack?.vibe || !stack.path) throw new VibeError("no Vibeground runs at that path")
  if (!deps.readsLive()) return fixtureVibe(path, false)
  const record = readVibe(stack.path)
  if (!record) throw new VibeError(`${VIBE_RECORD} in that worktree does not name its copy`)
  // a second Stop, from another tab, would put the .env back a second time and remove the worktree's own; a mark older than STOP_STALE_MS is a Stop the API never finished
  if (record.stopping && Date.now() - Date.parse(String(record.started)) < STOP_STALE_MS) {
    throw new VibeError(
      "that Vibeground is already stopping; a Stop stuck 10 minutes can run again",
    )
  }
  // Stop claims the record before its first await, so a Start still seeding fails its next check and leaves the cleanup to this Stop; a Start past its last check has already written env: true, read above
  const claim = {
    container: record.container,
    env: record.env,
    id: crypto.randomUUID(),
    started: new Date().toISOString(),
  }
  writeRecord(stack.path, { ...claim, stopping: true })
  try {
    const stopped = await deps.stop(stack.path, join(stack.path, DATA))
    const said = `${stopped.stdout}\n${stopped.stderr}`
    if (stopped.code !== 0 && !/no stack is recorded/.test(said)) {
      throw new VibeError(
        `dev:stop refused: ${
          said
            .trim()
            .split("\n")
            .find((l) => l.startsWith("dev:stop")) ?? `exit ${stopped.code}`
        }`,
      )
    }
    const removed = await deps.docker(["rm", "-fv", record.container])
    if (removed.code !== 0) {
      throw new VibeError(`docker rm -fv ${record.container}: ${removed.stderr.trim()}`)
    }
    // a Stop that took the stale mark over has put the .env back already, and a second restore would remove the worktree's own
    if (readVibe(stack.path)?.id !== claim.id) return
    if (record.env) {
      restoreEnv(stack.path)
      claim.env = false
      writeRecord(stack.path, { ...claim, stopping: true })
    }
    rmSync(join(stack.path, DATA), { force: true, recursive: true })
    rmSync(join(stack.path, VIBE_RECORD), { force: true })
  } catch (error) {
    // a Stop that failed lets the next one try
    if (readVibe(stack.path)?.id === claim.id) writeRecord(stack.path, claim)
    throw error
  }
}
