import { join } from "node:path"

import { dataDirOf } from "@packages/env/data-dir"

import { beat, cycle, CYCLE_SECONDS, LEADS, type Proc } from "./flow"

const data = dataDirOf(process.env)
const beatPath = join(data, "ops", "ops-flow.json")
const roster = join(import.meta.dir, "..", "..", "..", "..", "scripts", "roster.ts")

// The process table, read with ps: the job only reads it, never signals a pid.
const procs = (): Proc[] => {
  const out = Bun.spawnSync(["ps", "-axo", "pid=,command="], {
    env: { ...process.env, LC_ALL: "C" },
  })
  if (out.exitCode !== 0) throw new Error("ps could not be read")
  return out.stdout
    .toString()
    .split("\n")
    .flatMap((line) => {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line)
      return m ? [{ command: m[2]!, pid: Number(m[1]) }] : []
    })
}

// A lead's seat by its roster kind, as notify.sh resolves it, today's name when roster.ts cannot say.
const whoOf = async (kind: string): Promise<string> => {
  const out = Bun.spawnSync([process.execPath, roster, "who", kind])
  const name = out.exitCode === 0 ? out.stdout.toString().trim() : ""
  return /^[a-z0-9-]+$/.test(name) ? name : LEADS[kind]!
}

// The open PRs, one REST read every 5 minutes (the factory's **github** rule), so a merged PR still in the ready line raises nothing; a failed read keeps the last answer, and none judges every entry.
let open: Set<number> | undefined
let openAt = 0
const openPrs = (): Set<number> | undefined => {
  if (Date.now() - openAt < 5 * 60_000) return open
  openAt = Date.now()
  const out = Bun.spawnSync([
    "gh",
    "api",
    "repos/{owner}/{repo}/pulls?state=open&per_page=100",
    "--paginate",
    "--jq",
    ".[].number",
  ])
  if (out.exitCode === 0)
    open = new Set(out.stdout.toString().split("\n").filter(Boolean).map(Number))
  return open
}

const once = async () => cycle({ data, open: openPrs(), procs: procs(), whoOf })

if (process.argv.includes("--once")) {
  const { alerted, result } = await once()
  console.log(`ops-flow: ${result}, ${alerted} queued`)
  process.exit(result === "ok" ? 0 : 1)
}

const startedAt = new Date()
let lastResult = "ok"
let reading = false

const pulse = (result: string) =>
  beat(beatPath, startedAt, new Date(), result).catch((err) => console.error(err))

const run = async () => {
  if (reading) return
  reading = true
  const { alerted, result } = await once()
    .catch((err: unknown) => ({
      alerted: 0,
      result: err instanceof Error ? err.message : String(err),
    }))
    .finally(() => {
      reading = false
    })
  lastResult = result
  if (alerted || result !== "ok")
    console.log(`${new Date().toISOString()} ${result}, ${alerted} queued`)
  await pulse(result)
}

// The beat runs on its own timer, so a cycle that hangs still beats, as failing, and never runs beside the next.
void run()
setInterval(() => {
  void pulse(reading ? "still reading from the last cycle" : lastResult)
  void run()
}, CYCLE_SECONDS * 1000)
