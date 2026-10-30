import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { site } from "@packages/config/site"
import type { Context } from "hono"

import { readsLive } from "@/lib/dashboard/fixture"
import { ApiError } from "@/lib/error"
import { FIX_IDS, type FixId, fixtureFixed } from "@/lib/onboard/fix-ids"

// The first run's fix buttons: each id in FIX_IDS runs its own fixed steps, chosen by what this machine has and never by request text, one fix at a time, each step stopped past its own bound and given only the environment the tools need, keeping the last lines it printed for the pane; gh's sign-in runs in Bun's pty as claude-setup.ts's does, its one-time code shown for the owner to enter at GitHub. A fixture stack runs fixtures/fix.ts in place of every tool.

export type Device = { code: string; url: string }

export type FixRead = {
  device: Device | null
  id: FixId
  lines: string[]
  reason: string | null
  state: "failed" | "idle" | "ok" | "running"
}

type Step =
  | { argv: string[]; label: string; login?: true; ms: number; note?: string }
  | { label: string; tries: number; until: string[] }

type Env = Record<string, string | undefined>

// What a test injects: the environment the steps are given theirs from, whether the stack reads this machine, the folders added after PATH (where Homebrew puts what it installs), one bound for every step and the wait between docker info tries.
type Deps = {
  env?: () => Env
  live?: () => boolean
  paths?: string[]
  stepMs?: number
  waitMs?: number
}

const KEEP = 40
const NO_BROWSER = "/usr/bin/true"
const GITHUB_DEVICE = "https://github.com/login/device"
const CLAUDE_INSTALLER = "https://claude.ai/install.sh"
const HERDR_PIN = join(
  import.meta.dir,
  "../../../../../packages/scripts/src/playground/herdr-pin.ts",
)
const FAKE = join(import.meta.dir, "../../fixtures/fix.ts")
const BREW_PATHS = ["/opt/homebrew/bin", "/usr/local/bin"]
const DOCKER_TRIES = 90
const MINUTE = 60_000
const PROBE_MS = 30_000
const LATE = "it took too long, so it was stopped"
// All a step reads of the API's environment: where things are and go, the language, the terminal, a proxy curl and brew go through and Docker's own context, never the API's settings or tokens.
const PASSED = [
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "NO_PROXY",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]

// Each fix's steps, from what is on PATH now, each with the most it may take; the database's start is the setup app's own, so it has none here.
const PLANS: Record<FixId, ((has: (tool: string) => boolean, dir: string) => Step[]) | null> = {
  claude: (_, dir) => [
    {
      argv: [
        "curl",
        "-fsSL",
        "--connect-timeout",
        "30",
        "--max-time",
        "240",
        "-o",
        join(dir, "install.sh"),
        CLAUDE_INSTALLER,
      ],
      label: "Downloading Claude Code",
      ms: 5 * MINUTE,
    },
    { argv: ["bash", join(dir, "install.sh")], label: "Installing Claude Code", ms: 15 * MINUTE },
  ],
  database: null,
  docker: (has) => [
    ...(has("docker")
      ? []
      : [
          {
            argv: ["brew", "install", "--cask", "docker"],
            label: "Installing Docker Desktop",
            ms: 30 * MINUTE,
          },
        ]),
    { argv: ["open", "-a", "Docker"], label: "Opening Docker Desktop", ms: MINUTE },
    { label: "Waiting for Docker to start", tries: DOCKER_TRIES, until: ["docker", "info"] },
  ],
  "gh-login": (has) => [
    ...(has("gh")
      ? []
      : [{ argv: ["brew", "install", "gh"], label: "Installing the GitHub CLI", ms: 20 * MINUTE }]),
    {
      argv: ["gh", "auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https"],
      label: "Signing in to GitHub",
      login: true,
      ms: 15 * MINUTE,
      // Enter on gh's "Authenticate Git" prompt makes gh git's credential helper, which the settings repo's push needs.
      note: `${site.name} also lets git use this GitHub sign-in`,
    },
  ],
  git: () => [{ argv: ["brew", "install", "git"], label: "Installing git", ms: 20 * MINUTE }],
  herdr: () => [
    { argv: ["bun", "--no-env-file", HERDR_PIN], label: "Installing herdr", ms: 15 * MINUTE },
  ],
  node: (has) => [
    has("node")
      ? { argv: ["brew", "upgrade", "node"], label: "Updating Node.js", ms: 20 * MINUTE }
      : { argv: ["brew", "install", "node"], label: "Installing Node.js", ms: 20 * MINUTE },
  ],
  python: () => [
    { argv: ["brew", "install", "python"], label: "Installing Python", ms: 20 * MINUTE },
  ],
}

