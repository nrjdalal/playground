import "@packages/env/aliases"
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path"

import { threadIdSchema } from "@packages/config/threads"
import { deriveRoot } from "@packages/settings"
import { z } from "zod"

// Relative, not @/: paths.ts imports this file, and the web's tests type-check it under web/next's own @/ paths.
import shipped from "../../fixtures/dashboard.json" with { type: "json" }
import { livePair } from "../dev/live-dashboard"
import { FIX_IDS } from "../onboard/fix-ids"

// Where the dashboard's data comes from, chosen by who runs the stack (ADR 0008): a person's own clone reads their own machine (cmux's sessions, Claude Code's config folder, git, GitHub and the System panel's probes), and a factory, test or PLAYGROUND_FIXTURE stack reads a fixture, a made-up machine written into a scratch folder of its own, so real rows never reach a screenshot or a PR. A refused source reads nothing at all.
export type DashboardSource =
  | { file: string | null; kind: "fixture"; rule: "factory" | "fixture" | "test" }
  | { kind: "hosted" }
  | { kind: "live"; rule: "live-branch" | "live-reads" | "own" }
  | { kind: "refused"; reason: string }

export type DashboardRule = Exclude<DashboardSource, { kind: "hosted" | "refused" }>["rule"]

// Each rule in words, as the launcher prints the one a stack matched.
export const DASHBOARD_RULES: Record<DashboardRule, string> = {
  factory: "a factory stack (a checkout under .claude/worktrees/, or PLAYGROUND_ROLE set)",
  fixture: "PLAYGROUND_FIXTURE is set",
  "live-branch": "the live checkout (the branch live.branch names)",
  "live-reads": "PLAYGROUND_LIVE_READS is set",
  own: "your own clone, outside the factory",
  test: "a test run (NODE_ENV=test)",
}

// PLAYGROUND_FIXTURE=shipped names the fixture that ships in api/hono/src/fixtures/dashboard.json.
export const SHIPPED_FIXTURE = "shipped"

const yes = (value: string | undefined): boolean => /^(1|true)$/i.test(value?.trim() ?? "")

const set = (value: string | undefined): boolean => Boolean(value?.trim())

// A worker's checkout: any folder directly under a .claude/worktrees folder, or inside one.
export const inFactoryCheckout = (root: string): boolean =>
  /(^|[\\/])\.claude[\\/]worktrees[\\/][^\\/]+/.test(root)

// Pure: the source a stack on this branch, in this checkout, with this environment, reads; the first rule that matches wins. 0 the hosted build (PLAYGROUND_HOSTED) reads no machine, whatever else is set; 1 the live dashboard's branch and 2 PLAYGROUND_LIVE_READS read live (a fixture beside either is refused); 3 a test run, 4 PLAYGROUND_FIXTURE (relative to the checkout's root, or absolute) and 5 a factory stack, a checkout under .claude/worktrees/ or PLAYGROUND_ROLE set read a fixture; 6 anything else is a person's own clone and reads their own machine, unless it runs under Claude Code with no role, which is an agent's stack and is refused. A CLAUDE_CONFIG_DIR alone never decides. A test run's PLAYGROUND_FIXTURE counts for nothing: the suite reads the shipped fixture, or the live paths its liveReads opts into, never the worktree's dev fixture left in .env.
export function dashboardSource({
  branch,
  env,
  live = livePair(env).branch,
  root,
}: {
  branch: string | null
  env: Record<string, string | undefined>
  live?: string
  root: string
}): DashboardSource {
  if (yes(env.PLAYGROUND_HOSTED)) return { kind: "hosted" }
  let fixture = env.PLAYGROUND_FIXTURE?.trim() || null
  if (env.NODE_ENV?.trim() === "test") fixture = null
  if (branch === live) {
    return fixture
      ? {
          kind: "refused",
          reason: `this checkout is on ${live}, which always reads the live machine; unset PLAYGROUND_FIXTURE`,
        }
      : { kind: "live", rule: "live-branch" }
  }
  if (yes(env.PLAYGROUND_LIVE_READS)) {
    return fixture
      ? {
          kind: "refused",
          reason:
            "PLAYGROUND_LIVE_READS reads the live machine and PLAYGROUND_FIXTURE a made-up one; set one of them",
        }
      : { kind: "live", rule: "live-reads" }
  }
  if (env.NODE_ENV?.trim() === "test") return { file: null, kind: "fixture", rule: "test" }
  if (fixture) {
    return {
      file: fixture === SHIPPED_FIXTURE ? null : resolve(root, fixture),
      kind: "fixture",
      rule: "fixture",
    }
  }
  if (inFactoryCheckout(root) || set(env.PLAYGROUND_ROLE)) {
    return { file: null, kind: "fixture", rule: "factory" }
  }
  if (set(env.CLAUDECODE)) {
    return {
      kind: "refused",
      reason: `this stack would read your own machine, but it runs under Claude Code with no PLAYGROUND_ROLE, so an agent started it; start it from your own terminal, or set PLAYGROUND_FIXTURE=${SHIPPED_FIXTURE} for test data`,
    }
  }
  return { kind: "live", rule: "own" }
}

