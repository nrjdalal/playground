import "@packages/env/aliases"
import { currentSource } from "@/lib/dashboard/fixture"
import { ApiError } from "@/lib/error"
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

const cmuxEnv = (): Record<string, string | undefined> => ({
  ...process.env,
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

// Only a stack that reads the live machine opens cmux (fixture.ts's dashboardSource): a fixture stack's sessions are herdr panes (herdr.ts), so it asks cmux nothing, and a refused or hosted one reads nothing. Every process this file starts for the stack passes through here.
const offLive = (): "fixture" | null => {
  const source = currentSource()
  if (source.kind === "live") return null
  if (source.kind === "refused") throw new ApiError(503, "SOURCE_REFUSED", source.reason)
  if (source.kind === "hosted")
    throw new ApiError(503, "SOURCE_REFUSED", "the hosted build reads no machine")
  return "fixture"
}

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
  return spawn(command, timeoutMs)
}

export type CmuxStream = Bun.Subprocess<"ignore", "pipe", "ignore">

// A read that keeps running, such as `events --reconnect`: the caller reads its stdout and kills it when done. A non-read throws as run() would, and so does a cmux that cannot start or a fixture stack, which asks cmux nothing.
export const stream = (args: readonly string[]): CmuxStream => {
  const command = cmuxCommand(args)
  if (offLive()) throw new ApiError(503, "CMUX_UNAVAILABLE", "This stack reads a fixture")
  try {
    return Bun.spawn(command, { env: cmuxEnv(), stdin: "ignore", stdout: "pipe", stderr: "ignore" })
  } catch {
    throw new ApiError(503, "CMUX_UNAVAILABLE", "cmux is not installed or not on PATH")
  }
}

// A fixture stack types into herdr's made-up panes (herdr.ts) and refuses a cmux keystroke or answer, as spawn() does.
export const write = async (step: Write, timeoutMs = 5000): Promise<void> => {
  const command = writeCommand(step)
  await spawn(command, timeoutMs)
}

// Whether this cmux's send takes --force: 0.65 added it with the draft guard, while 0.64 types the flag into the input as text (measured on a probe), so its own help decides, read once a process.
let forceable: Promise<boolean> | null = null

export const canForce = (): Promise<boolean> => {
  forceable ??= spawn(["cmux", "send", "--help"], 5000).then(
    (help) => /(^|\s)--force\b/.test(help),
    (error: unknown) => {
      forceable = null
      throw error
    },
  )
  return forceable
}

export const runJson = async (args: readonly string[]): Promise<unknown> => {
  const out = await run(args)
  try {
    return JSON.parse(out)
  } catch {
    throw new ApiError(502, "CMUX_FAILED", `cmux ${args[0]} printed no JSON`)
  }
}
