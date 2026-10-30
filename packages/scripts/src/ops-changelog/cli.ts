import { join } from "node:path"

import { dataDirOf } from "@packages/env/data-dir"

import { dashboardRun, scheduled } from "../ops-job/job"
import type { Beat } from "../ops-tick/tick"

// Run from the live dashboard's checkout; a seed running there holds the sync quietly.
export const BEATS: Beat[] = [
  {
    cron: "4-59/5 * * * *",
    name: "changelog",
    run: dashboardRun(
      "Changelog sync",
      ["changelog", "sync"],
      join(dataDirOf(process.env), "dashboard-changelog.log"),
      /changelog\/cli\.ts seed|changelog seed/,
    ),
    to: "ops on a failure or a load skip",
  },
]

if (import.meta.main) scheduled("ops-changelog", BEATS)