// The checkout this file sits in: the nearest folder holding .git, walking up, so source and bundle alike find their own and a worktree never falls through to the main checkout around it. null in a Docker image, which carries none.
export function checkoutRoot(from: string = import.meta.dir): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir
    if (dirname(dir) === dir) return null
  }
}

// The branch a checkout is on, read once for currentSource: null on a detached HEAD or where git cannot say, undefined when the read gave up on its timeout, so a wedged git is not pinned into the cache.
const branchRead = (root: string | null): string | null | undefined => {
  if (!root) return null
  const read = Bun.spawnSync(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: root,
    stderr: "ignore",
    stdin: "ignore",
    // a wedged git must not hold a test or a request that reaches readsLive()
    timeout: 5_000,
  })
  if (read.exitCode === null) return undefined
  return read.exitCode === 0 ? read.stdout.toString().trim() || null : null
}

// The branch a checkout is on, null on a detached HEAD or where git cannot say.
export function branchOf(root: string | null): string | null {
  return branchRead(root) ?? null
}

let checkout: { branch: string | null; root: string } | null = null

// This process's source, from its own branch (read once; a read that gave up on its timeout answers as no branch but stays uncached, so the next call asks git again) and its environment as it is now (the API's entry loads .env before any dashboard code runs, and a test sets PLAYGROUND_LIVE_READS for the live paths it drives).
export const currentSource = (): DashboardSource => {
  if (yes(process.env.PLAYGROUND_HOSTED)) return { kind: "hosted" }
  if (!checkout) {
    const root = checkoutRoot()
    const branch = branchRead(root)
    if (branch === undefined)
      return dashboardSource({ branch: null, env: process.env, root: root ?? process.cwd() })
    checkout = { branch, root: root ?? process.cwd() }
  }
  return dashboardSource({ ...checkout, env: process.env })
}

export const readsLive = (): boolean => currentSource().kind === "live"

// The scratch folder a fixture is written into: inside the checkout's own .turbo (ignored by git and Docker, beside the launcher's record), else the system's temp folder. PLAYGROUND_FIXTURE_DIR lets a test keep it elsewhere, as DEV_RECORD does the record, relative to the checkout's root as PLAYGROUND_FIXTURE is, so the launcher and the API, which run from different folders, name the same one.
export const fixtureDir = (env: Record<string, string | undefined> = process.env): string => {
  const root = checkoutRoot()
  if (env.PLAYGROUND_FIXTURE_DIR) return resolve(root ?? process.cwd(), env.PLAYGROUND_FIXTURE_DIR)
  return root
    ? join(root, ".turbo", "dashboard-fixture")
    : join(tmpdir(), `playground-dashboard-fixture-${process.getuid?.() ?? 0}`)
}

// The fixture's Claude Code config folder, which stands in for ~/.claude on a fixture stack.
export const fixtureConfigDir = (dir = fixtureDir()): string => join(dir, "claude")

