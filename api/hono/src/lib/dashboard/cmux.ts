import "@packages/env/aliases"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { factoryRoleOf } from "@packages/config/kinds"

import { currentSource, fixtureRead, fixtureReply, fixtureWrite } from "@/lib/dashboard/fixture"
import {
  readRegistry,
  type RegistryFile,
  registeredOf,
  sessionsDir,
  startOf,
} from "@/lib/dashboard/peers"
import { rosterPath } from "@/lib/dashboard/roster"
import { ApiError } from "@/lib/error"
import { everySession } from "@/lib/sessions/own"
import { settledWithin } from "@/lib/settle"

// The dashboard reads cmux through run(), and run() refuses anything outside this list, so no write can arrive through run(); canForce() is the one read outside it, its argv fixed.
export const READ_COMMANDS = [
  ["events"],
  ["list-workspaces"],
  ["read-screen"],
  ["rpc", "feed.list"],
  ["sessions", "list"],
  ["tree"],
] as const

// Flags that make a read write something (`events --cursor-file` saves its cursor to a path).
const WRITING_FLAGS = new Set(["--cursor-file"])

export const isReadCommand = (args: readonly string[]): boolean =>
  READ_COMMANDS.some((prefix) => prefix.every((part, i) => args[i] === part)) &&
  !args.some((arg) => WRITING_FLAGS.has(arg.split("=")[0] ?? arg))

// cmux's socket answers a process that descends from one of its terminals, or one holding its capability token, which turbo drops.
const ACCESS_DENIED = "only processes started inside cmux can connect"

export const cmuxCommand = (args: readonly string[]): string[] => {
  if (!isReadCommand(args)) throw new Error(`cmux ${args.slice(0, 2).join(" ")} is not a read`)
  return ["cmux", ...args]
}

// The dashboard's only writes, kept apart from the reads: typing text or one of these keys into one session's own terminal surface. write() builds every argv itself, so no other command, flag or key can arrive through it.
export const WRITE_KEYS = ["enter", "shift+enter"] as const

export type WriteKey = (typeof WRITE_KEYS)[number]

// `force` passes cmux 0.65's draft guard, which refuses a send into an input that holds text: deliver.ts forces every text send of a message, the first included, once its own screen read has proved the input holds no draft, and only where canForce() says this cmux has the flag.
export type Write =
  | { key: WriteKey; surface: string }
  | { force?: boolean; surface: string; text: string }

// A surface as cmux's session records name one, never a ref or index a caller could point at another pane.
const SURFACE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i

// `cmux send` turns \n, \r and \t into keystrokes, and a control character (C0, DEL or C1) is a keystroke already, so text holding either could submit or tab early; deliver.ts splits text so that no piece does.
export const holdsKeystroke = (text: string): boolean => /\\[nrt]|\p{Cc}/u.test(text)

export const writeCommand = (write: Write): string[] => {
  if (!SURFACE.test(write.surface)) throw new Error("cmux write needs a session's surface id")
  if ("key" in write) {
    if (!WRITE_KEYS.includes(write.key)) throw new Error(`cmux key ${write.key} is not allowed`)
    return ["cmux", "send-key", "--surface", write.surface, "--", write.key]
  }
  if (!write.text || holdsKeystroke(write.text)) {
    throw new Error("cmux text must be non-empty and hold no keystroke")
  }
  const force = write.force ? ["--force"] : []
  return ["cmux", "send", "--surface", write.surface, ...force, "--", write.text]
}

// The dashboard's other write: answering an item a session left in cmux's Feed, a picker's questions, a tool it asks to run, or a plan it asks to start. replyCommand builds every argv and body itself, so no other rpc method, mode or field can arrive through it. A permission is answered once or denied, never always; a plan is started with edits still asking (manual) or sent back, with an optional note.
export const PERMISSION_MODES = ["deny", "once"] as const
export const PLAN_MODES = ["deny", "manual"] as const

export type FeedReply =
  | { kind: "permission"; mode: (typeof PERMISSION_MODES)[number]; requestId: string }
  | {
      feedback: string | null
      kind: "plan"
      mode: (typeof PLAN_MODES)[number]
      requestId: string
    }
  | { kind: "question"; requestId: string; selections: string[] }

// A Feed request id, as cmux mints them.
export const FEED_REQUEST_ID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i

const REPLY_METHODS = {
  permission: "feed.permission.reply",
  plan: "feed.exit_plan.reply",
  question: "feed.question.reply",
} as const

