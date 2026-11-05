import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { machine, stop, WAITING } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

const NOTE =
  /^run-slot\.sh: bun run pr:(merge|train) runs at once, outside the queue: a merge carries its own gates/gm

// A machine whose one CPU slot a big run holds at 30% idle, so a medium run waits, and whose bun touches its last word for `bun run pr:merge` and `bun run pr:train`, as a merge that lands
const busy = () => {
  const m = machine({ idle: 30 })
  renameSync(join(m.bin, "bun"), join(m.bin, "bun-machine"))
  writeFileSync(
    join(m.bin, "bun"),
    `#!/bin/bash\ncase "$2" in pr:merge|pr:train) touch "\${@: -1}"; exit 0 ;; esac\nexec ${join(m.bin, "bun-machine")} "$@"\n`,
  )
  chmodSync(join(m.bin, "bun"), 0o755)
  m.hold("run-slot", 3, "big")
  return m
}

// 5 Nov: three merges wrapped in run-slot in one hour each waited behind the heavy queue, and each one's type step queued a second time
describe("bun run pr:merge and pr:train through run-slot", () => {
  for (const command of [
    ["bun", "run", "pr:merge", "5"],
    ["bun", "run", "pr:train", "ready"],
  ])
    test(`${command.join(" ")} runs at once beside a held slot, with a one-line note`, async () => {
      const m = busy()
      const run = m.start("worker-x", { RUN_SLOT_SIZE: "medium" }, undefined, command)
      // the note or the waiting line, whichever comes first, so a run that queues fails here rather than by the timeout
      const said = await run.saw(new RegExp(`${NOTE.source}|${WAITING.source}`, "gm"))
      const queued = await run.saw(WAITING)
      if (queued) await stop(run.p)
      expect([said, queued]).toEqual([true, false])
      expect(await run.saw(NOTE)).toBe(true)
      expect(await run.ran()).toBe(true)
    })

  test("a chain script holding pr:merge among other steps still waits in the queue", async () => {
    const m = busy()
    const chain = join(m.root, "merge-chain.sh")
    writeFileSync(chain, 'set -euo pipefail\nbun run pr:merge 5\ntouch "$1"\n')
    const run = m.start("worker-x", { RUN_SLOT_SIZE: "medium" }, undefined, ["bash", chain])
    expect(await run.waits()).toBe(true)
  })
})
