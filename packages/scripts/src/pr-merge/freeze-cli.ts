import { parseArgs } from "node:util"

import { endFreeze, FREEZE_LAPSE_MS, freezeStatus, heldPath, startFreeze } from "./held"

const USAGE = `Usage: bun run ship:freeze <version>
       bun run ship:freeze --end
       bun run ship:freeze status

Holds every PR at pr:merge and merge-on-ready while a ship is under way, through held-prs.json's
"*" line (${heldPath()}), so canary holds still from the candidate's pin to its tag.

  <version>  a version, vX.Y.Z: writes the "*" line naming it, keeping every other line; run it
             again to restart its lapse, ${FREEZE_LAPSE_MS / 3_600_000} hours, after which the line holds nothing
  --end      removes the "*" line, once the tag lands or the ship stops
  status     prints the "*" line, its since and whether it has lapsed, or that none is set, and
             writes nothing

A "*" line Ops wrote by hand holds every PR already and never lapses, so <version> and --end leave it.`

const MESSAGES = {
  kept: 'ship:freeze: the "*" line is one Ops wrote by hand, so it stays for Ops to remove',
  none: 'ship:freeze: no "*" line to remove',
  removed: 'ship:freeze: removed the "*" line',
}

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { end: { type: "boolean" }, help: { short: "h", type: "boolean" } },
  })
  const [version = ""] = positionals
  if (values.help || (values.end ? positionals.length !== 0 : positionals.length !== 1)) {
    console.log(USAGE)
    process.exit(values.help ? 0 : 1)
  }
  if (values.end) {
    console.log(MESSAGES[await endFreeze(heldPath())])
  } else if (version === "status") {
    const status = await freezeStatus(heldPath(), Date.now())
    console.log(
      status
        ? `ship:freeze: "*": ${status.line} (${status.until ? `until ${status.until}` : `since ${status.since ?? "no time"}`})${status.lapsed ? ", lapsed: it holds no PR" : ""}`
        : 'ship:freeze: no "*" line is set',
    )
  } else if (!/^v\d+\.\d+\.\d+$/.test(version)) {
    console.error(`ship:freeze: ${version} is not a version (vX.Y.Z), so nothing is written`)
    console.log(USAGE)
    process.exit(1)
  } else {
    const { kept, line } = await startFreeze(heldPath(), version)
    console.log(
      kept
        ? `ship:freeze: every PR is held already, by a "*" line Ops wrote by hand, which stays: ${line}`
        : `ship:freeze: every PR is held: ${line}`,
    )
  }
} catch (error) {
  console.error(`ship:freeze: ${(error as Error).message}`)
  console.log(USAGE)
  process.exit(1)
}
