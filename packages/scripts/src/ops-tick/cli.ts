import { join } from "node:path"

import { opsDir, REPO as repo, run, sendAs } from "../ops-job/job"
import { loadSessionNames } from "../playground/setting"
import {
  beat,
  BEATS,
  type Context,
  cycle,
  CYCLE_SECONDS,
  guard,
  nextDue,
  resultOf,
  runner,
} from "./tick"

const ops = opsDir()
loadSessionNames()
const beatPath = join(ops, "ops-tick.json")

const send = sendAs("tick")

const context = (now: Date): Context => ({ now, ops, repo, run, send })

if (process.argv.includes("--dry")) {
  const now = new Date()
  for (const b of BEATS) {
    const due = nextDue(b.cron, now)
    console.log(
      `${b.name.padEnd(18)} ${b.cron.padEnd(25)} next ${due.toISOString().slice(0, 16)}Z (${due.toString().slice(16, 21)} here) -> ${b.to}`,
    )
  }
  process.exit(0)
}

const once = process.argv.indexOf("--once")
if (once !== -1) {
  const name = process.argv[once + 1]
  const b = BEATS.find((x) => x.name === name)
  if (!b) {
    console.error(`--once takes a beat: ${BEATS.map((x) => x.name).join(", ")}`)
    process.exit(1)
  }
  const failed: string[] = []
  await b.run(guard(context(new Date()), failed))
  console.log(`ops-tick: ${name} ${failed.length ? failed.join("; ") : "ran"}`)
  process.exit(failed.length ? 1 : 0)
}

const startedAt = new Date()
const state = runner()

const pulse = () =>
  beat(beatPath, startedAt, new Date(), resultOf(state)).catch((err) => console.error(err))

// Every 20 seconds, so each minute is seen even when a cycle lands late; the beat writes once a minute and never waits on a beat's work.
void pulse()
setInterval(() => void cycle(context(new Date()), state), 20_000)
setInterval(() => void pulse(), CYCLE_SECONDS * 1000)
