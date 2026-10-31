import { join } from "node:path"

import { engineData, hold, REPO, run, sendAs } from "../ops-job/job"
import { checkBattery } from "./battery"
import { flagsOf, lidSleepOf } from "./flags"

const data = engineData("ops-awake")
const ops = join(data, "ops")

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
