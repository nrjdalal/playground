import { join } from "node:path"

import { livePair } from "@/lib/dev/live-dashboard"
import { stopStack } from "@/lib/dev/stop"

// `bun run dev:stop` ends the stack `bun run dev` recorded in this checkout, for when the session or terminal that started it has gone; a stack still in reach stops from there (Ctrl+C, or TaskStop on its background task). The live dashboard's checkout is its runner's to stop, so it takes `--live-dashboard` there.
const ROOT = join(import.meta.dir, "../../../..")

const stopped = await stopStack(ROOT, {
  liveBranch: livePair().branch,
  liveDashboard: process.argv.includes("--live-dashboard"),
})
if (!stopped.ok) {
  console.error(`dev:stop: ${stopped.reason}`)
  process.exit(1)
}
console.error(`dev:stop: stopped the stack in process groups ${stopped.groups.join(", ")}`)