// The Claude Code config folder this process reads: the live one only on a live source, the fixture's on a fixture source (written first when missing), and the fixture's unwritten one on a hosted or refused source, so neither reads anything real. The live one is where spawn.sh's sessions register: under inscope (INSCOPE_CCD) spawn.sh starts them from ~/.claude, as the CLI's probe.ts reads them, so the board never reads inscope's own folder and misses a dispatcher the CLI sees.
export function configDir(): string {
  const source = currentSource()
  if (source.kind === "live")
    return (!process.env.INSCOPE_CCD && process.env.CLAUDE_CONFIG_DIR) || join(homedir(), ".claude")
  return fixtureConfigDir(source.kind === "fixture" ? ensureFixture(source) : fixtureDir())
}

const json = z.record(z.string(), z.unknown())

// A path under the config folder: relative, and never climbing out of it.
const relativePath = z
  .string()
  .refine(
    (path) => !isAbsolute(path) && !normalize(path).split(sep).includes(".."),
    "a path inside the config folder",
  )

// A session's transcript, which a message typed into the session is appended to: `$CONFIG/` and a path inside the config folder.
const transcriptPath = z
  .string()
  .refine(
    (path) =>
      path.startsWith("$CONFIG/") && relativePath.safeParse(path.slice("$CONFIG/".length)).success,
    "a path in the config folder, starting $CONFIG/",
  )

// A made-up thread (lib/dashboard/threads.ts): each message is the uuid of one of the session's transcript lines, in the thread's order.
const fixtureThread = z.object({
  archivedAt: z.iso.datetime({ offset: true }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  id: threadIdSchema,
  lastReadAt: z.iso.datetime({ offset: true }).optional(),
  messages: z.array(z.string().min(1)),
  pinnedAt: z.iso.datetime({ offset: true }).optional(),
  session: z.string().min(1),
  title: z.string().min(1),
  updatedAt: z.iso.datetime({ offset: true }),
})

// One row of onboarding's list (lib/onboard/checks.ts), as the API answers it.
const doctorCheck = z.object({
  action: z.object({ id: z.enum([...FIX_IDS, "settings"]), label: z.string().min(1) }).nullable(),
  detail: z.string(),
  name: z.string().min(1),
  need: z.string().nullable(),
  note: z.string().nullable(),
  status: z.enum(["MISSING", "ok", "optional", "waiting"]),
})

export const fixtureSchema = z.object({
  // The made-up Claude account of Claude Code's config, which the user menu shows when usage.json names no login (lib/dashboard/account.ts).
  account: z.object({ email: z.email(), name: z.string().nullable() }).optional(),
  // Every ISO time in the file, and every epoch-seconds `resets_at`, moves by the time between this and the moment the fixture is written, so ages, ETAs and usage stay as current as they read here.
  anchor: z.iso.datetime({ offset: true }),
  cmux: z.object({
    // Each Feed item names its session by `session`, which becomes the workstream id cmux gives it.
    feed: z.array(z.looseObject({ request_id: z.string().min(1), session: z.string().min(1) })),
    // What each surface's screen shows above its input box; the box itself is drawn from what has been typed.
    screens: z.record(z.string(), z.string()),
    sessions: z.array(
      z.looseObject({
        // a session the dashboard pastes into, as herdr's agent.prompt does, so its Enter writes what Claude Code writes for a paste
        pastes: z.boolean().optional(),
        session_id: z.string().min(1),
        transcript_path: transcriptPath.optional(),
      }),
    ),
    workspaces: z.array(json),
  }),
  // Onboarding's tool rows on the made-up machine, the database's left to the API: every one ok, and the missing set a stack answers while PLAYGROUND_ONBOARD_MISSING is set.
  doctor: z.object({ checks: z.array(doctorCheck), missing: z.array(doctorCheck) }).optional(),
  // Each file under the config folder by its path: a .jsonl as an array of lines, a { "$base64": … } as bytes, anything else as JSON. `$CONFIG` in any string is that folder.
  files: z.record(relativePath, z.unknown()),
  git: z.record(
    z.string(),
    z.object({ branch: z.string().nullable(), repo: z.string().nullable() }),
  ),
  // Each repo's merged PullRequest nodes, as the Usage app's query reads them (lib/usage/prs.ts).
  merged: z.record(z.string(), z.array(json)).optional(),
  // The made-up checkout's origin remote, which the sidebar's GitHub icon links to as its pull requests page.
  origin: z.string().optional(),
  // The processes the made-up machine runs, by pid: what `ps` would say of each.
  processes: z.record(z.string(), z.object({ command: z.string(), start: z.string() })),
  // A GitHub PullRequest node by lookup (a PR URL, or owner/name#branch), as the dashboard's query reads it.
  pulls: z.record(z.string(), json),
  system: z.object({
    cores: z.number().int().positive(),
    disk: z.object({ freeBytes: z.number(), totalBytes: z.number() }),
    load: z.tuple([z.number(), z.number(), z.number()]),
    // Each System panel probe's stdout, by its name in probe.ts's COMMANDS.
    probes: z.record(z.string(), z.string()),
    totalBytes: z.number(),
  }),
  // The owner's made-up threads, which bun run ingest writes into a fixture stack's database once it has read the transcripts their messages are in.
  threads: z.array(fixtureThread).optional(),
  // How far the made-up dashboard's build is behind the branch it follows, as the update check reports it (lib/dashboard/update.ts), so a fixture stack shows the update icon and Update now without running git.
  update: z
    .object({
      behind: z.number().int().nonnegative(),
      branch: z.string(),
      live: z.boolean().default(false),
      newest: z.object({ at: z.iso.datetime({ offset: true }), title: z.string() }),
      pulled: z.boolean(),
      upstream: z.enum(["canary", "main"]),
    })
    .optional(),
  // The owner's made-up open pull requests in the work org, as the work queue's search answers them (lib/dashboard/work-queue.ts); a stack shows them once WORK_GITHUB_ORG is set.
  work: z.array(json).optional(),
})

export type Fixture = z.infer<typeof fixtureSchema>

// The fixture a file holds, the shipped one when none is named, or why it cannot be read.
export function loadFixture(
  file: string | null,
): { fixture: Fixture; ok: true } | { error: string; ok: false } {
  let raw: unknown = shipped
  if (file) {
    try {
      raw = JSON.parse(readFileSync(file, "utf8"))
    } catch (error) {
      return { error: `${file} does not read as JSON: ${messageOf(error)}`, ok: false }
    }
  }
  const parsed = fixtureSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      error: `${file ?? "the shipped fixture"} is not a fixture: ${issue?.path.join(".") || "its root"}: ${issue?.message}`,
      ok: false,
    }
  }
  return { fixture: parsed.data, ok: true }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

