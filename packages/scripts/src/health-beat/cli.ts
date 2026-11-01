import { dataDirOf } from "@packages/env/data-dir"
import { gateSettings, readPolicyOrDefaults, ruleSettings } from "@packages/settings"

import { run } from "../ops-job/job"
import { beatText, readBeat } from "./beat"

// The settings as spawn.sh reads them, from policy.json, refusing as it does when that file does not parse.
const data = dataDirOf(process.env)
const policy = readPolicyOrDefaults(data)
if (policy.refusal !== undefined) {
  console.error(`health-beat: ${policy.refusal}`)
  process.exit(2)
}
const zone = ruleSettings.get(policy.settings, "clock.ownerZone")
const freeMin = gateSettings.get(policy.settings, "gates.memoryFreeMin")
console.log(beatText(await readBeat({ at: new Date(), data, freeMin, run, zone })))
