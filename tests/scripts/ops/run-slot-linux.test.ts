import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { procDir, type Proc } from "../fixtures/proc"
import { SCRIPT, machine, stop } from "./run-slot-fake"

// a check waits on its run's exit, so the timeout only catches a hang
setDefaultTimeout(60_000)

// how many of run-slot to run-slot-4 are held or open now, on a machine that answers as Ubuntu does, every reading from /proc's recorded text; the gauges take the CPU's two /proc/stat reads, then the two /proc/vmstat reads (#2201)
const look = (proc: Proc, omit: string[] = [], setup: Parameters<typeof machine>[0] = {}) => {
  const m = machine({
    load1: 2,
    load5: 2,
    ...setup,
    proc: procDir(proc, omit, [["stat"], ["vmstat"]]),
  })
  const run = Bun.spawnSync(["bash", SCRIPT, "slots"], { cwd: m.root, env: m.env() })
  return { err: run.stderr.toString(), m, slots: run.stdout.toString() }
}

describe("on Linux the lanes read /proc", () => {
  test("a calm machine opens all four", () => {
    expect(look({ idle: 80 }).slots).toBe("4\n")
  })

  test("the CPU's idle share comes from two /proc/stat reads, and under 40% it shuts slots 2 to 4", () => {
    expect(look({ idle: 39 }).slots).toBe("1\n")
  })

  test("load1 comes from /proc/loadavg, and at 45 it shuts them", () => {
    expect(look({ idle: 80, load1: 45, load5: 2 }).slots).toBe("1\n")
  })

  test("MemAvailable under 40% shuts them", () => {
    expect(look({ free: 39, idle: 80 }).slots).toBe("1\n")
  })

  test("PSI's some avg10 at 10%, pressure level 2, shuts them", () => {
    expect(look({ idle: 80, some: 10 }).slots).toBe("1\n")
  })

  test("pswpin's rise of 100 a second two readings in a row shuts them", () => {
    const m = machine({
      load1: 2,
      load5: 2,
      proc: procDir({ idle: 80, swapins: 100 }, [], [["stat"], ["vmstat"]]),
    })
    writeFileSync(join(m.ops, "run-slot.gauges"), "0 80 100 120 3.50 -\n")
    const run = Bun.spawnSync(["bash", SCRIPT, "slots"], { cwd: m.root, env: m.env() })
    expect(run.stdout.toString()).toBe("1\n")
  })

  test("a lanes line logs the /proc readings", async () => {
    const { m } = look({ free: 64, idle: 80, some: 10 })
    expect(await m.runs("worker-x")).toBe(true)
    expect(await Bun.file(join(m.ops, "run-slot.runs.log")).text()).toMatch(
      / lanes worker-x \d+ shut why=mem idle=\d+(\.\d+)?% load1=1\.25 free=64% pressure=2 swapins=\d+/,
    )
  })
})

describe("on Linux a reading /proc does not give shuts slots 2 to 4, never reading as 0", () => {
  test.each(["meminfo", "pressure/memory", "vmstat"])("with no /proc/%s", (file) => {
    expect(look({ idle: 80 }, [file]).slots).toBe("1\n")
  })
})

describe("on Linux the clones' brake is /proc/stat's core count", () => {
  const clone = async (proc: Proc) => {
    const m = machine({ load1: 2, load5: 2, proc: procDir(proc) })
    mkdirSync(join(m.root, "node_modules"), { recursive: true })
    const run = m.start("worker-c", {}, SCRIPT, ["cp", "-R", "node_modules"])
    if (await run.saw(/^run-slot\.sh: this clone waits /gm)) {
      await stop(run.p)
      return existsSync(run.marker) ? "ran" : "waited"
    }
    return (await run.ran()) ? "ran" : "ended"
  }

  test("on 8 cores a load5 within 4 of the brake waits", async () => {
    expect(await clone({ cores: 8, load1: 2, load5: 4 })).toBe("waited")
  })

  test("on 8 cores a load5 under it starts", async () => {
    expect(await clone({ cores: 8, load1: 2, load5: 3 })).toBe("ran")
  })
})

// The Planner's ruling d-2021p: PLAYGROUND_PROC is read under the test sandbox's marker alone, so a session that sets it cannot feed the lanes a low load: the lanes line names the load uptime or the real /proc gives, never the recorded 7.77.
test("PLAYGROUND_PROC set outside the test runner is never read", async () => {
  const m = machine({ load1: 2, load5: 2, proc: procDir({ free: 80, idle: 80, load1: 7.77 }) })
  expect(await m.runs("worker-x", { TEST_SANDBOX_HOME: "" })).toBe(true)
  expect(await Bun.file(join(m.ops, "run-slot.runs.log")).text()).toMatch(/ lanes /)
  expect(await Bun.file(join(m.ops, "run-slot.runs.log")).text()).not.toContain("load1=7.77")
})