// A moment in prose, as linear-scan's heading writes one: `Thu 1 Jan, 11:30 am UTC`.
export const proseTime = (at: Date): string => {
  const part = (options: Intl.DateTimeFormatOptions) =>
    at.toLocaleString("en-GB", { ...options, timeZone: "UTC" })
  const hours = at.getUTCHours()
  const minutes = String(at.getUTCMinutes()).padStart(2, "0")
  return `${part({ weekday: "short" })} ${at.getUTCDate()} ${part({ month: "short" })}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? "am" : "pm"} UTC`
}

// Pure: a value with every ISO time and epoch `resets_at` moved by shiftMs, every `$WHEN{<ISO time>}` in prose made that moment moved and written as proseTime writes it, and `$CONFIG` made the config folder.
export function settle(value: unknown, shiftMs: number, config: string, key = ""): unknown {
  if (typeof value === "string") {
    if (ISO_TIME.test(value)) return new Date(Date.parse(value) + shiftMs).toISOString()
    return value
      .replace(/\$WHEN\{([^}]+)\}/g, (_, at: string) =>
        proseTime(new Date(Date.parse(at) + shiftMs)),
      )
      .replaceAll("$CONFIG", config)
  }
  if (typeof value === "number") {
    return key === "resets_at" ? Math.round(value + shiftMs / 1000) : value
  }
  if (Array.isArray(value)) return value.map((item) => settle(item, shiftMs, config))
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, settle(v, shiftMs, config, k)]),
    )
  }
  return value
}

// cmux names a Feed item's session by a workstream id that ends in the session's id, base64-encoded.
export const workstreamOf = (session: string): string =>
  `cmux-feed-v1:${Buffer.from("claude").toString("base64")}:${Buffer.from(session).toString("base64")}`

const STAMP = "stamp.json"

