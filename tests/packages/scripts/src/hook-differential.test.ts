import { afterAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const SCRIPT = join(import.meta.dir, "../../../../packages/scripts/src/hook-differential.ts")
const DIR = mkdtempSync(join(tmpdir(), "hook-differential-"))

afterAll(() => rmSync(DIR, { force: true, recursive: true }))

// a home whose run-slot.sh stand-in logs each ticket it is asked for and answers `room` with 7 waiters
const home = (name: string) => {
  const at = join(DIR, name)
  mkdirSync(join(at, ".playground", "ops"), { recursive: true })
  const runSlot = join(at, ".playground", "ops", "run-slot.sh")
  writeFileSync(
    runSlot,
    `#!/bin/bash\nif [ "$1" = room ]; then echo "4 4 0 7"; exit 0; fi\necho "$*" >> "${at}/tickets"\n`,
  )
  chmodSync(runSlot, 0o755)
  return at
}

const start = (at: string, env: Record<string, string> = {}) => {
  const { RUN_SLOT_NICE: _, ...rest } = process.env
  return Bun.spawnSync(["bun", SCRIPT, "replay", "--canary", "HEAD", "--hook", "no-such-hook"], {
    cwd: join(import.meta.dir, "../../../.."),
    env: { ...rest, HOME: at, ...env },
    stderr: "pipe",
    stdout: "pipe",
  })
}

describe("a start of hook-differential", () => {
  test("a bare start of the replay takes a run-slot ticket and says so on stderr with the queue's depth", () => {
    const at = home("bare")
    const run = start(at)
    expect(readFileSync(join(at, "tickets"), "utf8")).toContain(
      `-- bun ${SCRIPT} replay --canary HEAD --hook no-such-hook`,
    )
    expect(run.stderr.toString()).toContain("queued through run-slot behind 7 waiting")
  })

  test("a start inside a run-slot ticket takes no second one", () => {
    const at = home("inside")
    start(at, { RUN_SLOT_NICE: "10" })
    expect(existsSync(join(at, "tickets"))).toBe(false)
  })
})
