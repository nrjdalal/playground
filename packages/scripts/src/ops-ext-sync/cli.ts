import { dataDir } from "@packages/env/data-dir"

import { run, scheduled } from "../ops-job/job"
import type { Beat } from "../ops-tick/tick"
import { syncExtensions } from "./sync"

// Nightly at 02:30 machine time; a scope refused or failed goes to ops with its reason.
export const BEATS: Beat[] = [
  {
    cron: "30 2 * * *",
    name: "ext-sync",
    run: async (ctx) => {
      try {
        for (const line of await syncExtensions({ data: dataDir(), run })) console.log(line)
      } catch (error) {
        await ctx.send("ops", (error as Error).message)
        throw error
      }
    },
    to: "ops on a refusal or a failure",
  },
]

if (import.meta.main) {
  const at = process.argv.indexOf("--once")
  if (at !== -1) {
    try {
      const only = process.argv[at + 1]
      for (const line of await syncExtensions({ data: dataDir(), only, run })) console.log(line)
    } catch (error) {
      console.error((error as Error).message)
      process.exit(1)
    }
  } else scheduled("ops-ext-sync", BEATS)
}