const writeEntry = (path: string, content: unknown): void => {
  mkdirSync(dirname(path), { mode: 0o700, recursive: true })
  if (path.endsWith(".jsonl") && Array.isArray(content)) {
    writeFileSync(path, content.map((line) => `${JSON.stringify(line)}\n`).join(""), {
      mode: 0o600,
    })
  } else if (
    typeof content === "object" &&
    content !== null &&
    typeof (content as { $base64?: unknown }).$base64 === "string"
  ) {
    writeFileSync(path, Buffer.from((content as { $base64: string }).$base64, "base64"), {
      mode: 0o600,
    })
  } else {
    writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2), {
      mode: 0o600,
    })
  }
}

// Writes a fixture into dir, fresh, as of now: the config folder, cmux's state (cmux.json) and the rest of the machine (machine.json). The folder is replaced whole and only when it is a fixture's own (its stamp.json), so a misnamed folder (a real config folder) is refused rather than overwritten.
export function writeFixture(fixture: Fixture, dir: string, now = new Date()): void {
  const target = resolve(dir)
  if (existsSync(target) && !existsSync(join(target, STAMP))) {
    throw new Error(`${target} exists and is not a fixture's folder, so it is left alone`)
  }
  const fresh = `${target}.writing-${process.pid}`
  rmSync(fresh, { force: true, recursive: true })
  mkdirSync(fresh, { mode: 0o700, recursive: true })
  const config = join(target, "claude")
  const shift = now.getTime() - Date.parse(fixture.anchor)
  const at = <T>(value: T): T => settle(value, shift, config) as T
  for (const [path, content] of Object.entries(fixture.files)) {
    writeEntry(join(fresh, "claude", path), at(content))
  }
  // A settings scope counts only once it is a repository (scopesIn), so each one the fixture seeds is made one, as its first write would, its settings.json left for that write to commit.
  const extensions = join(fresh, "claude", "playground", "extensions")
  for (const entry of existsSync(extensions)
    ? readdirSync(extensions, { withFileTypes: true })
    : []) {
    if (!entry.isDirectory()) continue
    const init = Bun.spawnSync(["git", "init", "-q", "-b", "main"], {
      cwd: join(extensions, entry.name),
      stderr: "pipe",
      stdin: "ignore",
    })
    if (init.exitCode !== 0)
      throw new Error(`git init in the fixture's ${entry.name}: ${init.stderr}`)
  }
  // policy.json and the guards' lists, derived from the scopes as a first write would, so Why reads them.
  const login = join(extensions, "login")
  if (existsSync(login)) deriveRoot(dirname(extensions), readFileSync(login, "utf8").trim())
  for (const folder of ["playground/attachments"]) {
    mkdirSync(join(fresh, "claude", folder), { mode: 0o700, recursive: true })
    chmodSync(join(fresh, "claude", folder), 0o700)
  }
  const cmux = at(fixture.cmux)
  writeEntry(join(fresh, "cmux.json"), {
    feed: cmux.feed.map(({ session, ...item }) => ({
      status: "pending",
      ...item,
      workstream_id: workstreamOf(session),
    })),
    inputs: {},
    screens: cmux.screens,
    sessions: cmux.sessions,
    workspaces: cmux.workspaces,
  })
  writeEntry(join(fresh, "machine.json"), {
    account: fixture.account ?? null,
    doctor: fixture.doctor ?? null,
    git: at(fixture.git),
    merged: at(fixture.merged ?? {}),
    origin: fixture.origin ?? null,
    processes: at(fixture.processes),
    pulls: at(fixture.pulls),
    system: fixture.system,
    threads: at(fixture.threads ?? []),
    update: at(fixture.update ?? null),
    work: at(fixture.work ?? []),
  })
  writeEntry(join(fresh, STAMP), { writtenAt: now.toISOString() })
  const old = `${target}.old-${process.pid}`
  if (existsSync(target)) renameSync(target, old)
  renameSync(fresh, target)
  rmSync(old, { force: true, recursive: true })
}

// Removes a fixture's folder when it is one (a stack's scratch state goes with the stack).
export function dropFixture(dir: string): void {
  const target = resolve(dir)
  if (existsSync(join(target, STAMP))) rmSync(target, { force: true, recursive: true })
}