const NAMES: Record<string, string> = { brew: "Homebrew", docker: "Docker" }

export const isFixId = (id: string): id is FixId => (FIX_IDS as readonly string[]).includes(id)

const linesOf = (text: string) =>
  Bun.stripANSI(text)
    .split(/\r\n|\r|\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)

export const createFixes = ({
  env = () => process.env,
  live = readsLive,
  paths = BREW_PATHS,
  stepMs,
  waitMs = 2_000,
}: Deps = {}) => {
  let current: FixRead | undefined

  const add = (job: FixRead, text: string) => {
    job.lines.push(...linesOf(text))
    job.lines.splice(0, Math.max(0, job.lines.length - KEEP))
  }

  // Kills the child it was given, by its own handle, once ms pass; late says whether it did.
  const bound = (child: Bun.Subprocess, ms: number) => {
    let late = false
    const timer = setTimeout(() => {
      late = true
      child.kill()
    }, stepMs ?? ms)
    return {
      done: () => {
        clearTimeout(timer)
        return late
      },
    }
  }

  const run = async (job: FixRead, step: Step, base: Env, dir: string) => {
    const argv = "until" in step ? step.until : step.argv
    const binary = argv[0]!.startsWith("/")
      ? argv[0]
      : Bun.which(argv[0]!, { PATH: base.PATH ?? "" })
    if (!binary) throw new Error(`${NAMES[argv[0]!] ?? argv[0]} is not installed`)
    const command = [binary, ...argv.slice(1)]
    if ("until" in step) {
      for (let tries = 0; tries < step.tries; tries++) {
        if (tries > 0) await Bun.sleep(waitMs)
        const probe = Bun.spawn(command, {
          env: base,
          stderr: "ignore",
          stdin: "ignore",
          stdout: "ignore",
        })
        const probing = bound(probe, PROBE_MS)
        const code = await probe.exited
        if (!probing.done() && code === 0) return
      }
      throw new Error(
        "Docker did not start: finish its first start in the window it opened, then try again",
      )
    }
    if (step.login) return login(job, command, base, step.ms)
    const child = Bun.spawn(command, {
      cwd: dir,
      env: base,
      stderr: "pipe",
      stdin: "ignore",
      stdout: "pipe",
    })
    const read = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder()
      for await (const chunk of stream) add(job, decoder.decode(chunk, { stream: true }))
    }
    const timing = bound(child, step.ms)
    const reading = Promise.all([read(child.stdout), read(child.stderr)])
    const code = await child.exited
    // A grandchild left holding the pipes keeps reading open, so a step past its bound settles without it.
    if (timing.done()) throw new Error(LATE)
    await reading
    if (code !== 0) throw new Error(job.lines.at(-1) ?? `it exited with ${code}`)
  }

  // gh auth login --web in a pty: Enter takes its default for each prompt (git over https, and the browser it would open, which is /usr/bin/true), and the code it prints shows in the pane until the owner enters it at GitHub and gh exits.
  const login = async (job: FixRead, command: string[], base: Env, ms: number) => {
    const decoder = new TextDecoder()
    let screen = ""
    const answered = new Set<string>()
    const child = Bun.spawn(command, {
      env: { ...base, BROWSER: NO_BROWSER, GH_BROWSER: NO_BROWSER },
      terminal: {
        cols: 4096,
        data: (terminal, chunk) => {
          const text = decoder.decode(chunk, { stream: true })
          screen += text
          add(job, text)
          const plain = Bun.stripANSI(screen)
          for (const prompt of [
            "Authenticate Git with your GitHub credentials?",
            "Press Enter to open",
          ]) {
            if (plain.includes(prompt) && !answered.has(prompt)) {
              answered.add(prompt)
              terminal.write("\r")
            }
          }
          const code = /one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(plain)?.[1]
          if (code) job.device = { code, url: GITHUB_DEVICE }
        },
        rows: 50,
      },
    })
    const timing = bound(child, ms)
    const code = await child.exited
    job.device = null
    if (timing.done()) throw new Error(LATE)
    if (code !== 0) throw new Error(job.lines.at(-1) ?? `it exited with ${code}`)
  }

  const steps = async (job: FixRead) => {
    const from = env()
    const PATH = [from.PATH ?? "", ...paths].filter(Boolean).join(":")
    const runEnv: Env = {
      ...Object.fromEntries(PASSED.flatMap((key) => (from[key] ? [[key, from[key]]] : []))),
      HOMEBREW_NO_AUTO_UPDATE: "1",
      NONINTERACTIVE: "1",
      PATH,
    }
    const has = (tool: string) => Bun.which(tool, { PATH }) !== null
    const dir = mkdtempSync(join(tmpdir(), "playground-fix-"))
    const real = live()
    const plan: Step[] = real
      ? PLANS[job.id]!(has, dir)
      : [
          {
            argv: [process.execPath, FAKE, job.id],
            label: "Running a made-up fix",
            login: true,
            ms: MINUTE,
          },
        ]
    try {
      for (const step of plan) {
        add(job, step.label)
        if ("note" in step && step.note) add(job, step.note)
        try {
          await run(job, step, runEnv, dir)
        } catch (error) {
          throw new Error(
            `${step.label} stopped: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      if (!real) fixtureFixed.add(job.id)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  }

  // Starts id's fix, the database's from start; false while any fix runs.
  const start = (
    id: FixId,
    database?: (line: (text: string) => void) => Promise<void>,
  ): boolean => {
    if (current?.state === "running") return false
    const job: FixRead = { device: null, id, lines: [], reason: null, state: "running" }
    current = job
    const work = id === "database" ? database!((text) => add(job, text)) : steps(job)
    work.then(
      () => {
        job.state = "ok"
      },
      (error: unknown) => {
        job.state = "failed"
        job.reason = error instanceof Error ? error.message : String(error)
      },
    )
    return true
  }

  const read = (id: FixId): FixRead =>
    current?.id === id
      ? { ...current, lines: [...current.lines] }
      : { device: null, id, lines: [], reason: null, state: "idle" }

  return { busy: () => current?.state === "running", read, start }
}

export type Fixes = ReturnType<typeof createFixes>

// The one runner every app serves, so a fix the setup app starts reads on in the app it moves on to.
export const fixes = createFixes()

const idOf = (c: Context): FixId => {
  const id = c.req.param("id") ?? ""
  if (!isFixId(id)) throw new ApiError(404, "NOT_FOUND", "No such fix")
  return id
}

export const busy = () => new ApiError(409, "CONFLICT", "A fix is already running")

export const readFix = (runner: Fixes) => (c: Context) => c.json({ data: runner.read(idOf(c)) })

// Starts the fix the path names; the database's runs database, and with none (the app runs on one) is refused.
export const startFix =
  (runner: Fixes, database?: (line: (text: string) => void) => Promise<void>) => (c: Context) => {
    const id = idOf(c)
    if (id === "database" && !database) {
      throw new ApiError(409, "CONFLICT", "The database is already running")
    }
    if (!runner.start(id, database)) throw busy()
    return c.json({ data: runner.read(id) }, 202)
  }
