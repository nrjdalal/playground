import { homedir } from "node:os"
import { join } from "node:path"

import { beat, cycle, CYCLE_SECONDS, liveSessions, opsDirOf } from "./resume"

const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
const beatPath = join(opsDirOf(), "ops-session-resume.json")
const once = () => cycle({ configDir, live: () => liveSessions(configDir) })

if (process.argv.includes("--once")) {
  const { result, resumed } = await once()
  console.log(`ops-session-resume: ${result}, ${resumed} resumed`)
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
  const { result, resumed } = await once().finally(() => {
    reading = false
  })
  lastResult = result
  if (resumed || result !== "ok")
    console.log(`${new Date().toISOString()} ${result}, ${resumed} resumed`)
  await pulse(result)
}

// The beat runs on its own timer, so a cycle that hangs still beats, as failing, and never runs beside the next.
void run()
setInterval(() => {
  void pulse(reading ? "still resuming from the last cycle" : lastResult)
  void run()
}, CYCLE_SECONDS * 1000)