// The folder this process reads its fixture from, written from its source's file when it is not there yet (the API started without the launcher, or a CLI before any stack). Throws on a hosted, live or refused source.
export function ensureFixture(source: DashboardSource = currentSource()): string {
  if (source.kind !== "fixture") {
    throw new Error(
      source.kind === "refused"
        ? source.reason
        : source.kind === "hosted"
          ? "the hosted build reads no machine, not even a fixture"
          : "this stack reads the live machine, not a fixture",
    )
  }
  const dir = fixtureDir()
  if (existsSync(join(dir, STAMP))) return dir
  // The launcher wrote this stack's fixture and drops it as the stack stops, so a process that outlives the stop (the API until its group is killed) finds it gone and writes nothing back.
  if (yes(process.env.PLAYGROUND_FIXTURE_LAUNCHED)) {
    throw new Error(
      `the stack's fixture at ${dir} went when it stopped; start it again with bun run dev`,
    )
  }
  const loaded = loadFixture(source.file)
  if (!loaded.ok) throw new Error(loaded.error)
  writeFixture(loaded.fixture, dir)
  return dir
}

export type FixtureCmux = {
  feed: Record<string, unknown>[]
  // What has been typed into each surface's input and not yet sent.
  inputs: Record<string, string>
  screens: Record<string, string>
  sessions: Record<string, unknown>[]
  workspaces: Record<string, unknown>[]
}

