import { join } from "node:path"

import { engineData, hold, REPO, run, sendAs } from "../ops-job/job"
import { checkBattery } from "./battery"
import { flagsOf, launchdAwakeOf, lidSleepOf } from "./flags"

const data = engineData("ops-awake")
const ops = join(data, "ops")

const awake = await launchdAwakeOf(run)
if (awake.state === "loaded") {
  console.error(
    "ops-awake: launchd already runs the ops-awake LaunchAgent (caffeinate -s); refusing to start this bun job, whose caffeinate would fake activity beside it",
  )
  process.exit(1)
}
if (awake.state === "failed") {
  console.error(
    `ops-awake: launchctl could not tell whether launchd runs the ops-awake LaunchAgent (exit ${awake.code}): ${awake.out.trim().slice(0, 200)}; refusing to start beside an unknown state`,
  )
  process.exit(1)
}

// The battery check each minute while caffeinate holds; only a failed post or close is sent, to ops.
const battery = async () => {
  try {
    const line = await checkBattery({ now: new Date(), ops, repo: REPO, run })
    if (line) await sendAs("ops-awake")("ops", line)
  } catch (error) {
    console.error(`ops-awake: battery check: ${(error as Error).message}`)
  }
}
void battery()
setInterval(() => void battery(), 60_000)

process.exit(await hold("ops-awake", ["caffeinate", ...flagsOf(await lidSleepOf(data))], ops))
