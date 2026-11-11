import { statSync } from "node:fs"
import { join } from "node:path"

import { spawnEnv } from "@packages/env/api-hono"
import { type HarnessId, loginOf, setSetting } from "@packages/settings"

import { deliver } from "@/lib/dashboard/deliver"
import { type Run, type Started, startDispatcher } from "@/lib/dashboard/dispatcher-start"
import { checkoutRoot, readsLive } from "@/lib/dashboard/fixture"
import { DISPATCHER } from "@/lib/dashboard/workers"
import { CODEX_LIVE_REFUSAL, isLiveFolder } from "@/lib/onboard/harness"
import { dataDir } from "@/lib/sessions/paths"

// Settings' Switch Alpha, on the owner's own click: harness.alpha takes the other harness, then a dispatcher that is not running starts on it; a running one is asked, in the owner's words, to write its handoff to a fixed file and stop, and once that file is written and still, spawn.sh closes it and the CLI starts it again on the new harness from that handoff. One switch at a time; a Codex switch on the live data folder is refused before anything changes, as Start is.

export type SwitchRead = {
  harness: HarnessId | null
  reason: string | null
  state: "failed" | "idle" | "ok" | "running"
  step: string | null
}

const LABELS: Record<HarnessId, string> = { "claude-code": "Claude Code", codex: "Codex" }

// The handoff a switch asks for, under the data folder, which the new dispatcher's --brief names.
export const switchBrief = (name: string) => join("handoffs", `${name}-switch.md`)

// Pure: what the dispatcher is asked, as the owner would type it, naming the file and what happens next.
export const handoffAsk = (path: string, name: string, harness: HarnessId) =>
  `Switch Alpha to ${LABELS[harness]}: write your handoff now to ${path}, as the playbook's SESSIONS.md says (Write a handoff), then stop. Once it is written, the Dashboard closes this session and starts ${name} again on ${LABELS[harness]} from it.`

export type SwitchDeps = {
  // The dispatcher asked, by deliver(); false when it was not reached.
  ask: (name: string, text: string) => Promise<boolean>
  close: (name: string) => Promise<string | null>
  data: string
  env: Record<string, string | undefined>
  mtime: (path: string) => number | null
  name: string
  now: () => number
  pollMs: number
  save: (harness: HarnessId) => string | null
  sleep: (ms: number) => Promise<void>
  start: (harness: HarnessId, brief?: string) => Promise<Started>
  waitMs: number
}

const runOut: Run = async (argv) => {
  const child = Bun.spawn(argv, {
    env: spawnEnv(),
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

const mtimeOf = (path: string): number | null => {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

// The real switch's parts: deliver() as the owner's click, spawn.sh close from the API's checkout, harness.alpha at the login's scope.
export const switchDeps = (actor: { email: string; id: string }): SwitchDeps => ({
  ask: async (name, text) => (await deliver({ actor, text, to: name })).ok,
  close: async (name) => {
    const root = checkoutRoot()
    if (!readsLive()) return null
    if (!root) return "this API has no checkout to close it from"
    const result = await runOut([join(root, "scripts", "spawn.sh"), "close", name])
    return result.code === 0
      ? null
      : result.stderr.trim().split("\n").at(-1) || `spawn.sh close exited ${result.code}`
  },
  data: dataDir(),
  env: process.env,
  mtime: mtimeOf,
  name: DISPATCHER,
  now: Date.now,
  pollMs: 5_000,
  save: (harness) => {
    const set = setSetting(
      dataDir(),
      { key: "harness.alpha", scope: loginOf(dataDir()), value: harness },
      { actor: actor.id, author: "owner", inboxRef: null, reason: "Switch Alpha in Settings" },
    )
    return set.ok ? null : set.message
  },
  sleep: (ms) => Bun.sleep(ms),
  start: (harness, brief) => startDispatcher({ brief, harness }),
  waitMs: 20 * 60_000,
})

export const createSwitch = () => {
  let current: SwitchRead = { harness: null, reason: null, state: "idle", step: null }

  const run = async (to: HarnessId, deps: SwitchDeps, job: SwitchRead) => {
    const fail = (reason: string) => {
      job.state = "failed"
      job.reason = reason
    }
    const first = await deps.start(to)
    if (first.status === "started") return void (job.state = "ok")
    if (first.status !== "running") return fail(first.detail)
    const path = join(deps.data, switchBrief(deps.name))
    const asked = deps.now()
    job.step = "Waiting for Alpha's handoff"
    if (!(await deps.ask(deps.name, handoffAsk(path, deps.name, to))))
      return fail(`${deps.name} could not be asked for its handoff, so it still runs as before`)
    // The handoff counts once it is newer than the ask and unchanged over one wait, so a file still being written is never read.
    let seen: number | null = null
    for (let waited = 0; ; waited += deps.pollMs) {
      if (waited >= deps.waitMs)
        return fail(`${deps.name} wrote no handoff in time, so it still runs as before`)
      await deps.sleep(deps.pollMs)
      const at = deps.mtime(path)
      if (at !== null && at >= asked && at === seen) break
      seen = at
    }
    job.step = `Starting ${deps.name} on ${LABELS[to]}`
    const closed = await deps.close(deps.name)
    if (closed) return fail(closed)
    const again = await deps.start(to, switchBrief(deps.name))
    if (again.status === "started") return void (job.state = "ok")
    fail(again.status === "running" ? `${deps.name} is still running` : again.detail)
  }

  // Starts a switch to harness to; the refusal's words while one runs, for Codex on the live data folder, or when harness.alpha does not save.
  const begin = (to: HarnessId, deps: SwitchDeps): { done: Promise<void> } | string => {
    if (current.state === "running") return "A switch is already running"
    if (to === "codex" && isLiveFolder(deps.env)) return CODEX_LIVE_REFUSAL
    const unsaved = deps.save(to)
    if (unsaved) return unsaved
    const job: SwitchRead = { harness: to, reason: null, state: "running", step: null }
    current = job
    const done = run(to, deps, job).catch((error: unknown) => {
      job.state = "failed"
      job.reason = error instanceof Error ? error.message : String(error)
    })
    return { done }
  }

  return { begin, read: (): SwitchRead => ({ ...current }) }
}

// The one switch every request reads.
export const dispatcherSwitch = createSwitch()
