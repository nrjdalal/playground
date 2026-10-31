import { dataDirOf } from "@packages/env/data-dir"
import { readSetting } from "@packages/settings"

import { run } from "../ops-job/job"
import { beatText, readBeat } from "./beat"

const data = dataDirOf(process.env)
const zone = String(readSetting(data, "clock.ownerZone")?.value ?? "UTC")
const freeMin = Number(readSetting(data, "gates.memoryFreeMin")?.value ?? 8)
console.log(beatText(await readBeat({ at: new Date(), data, freeMin, run, zone })))
