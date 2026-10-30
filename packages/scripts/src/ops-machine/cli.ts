import { join } from "node:path"

import { configDirOf } from "@packages/env/data-dir"

import { engineData, run, scheduled } from "../ops-job/job"
import { liveSessions } from "../ops-session-resume/resume"
import type { Beat } from "../ops-tick/tick"
import { loadSessionNames } from "../playground/setting"
import { readMachine, sampleMachine } from "./machine"

const live = async () => [...(await liveSessions(configDirOf())).values()]

export const BEATS: Beat[] = [
  {
    cron: "* * * * *",
    name: "machine",
    run: async (ctx) => {
      await sampleMachine(run, ctx.ops, await live(), ctx.now)
    },
    to: "nobody; its heartbeat shows a failure",
  },
]

if (import.meta.main) {
  loadSessionNames()
  const ops = join(engineData("ops-machine"), "ops")
  // --once prints one reading and writes nothing, so a hand run leaves the job's file alone.
  if (process.argv.includes("--once"))
    console.log(JSON.stringify(await readMachine(run, ops, await live())))
  else scheduled("ops-machine", BEATS, ops)
}
