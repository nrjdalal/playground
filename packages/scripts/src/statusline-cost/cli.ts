// ops-usage runs this each cycle: it reads what the transcripts gained since its last run and writes the status line's weekly_retail and daily24_retail, with retail_unpriced beside them, so the status line's own ccusage refresh never fires
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { configDirOf, dataDir } from "@packages/env/data-dir"

import { writeAtomic } from "../write-atomic"
import { emptyState, figures, type State, update } from "./cost"

const { values } = parseArgs({
  options: {
    // the folder the status line reads its cache from, Claude Code's config folder's .cache by default
    cache: { type: "string" },
    // a fixed clock for a measured run over a finished day, with a state and a cache folder of its own
    now: { type: "string" },
    root: { type: "string" },
    state: { type: "string" },
  },
})

const config = configDirOf()
const cache = values.cache ?? join(config, ".cache")
const root = values.root ?? join(config, "projects")
const statePath = values.state ?? join(dataDir(), "ops", "statusline-cost.json")
const now = values.now ? Date.parse(values.now) : Date.now()
if (Number.isNaN(now)) {
  console.error(`statusline-cost: --now ${values.now} is not a time`)
  process.exit(2)
}

const read = (): State => {
  if (!existsSync(statePath)) return emptyState()
  try {
    return JSON.parse(readFileSync(statePath, "utf8"))
  } catch {
    return emptyState()
  }
}

const state = read()
const { bytes } = existsSync(root) ? update(state, root, now) : { bytes: 0 }
await writeAtomic(statePath, JSON.stringify(state))
const { day24, unpriced, weekly } = figures(
  state,
  now,
  Intl.DateTimeFormat().resolvedOptions().timeZone,
)
await writeAtomic(join(cache, "weekly_retail"), String(weekly))
await writeAtomic(join(cache, "daily24_retail"), String(day24))
await writeAtomic(join(cache, "retail_unpriced"), String(unpriced))
console.log(
  JSON.stringify({ bytes, day24: +day24.toFixed(2), unpriced, weekly: +weekly.toFixed(2) }),
)