export type FixtureMachine = {
  account?: Fixture["account"] | null
  doctor?: Fixture["doctor"] | null
  git: Fixture["git"]
  merged?: NonNullable<Fixture["merged"]>
  origin?: string | null
  processes: Fixture["processes"]
  pulls: Fixture["pulls"]
  system: Fixture["system"]
  threads?: NonNullable<Fixture["threads"]>
  update?: Fixture["update"] | null
  work?: NonNullable<Fixture["work"]>
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T

export const readFixtureCmux = (dir = ensureFixture()): FixtureCmux =>
  readJson<FixtureCmux>(join(dir, "cmux.json"))

const writeFixtureCmux = (state: FixtureCmux, dir: string): void => {
  const path = join(dir, "cmux.json")
  writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
}

let machine: { at: number; path: string; value: FixtureMachine } | null = null

export const readFixtureMachine = (dir = ensureFixture()): FixtureMachine => {
  const path = join(dir, "machine.json")
  const at = statSync(path).mtimeMs
  if (machine?.path !== path || machine.at !== at) {
    machine = { at, path, value: readJson<FixtureMachine>(path) }
  }
  return machine.value
}

// Told whenever a write changes the fixture's cmux state, so the dashboard's hub refreshes as cmux's events would make it.
const listeners = new Set<() => void>()

export const onFixtureChange = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const changed = () => {
  for (const listener of listeners) listener()
}

const str = (value: unknown): string => (typeof value === "string" ? value : "")

// An input box as Claude Code draws it, between two rules: empty, or holding what has been typed.
export const screenOf = (state: FixtureCmux, surface: string): string => {
  const typed = state.inputs[surface] ?? ""
  const rule = "─".repeat(60)
  const box = typed ? typed.split("\n").map((line, i) => `${i ? "  " : "❯ "}${line}`) : ["❯"]
  return [state.screens[surface] ?? "", rule, ...box, rule, "  ? for shortcuts"].join("\n")
}

const sessionOnSurface = (state: FixtureCmux, surface: string) =>
  state.sessions.find((s) => str(s.surface_id) === surface && s.stored_pid_exists === true)

// What cmux's reads answer on a fixture stack, from the fixture's own state: sessions, workspaces, the Feed, and a session's screen. Any other read is one the fixture does not hold.
export function fixtureRead(args: readonly string[], dir = ensureFixture()): string {
  const state = readFixtureCmux(dir)
  const [command, sub] = args
  if (command === "sessions" && sub === "list") return JSON.stringify({ sessions: state.sessions })
  if (command === "list-workspaces") return JSON.stringify({ workspaces: state.workspaces })
  if (command === "rpc" && sub === "feed.list") {
    return JSON.stringify({ items: state.feed.filter((item) => item.status === "pending") })
  }
  if (command === "read-screen") {
    const surface = args[args.indexOf("--surface") + 1] ?? ""
    if (!sessionOnSurface(state, surface)) throw new Error(`no session on surface ${surface}`)
    return screenOf(state, surface)
  }
  throw new Error(`the fixture holds no answer to ${command ?? "nothing"}`)
}

export type FixtureWrite =
  | { key: string; surface: string }
  | { force?: boolean; surface: string; text: string }

const IMAGE_PATH = /\.(gif|jpe?g|png|webp)$/i

// The lines Claude Code writes for a paste (measured on 2.1.304): it splits the paste at a space before a path and at each line end, drops empty lines, and takes each image path it can read in as an image, its [Image #n] marks put first, a space between them as 2.1.309 writes them; a meta line of the same prompt then names each image's source. A paste with no image it could read is kept whole, wrapped in pasted_content tags when long.
const pastedLines = (typed: string, line: Record<string, unknown>): Record<string, unknown>[] => {
  const parts = typed
    .split(/ (?=\/|[A-Za-z]:\\)/)
    .flatMap((part) => part.split("\n"))
    .filter((part) => part.trim())
  const images: string[] = []
  const words: string[] = []
  for (const part of parts) {
    if (IMAGE_PATH.test(part.trim()) && existsSync(part.trim())) images.push(part.trim())
    else words.push(part)
  }
  // shortcut: 200 chars sits between the longest plain paste (151) and the shortest wrapped one (211) measured in real transcripts; upgrade when Claude Code's own rule is known
  if (!images.length && typed.length > 200) {
    const id = crypto.randomUUID().slice(0, 4)
    const content = `\n\n<pasted_content id="${id}">\n${typed}\n</pasted_content id="${id}">\n`
    return [{ ...line, message: { content, role: "user" } }]
  }
  if (!images.length) return [line]
  const promptId = crypto.randomUUID()
  const blocks = images.map((path) => ({
    source: {
      data: readFileSync(path).toString("base64"),
      media_type: `image/${IMAGE_PATH.exec(path)?.[1]?.toLowerCase().replace("jpg", "jpeg")}`,
      type: "base64",
    },
    type: "image",
  }))
  const marks = images.map((_, i) => `[Image #${i + 1}]`).join(" ")
  return [
    {
      ...line,
      imagePasteIds: images.map((_, i) => i + 1),
      message: {
        content: [{ text: marks + words.join("\n"), type: "text" }, ...blocks],
        role: "user",
      },
      promptId,
    },
    ...images.map((path) => ({
      ...line,
      isMeta: true,
      message: { content: [{ text: `[Image: source: ${path}]`, type: "text" }], role: "user" },
      origin: undefined,
      promptId,
      uuid: crypto.randomUUID(),
    })),
  ]
}

// A keystroke typed into a fixture session's terminal: text and Shift+Enter fill its input, and Enter sends it, as a line its transcript records, so the page sees it delivered as it would a live session's. Text sent into an input that holds some is refused unless forced, as cmux 0.65's draft guard refuses it.
export function fixtureWrite(step: FixtureWrite, dir = ensureFixture(), now = new Date()): void {
  const state = readFixtureCmux(dir)
  const session = sessionOnSurface(state, step.surface)
  if (!session) throw new Error(`no session on surface ${step.surface}`)
  const typed = state.inputs[step.surface] ?? ""
  if ("text" in step) {
    if (typed && !step.force) {
      throw new Error("send: the agent prompt holds text someone is typing, so nothing was sent")
    }
    state.inputs[step.surface] = typed + step.text
  } else if (step.key === "shift+enter") state.inputs[step.surface] = `${typed}\n`
  else if (step.key === "enter") {
    delete state.inputs[step.surface]
    const path = str(session.transcript_path)
    if (path) {
      if (!resolve(path).startsWith(`${resolve(fixtureConfigDir(dir))}${sep}`)) {
        throw new Error(`${path} is outside the fixture's folder`)
      }
      const line = {
        cwd: str(session.cwd),
        message: { content: typed, role: "user" },
        origin: { kind: "human" },
        sessionId: str(session.session_id),
        timestamp: now.toISOString(),
        type: "user",
        uuid: crypto.randomUUID(),
      }
      const lines = session.pastes === true ? pastedLines(typed, line) : [line]
      appendFileSync(path, lines.map((l) => `${JSON.stringify(l)}\n`).join(""))
    }
    session.agent_lifecycle = "running"
  } else throw new Error(`the fixture types no ${step.key}`)
  writeFixtureCmux(state, dir)
  changed()
}

// The name a fixture session was started with, `claude -n <name>`, as workers.ts reads a live one's.
const startedAs = (args: unknown): string => {
  const argv = Array.isArray(args) ? args.map(str) : []
  const at = argv.findIndex((arg) => arg === "-n" || arg === "--name")
  return at === -1 ? "" : (argv[at + 1] ?? "")
}

// A process start as ps's lstart prints it ("Thu Oct  1 08:00:00 2026"), the form Claude's registry keeps beside it.
const lstart = (at: Date): string => {
  const [day, month, date = "", year] = at.toDateString().split(" ")
  return `${day} ${month} ${date.padStart(2, " ")} ${at.toTimeString().slice(0, 8)} ${year}`
}

// A made-up session started as name, as a spawn leaves one: its cmux workspace and record, Claude's registry file at a new pid, and that pid's row in ps, so the live proof holds.
const madeUp = (state: FixtureCmux, name: string, dir: string, now: Date): void => {
  const like = state.sessions[0] ?? {}
  const cwd = str(like.cwd) || "/fixture/playground"
  const claude = (Array.isArray(like.launch_arguments) && str(like.launch_arguments[0])) || "claude"
  const machine = readFixtureMachine(dir)
  const pid = Math.max(900000, ...Object.keys(machine.processes).map(Number)) + 1
  const sessionId = crypto.randomUUID()
  const workspace = crypto.randomUUID().toUpperCase()
  const start = lstart(now)
  const config = fixtureConfigDir(dir)
  const transcript = join(
    config,
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-"),
    `${sessionId}.jsonl`,
  )
  state.workspaces.push({
    custom_title: name,
    id: workspace,
    ref: `workspace:${state.workspaces.length + 1}`,
    title: name,
  })
  state.sessions.push({
    agent: "claude",
    agent_lifecycle: "idle",
    cwd,
    launch_arguments: [claude, "-n", name],
    launch_backed: true,
    pastes: true,
    pid,
    session_id: sessionId,
    started_at: now.toISOString(),
    stored_pid_exists: true,
    surface_id: crypto.randomUUID().toUpperCase(),
    transcript_path: transcript,
    updated_at: now.toISOString(),
    workspace_id: workspace,
  })
  writeEntry(transcript, "")
  writeEntry(join(config, "sessions", `${pid}.json`), {
    cwd,
    kind: "interactive",
    name,
    pid,
    procStart: start,
    sessionId,
    startedAt: now.getTime(),
    status: "idle",
  })
  const path = join(dir, "machine.json")
  const processes = { ...machine.processes, [pid]: { command: `claude -n ${name}`, start } }
  writeFileSync(`${path}.tmp`, JSON.stringify({ ...machine, processes }, null, 2), { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
}

// A start of a made-up session on a fixture stack, which spawns nothing: the record cmux kept of the session started as name comes back live, or, on a fixture with none (a fresh machine), a made-up one starts. True when one started, false when one already runs.
export function fixtureStart(name: string, dir = ensureFixture(), now = new Date()): boolean {
  const state = readFixtureCmux(dir)
  const named = state.sessions.filter((s) => startedAs(s.launch_arguments) === name)
  if (named.some((s) => s.stored_pid_exists === true)) return false
  const [session] = named
  if (session) {
    session.stored_pid_exists = true
    session.agent_lifecycle = "idle"
    session.updated_at = now.toISOString()
  } else madeUp(state, name, dir, now)
  writeFixtureCmux(state, dir)
  changed()
  return true
}

// An answer to a fixture session's Feed prompt: the prompt leaves the Feed and the session goes back to work, as cmux shows a reply landing.
export function fixtureReply(requestId: string, dir = ensureFixture()): void {
  const state = readFixtureCmux(dir)
  const item = state.feed.find((i) => i.request_id === requestId && i.status === "pending")
  if (!item) return
  item.status = "answered"
  const workstream = str(item.workstream_id)
  const session = state.sessions.find((s) => workstreamOf(str(s.session_id)) === workstream)
  if (session) session.agent_lifecycle = "running"
  writeFixtureCmux(state, dir)
  changed()
}