export const replyCommand = (reply: FeedReply): string[] => {
  if (!FEED_REQUEST_ID.test(reply.requestId)) throw new Error("cmux reply needs a Feed request id")
  const base = { request_id: reply.requestId }
  let body: Record<string, unknown>
  if (reply.kind === "question") {
    if (!reply.selections.length || reply.selections.some((s) => !s.trim())) {
      throw new Error("cmux reply needs one non-empty selection per question")
    }
    body = { ...base, selections: reply.selections }
  } else if (reply.kind === "permission") {
    if (!PERMISSION_MODES.includes(reply.mode))
      throw new Error(`permission mode ${reply.mode} is not allowed`)
    body = { ...base, mode: reply.mode }
  } else {
    if (!PLAN_MODES.includes(reply.mode)) throw new Error(`plan mode ${reply.mode} is not allowed`)
    if (reply.feedback && reply.mode !== "deny") throw new Error("a plan's note goes with deny")
    body = { ...base, mode: reply.mode, ...(reply.feedback ? { feedback: reply.feedback } : {}) }
  }
  return ["cmux", "rpc", REPLY_METHODS[reply.kind], JSON.stringify(body)]
}

const cmuxEnv = (): Record<string, string | undefined> => ({
  ...process.env,
  CMUX_QUIET: "1",
})

// The environment the stack's API runs cmux in: turbo passes no CMUX_ variable to its tasks, the capability token included, so the API reaches cmux by descent from a cmux terminal alone.
const stackEnv = (): Record<string, string | undefined> => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CMUX_"))),
  CMUX_QUIET: "1",
})

export const cmuxFailure = (args: readonly string[], detail: string): ApiError =>
  detail.includes(ACCESS_DENIED)
    ? new ApiError(
        503,
        "CMUX_UNAVAILABLE",
        "Start the app from a cmux terminal and keep it attached: cmux answers only processes that descend from one of its terminals",
      )
    : new ApiError(
        502,
        "CMUX_FAILED",
        `cmux ${args[0]} failed: ${detail.slice(0, 200) || "no answer from cmux"}`,
      )

// A command killed at its timeout: cmux gave no answer, which is not a refusal, since a send killed this way may have typed its text anyway (deliver.ts keeps such a failure INTERRUPTED). It reads as cmuxFailure's no-answer failure does.
export class CmuxTimedOut extends ApiError {
  constructor(args: readonly string[]) {
    const noAnswer = cmuxFailure(args, "")
    super(noAnswer.status, noAnswer.code, noAnswer.message)
  }
}

// Only a stack that reads the live machine opens cmux (fixture.ts's dashboardSource): any other answers from its fixture, or, refused for its settings, from nothing. Every process this file starts for the stack passes through here.
const offLive = (): "fixture" | null => {
  const source = currentSource()
  if (source.kind === "live") return null
  if (source.kind === "refused") throw new ApiError(503, "SOURCE_REFUSED", source.reason)
  if (source.kind === "hosted")
    throw new ApiError(503, "SOURCE_REFUSED", "the hosted build reads no machine")
  return "fixture"
}

const fixtureFailure = (args: readonly string[], error: unknown): ApiError =>
  new ApiError(
    502,
    "CMUX_FAILED",
    `The fixture could not answer ${args[0]}: ${error instanceof Error ? error.message : String(error)}`,
  )

// A kill at a timeout is bounded: SIGTERM first, then this grace, then SIGKILL, and the pipes stop being waited on a moment later, since a CLI that traps TERM, or a child holding its stdout, never settles them alone.
const KILL_GRACE_MS = 3000

async function spawn(command: string[], timeoutMs: number, env = cmuxEnv()): Promise<string> {
  const args = command.slice(1)
  if (offLive()) throw new ApiError(503, "CMUX_UNAVAILABLE", "This stack reads a fixture")
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">
  try {
    proc = Bun.spawn(command, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
  } catch {
    throw new ApiError(503, "CMUX_UNAVAILABLE", "cmux is not installed or not on PATH")
  }
  let timedOut = false
  let grace: ReturnType<typeof setTimeout> | undefined
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
    grace = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS)
  }, timeoutMs)
  const settled = await settledWithin(
    Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
    timeoutMs + KILL_GRACE_MS + 1000,
  )
  clearTimeout(timer)
  clearTimeout(grace)
  if (!settled) throw new CmuxTimedOut(args)
  const [stdout, stderr, code] = settled
  if (code !== 0) {
    throw timedOut ? new CmuxTimedOut(args) : cmuxFailure(args, (stderr || stdout).trim())
  }
  return stdout
}

