import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine } from "./run-slot-fake"

// a check waits on its run's exit or a line it prints, so the timeout only catches a hang
setDefaultTimeout(60_000)

const slots = (m: ReturnType<typeof machine>) =>
  Bun.spawnSync(["bash", SCRIPT, "slots"], { cwd: m.root, env: m.env() }).stdout.toString()

// Claude Code's sandbox refuses the sysctl command's name lookup, every kern.memorystatus_* reading, the setuid ps, a raised priority, and a signal to any process outside it; the sandboxed machine's fakes refuse the first three.
describe("run-slot.sh under Claude Code's sandbox", () => {
  test("a slot whose holder it may not signal stays held, since the kernel refusing a signal finds the process alive", async () => {
    const m = machine({ sandboxed: true })
    mkdirSync(join(m.ops, "run-slot"))
    // pid 1 is root's, so kill -0 is refused as the sandbox refuses it for a process outside
    writeFileSync(join(m.ops, "run-slot.holder"), "worker-outside 1 2026-11-02T16:00:00Z 1 small\n")
    expect(await m.canTake("run-slot", "worker-probe")).toBe(false)
    expect(existsSync(join(m.ops, "run-slot"))).toBe(true)
  })

  test("the load comes from uptime: load1 at 12 closes the third and fourth slots", () => {
    expect(slots(machine({ sandboxed: true }))).toBe("4\n")
    expect(slots(machine({ load1: 12, sandboxed: true }))).toBe("2\n")
  })

  test("an unread memory reading is said once a run, however many looks it waits", async () => {
    const m = machine({ off: ["run-slot.single"], sandboxed: true })
    m.hold("run-slot", 1, "small")
    const run = m.start("worker-mem")
    const said = /^run-slot\.sh: cannot read the memory /gm
    expect(await run.waits()).toBe(true)
    expect(await run.saw(said)).toBe(true)
    expect(await run.saw(said, 2)).toBe(false)
  })

  test("a run whose nice is refused runs at the default priority and says so", async () => {
    const m = machine()
    // lowering the nice value needs root, so the kernel refuses it as the sandbox refuses any nice
    const run = m.start("worker-nice", { RUN_SLOT_NICE: "-5" })
    expect(
      await run.saw(/run-slot\.sh: runs the command without nice -5 \(Operation not permitted\)/g),
    ).toBe(true)
    expect(await run.ran()).toBe(true)
  })

  // the kernel's process table is read through macOS's sysctl kern.proc, so this runs on a Mac alone
  test.skipIf(process.platform !== "darwin")(
    "what a run leaves in its group is reaped, read from the kernel's process table",
    async () => {
      const m = machine({ sandboxed: true })
      const run = m.start("worker-reap", {}, SCRIPT, ["bash", "-c", 'sleep 60 & touch "$0"'])
      expect(await run.ran()).toBe(true)
      const log = readFileSync(join(m.ops, "run-slot.runs.log"), "utf8")
      const reaped = log.match(/ reap worker-reap \d+ pid=(\d+) sleep$/m)
      expect(reaped, log).not.toBeNull()
      expect(Bun.spawnSync(["kill", "-0", reaped?.[1] ?? "0"]).exitCode).not.toBe(0)
    },
  )
})
