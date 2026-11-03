import { parseArgs } from "node:util"

import { endFreeze, FREEZE_LAPSE_MS, heldPath, startFreeze } from "./held"

const USAGE = `Usage: bun run ship:freeze <version>
       bun run ship:freeze --end

Holds every PR at pr:merge and merge-on-ready while a ship is under way, through held-prs.json's
"*" line (${heldPath()}), so canary holds still from the candidate's pin to its tag.

  <version>  writes the "*" line naming the version, keeping every other line; run it again to
             restart its lapse, ${FREEZE_LAPSE_MS / 3_600_000} hours, after which the line holds nothing
  --end      removes the "*" line, once the tag lands or the ship stops`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { end: { type: "boolean" }, help: { short: "h", type: "boolean" } },
})
const [version] = positionals

if (values.help || (values.end ? version !== undefined : positionals.length !== 1)) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

try {
  if (values.end) {
    const had = await endFreeze(heldPath())
    console.log(had ? 'ship:freeze: removed the "*" line' : 'ship:freeze: no "*" line to remove')
  } else {
    const reason = await startFreeze(heldPath(), version ?? "")
    console.log(`ship:freeze: every PR is held: ${reason}`)
  }
} catch (error) {
  console.error(`ship:freeze: ${(error as Error).message}`)
  process.exit(1)
}