// `sessions list` walks cmux's whole hook-session file, 12.7s at load 19 (9 Oct), and the board waits on it, so a read gets 20s.
export const run = async (args: readonly string[], timeoutMs = 20_000): Promise<string> => {
  const command = cmuxCommand(args)
  if (!offLive()) return spawn(command, timeoutMs)
  try {
    return fixtureRead(args)
  } catch (error) {
    throw fixtureFailure(args, error)
  }
}

export type CmuxStream = Bun.Subprocess<"ignore", "pipe", "ignore">

// A read that keeps running, such as `events --reconnect`: the caller reads its stdout and kills it when done. A non-read throws as run() would, and so does a cmux that cannot start or a fixture, which has no events (fixture.ts's onFixtureChange stands in for them).
export const stream = (args: readonly string[]): CmuxStream => {
  const command = cmuxCommand(args)
  if (offLive()) throw new ApiError(503, "CMUX_UNAVAILABLE", "A fixture has no event stream")
  try {
    return Bun.spawn(command, { env: cmuxEnv(), stdin: "ignore", stdout: "pipe", stderr: "ignore" })
  } catch {
    throw new ApiError(503, "CMUX_UNAVAILABLE", "cmux is not installed or not on PATH")
  }
}

// On a fixture stack the keystroke or the answer lands in the fixture's own scratch state, built and checked as the live one would be, and nothing reaches cmux.
export const write = async (step: Write, timeoutMs = 5000): Promise<void> => {
  const command = writeCommand(step)
  if (!offLive()) return void (await spawn(command, timeoutMs))
  try {
    fixtureWrite(step)
  } catch (error) {
    throw fixtureFailure(["send"], error)
  }
}

// Whether this cmux's send takes --force: 0.65 added it with the draft guard, while 0.64 types the flag into the input as text (measured on a probe), so its own help decides, read once a process. A fixture keeps 0.65's guard.
let forceable: Promise<boolean> | null = null

export const canForce = (): Promise<boolean> => {
  if (offLive()) return Promise.resolve(true)
  forceable ??= spawn(["cmux", "send", "--help"], 5000).then(
    (help) => /(^|\s)--force\b/.test(help),
    (error: unknown) => {
      forceable = null
      throw error
    },
  )
  return forceable
}

export const reply = async (answer: FeedReply, timeoutMs = 5000): Promise<void> => {
  const command = replyCommand(answer)
  if (!offLive()) return void (await spawn(command, timeoutMs))
  try {
    fixtureReply(answer.requestId)
  } catch (error) {
    throw fixtureFailure(["rpc"], error)
  }
}

export const runJson = async (args: readonly string[]): Promise<unknown> => {
  const out = await run(args)
  try {
    return JSON.parse(out)
  } catch {
    throw new ApiError(502, "CMUX_FAILED", `cmux ${args[0]} printed no JSON`)
  }
}

export type Attachment =
  | { state: "attached" }
  | { detail: string; state: "detached" | "missing" | "unreachable" }

// Whether a stack started from this process could read cmux: one read in the stack's own environment, judged by cmux's own answer. The launcher asks it only for a stack that will read the live machine, so a fixture stack's start never opens cmux. cmux answers a process that descends from one of its terminals and refuses any other (one started from outside cmux, or detached with `( … &)` and adopted by launchd) as detached; a cmux that is not on PATH, or will not start, is missing; any other failure, a hang included, is unreachable, in cmux's own words.
export const attachment = async (timeoutMs = 5000): Promise<Attachment> => {
  const env = stackEnv()
  if (!Bun.which("cmux", { PATH: env.PATH ?? "" })) {
    return { detail: "cmux is not installed or not on PATH", state: "missing" }
  }
  let proc: Bun.Subprocess<"ignore", "ignore", "pipe">
  try {
    proc = Bun.spawn(cmuxCommand(["list-workspaces"]), {
      env,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "ignore",
    })
  } catch (error) {
    return {
      detail: `cmux would not start: ${error instanceof Error ? error.message : String(error)}`,
      state: "missing",
    }
  }
  let grace: ReturnType<typeof setTimeout> | undefined
  const timer = setTimeout(() => {
    proc.kill()
    grace = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS)
  }, timeoutMs)
  const settled = await settledWithin(
    Promise.all([new Response(proc.stderr).text(), proc.exited]),
    timeoutMs + KILL_GRACE_MS + 1000,
  )
  clearTimeout(timer)
  clearTimeout(grace)
  if (!settled) return { detail: `no answer within ${timeoutMs / 1000}s`, state: "unreachable" }
  const [said, code] = settled
  if (code === 0) return { state: "attached" }
  if (said.includes(ACCESS_DENIED)) return { detail: said.trim().slice(0, 200), state: "detached" }
  const detail = proc.signalCode
    ? `no answer within ${timeoutMs / 1000}s`
    : said.trim().slice(0, 200) || `cmux exited ${code}`
  return { detail, state: "unreachable" }
}

