import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang: 60s, twice the slowest case under SLOW_CHILD=1.5 but local CI's, which sets its own
setDefaultTimeout(60_000)

// issue 285: can-take and head set the command to a bare `true`, so once run-slot.runs.log holds three short runs of one, quick_kind read both as quick and ran them past their own exits, and a held slot read free
const threeShortTrueRuns = (m: ReturnType<typeof machine>) =>
  writeFileSync(
    join(m.ops, "run-slot.runs.log"),
    [0, 1, 2]
      .map(
        (i) =>
          `2026-10-31T10:00:0${i}Z ask worker-q ${900 + i} true\n2026-10-31T10:01:0${i}Z end worker-q ${900 + i} rc=0 ran=1s\n`,
      )
      .join(""),
  )

describe("a read command while the runs log holds three short true runs", () => {
  test("can-take stays at 1 on a held slot", async () => {
    const m = machine()
    m.hold("run-slot", 1, "small")
    threeShortTrueRuns(m)
    expect(await m.canTake("run-slot", "worker-probe")).toBe(false)
  })

  test("head still names the waiter it named before", () => {
    const m = machine()
    threeShortTrueRuns(m)
    m.ticket(2, "worker-m", "s2 22 2 medium")
    const run = Bun.spawnSync(["bash", SCRIPT, "head"], { cwd: m.root, env: m.env() })
    expect([run.exitCode, run.stdout.toString()]).toEqual([0, `2-${process.pid}-worker-m\n`])
  })
})