// The cmux app's own executable, matched by its exact path as scripts/ops/ptable.py does: the `cmux` CLI is another binary.
export const CMUX_APP = "/Applications/cmux.app/Contents/MacOS/cmux"

export type ProcessRow = { exe: string; ppid: number; start: string }

// Pure: `ps -axo pid=,ppid=,lstart=,comm=` under C as each pid's parent, start (as the registry's procStart writes it) and executable.
export function processTableOf(out: string): Map<number, ProcessRow> {
  const table = new Map<number, ProcessRow>()
  for (const line of out.split("\n")) {
    const match =
      /^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(\S.*)$/.exec(
        line,
      )
    if (match) {
      table.set(Number(match[1]), {
        exe: (match[4] ?? "").trim(),
        ppid: Number(match[2]),
        start: startOf(match[3] ?? ""),
      })
    }
  }
  return table
}

const underCmux = (pid: number, table: Map<number, ProcessRow>): boolean => {
  const seen = new Set<number>()
  for (let at = pid; at > 1 && !seen.has(at);) {
    seen.add(at)
    const row = table.get(at)
    if (!row) return false
    if (row.exe === CMUX_APP) return true
    at = row.ppid
  }
  return false
}

// Pure: the live factory sessions running under the cmux app, each by its registry name, read from the registry, the process table and the roster's agents alone, so a process cmux refuses still learns whether cmux holds one. A session is live when its pid runs and, where its file gives procStart, started then; it is the factory's when its name places it there as the hooks place one (factoryRoleOf: the roster's kind for the name, else the name), so a session of the owner's own never holds cmux. A file that does not read whole (Claude rewrites it in place) counts by its pid, so a session mid-rewrite still holds cmux. null when the registry cannot be read while the cmux app runs.
export function cmuxHeldOf(
  files: RegistryFile[] | null,
  table: Map<number, ProcessRow>,
  roster: unknown,
): string[] | null {
  if (![...table.values()].some((row) => row.exe === CMUX_APP)) return []
  if (files === null) return null
  const kinds = new Map<unknown, unknown>(
    (Array.isArray(roster) ? roster : []).map((agent) => [agent?.name, agent?.kind]),
  )
  return files.flatMap((file) => {
    const session = file.text === null ? null : registeredOf(file.text)
    const row = table.get(file.pid)
    if (!row || (session?.procStart !== undefined && session.procStart !== row.start)) return []
    if (!underCmux(file.pid, table)) return []
    if (session === null || file.text === null) return [`pid ${file.pid}`]
    const name = registryNameOf(file.text)
    return factoryRoleOf(name, kinds.get(name)) ? [name] : []
  })
}

// Pure: the name a registry file gives, as the hooks read it (scripts/hooks/role.ts), never the folder registeredOf falls back to, which would place an unnamed session in a checkout named for the dispatcher as the dispatcher.
const registryNameOf = (text: string): string => {
  const name = (JSON.parse(text) as { name?: unknown }).name
  return typeof name === "string" ? name : ""
}

// The roster's agents (the data folder's roster.json, PLAYGROUND_DATA_DIR's when set), read raw as the hooks read it, since readRoster() drops an agent they still place (roster.md), or none when it cannot be read.
export const rosterAgents = async (path = rosterPath()): Promise<unknown> => {
  try {
    return ((await Bun.file(path).json()) as { agents?: unknown }).agents
  } catch {
    return []
  }
}

// The live factory sessions cmux holds, read without asking cmux (the launcher asks it once cmux will not answer a stack), or null when ps or the registry cannot be read, which a caller reads as not known; a sessions folder not made yet holds none, since Claude Code makes it with a session's first registry file.
export const cmuxHeld = async (dir = sessionsDir()): Promise<string[] | null> => {
  const ps = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,lstart=,comm="], {
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    stdin: "ignore",
    timeout: 10_000,
  })
  if (ps.exitCode !== 0) return null
  return cmuxHeldOf(
    existsSync(dir) ? await readRegistry(dir) : [],
    processTableOf(ps.stdout.toString()),
    await rosterAgents(),
  )
}

// A stack that reads this machine reads herdr alone unless it shows every session (everySession in lib/sessions/own.ts), or when the launcher's word says cmux would not answer it and held no live factory session when it started: no sessions, Feed, tree or events read reaches cmux.
export const herdrAlone = (): boolean =>
  currentSource().kind === "live" && (process.env.PLAYGROUND_HERDR_ALONE === "1" || !everySession())
