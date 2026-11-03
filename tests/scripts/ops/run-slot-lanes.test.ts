import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine, type Setup } from "./run-slot-fake"

// a check waits on its run's exit, so the timeout only catches a hang
setDefaultTimeout(60_000)

// how many of run-slot to run-slot-4 are held or open now, and what the run printed on stderr
const look = (m: ReturnType<typeof machine>) => {
  const run = Bun.spawnSync(["bash", SCRIPT, "slots"], { cwd: m.root, env: m.env() })
  return { err: run.stderr.toString(), slots: run.stdout.toString() }
}
const slots = (setup: Setup) => look(machine(setup)).slots
// run-slot.runs.log's lanes lines
const lanes = (m: ReturnType<typeof machine>) => {
  const path = join(m.ops, "run-slot.runs.log")
  return existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => / lanes /.test(line))
    : []
}

// 3 Nov: the factory's resting sessions hold load1 at 14 to 20 on 15 cores while the CPU sits 53 to 67% idle, so the old load1 lines (12 for the third and fourth slots, the cores for the second) left one lane open with 24 to 33 runs waiting
describe("slots 2 to 4 open on the CPU's idle share", () => {
  test("the 05:59Z sample opens all four: load1 18.6 and load5 19.0, over the old lines, with the CPU 52.9% idle", () => {
    expect(slots({ idle: 52.9, load1: 18.6, load5: 19.0 })).toBe("4\n")
  })

  test("at 40% idle all four open", () => {
    expect(slots({ idle: 40, load1: 18 })).toBe("4\n")
  })

  test("under 40% idle slots 2 to 4 shut, and a holder keeps each", () => {
    const m = machine({ idle: 39.9, load1: 2 })
    expect(look(m).slots).toBe("1\n")
    m.hold("run-slot-2", 2, "medium")
    m.hold("run-slot-3", 2, "medium")
    m.hold("run-slot-4", 2, "medium")
    expect(look(m).slots).toBe("4\n")
  })
})

// load1 64 after a burst of starts, 73 after a clone let through at load5 under 30, and 58 at 04:15Z on 3 Nov: a spike shuts the lanes however idle top found the CPU
describe("load1 at 30 is a hard stop", () => {
  test("load1 at 30 shuts slots 2 to 4 at 80% idle", () => {
    expect(slots({ idle: 80, load1: 30 })).toBe("1\n")
  })

  test("the 08:47Z reading shuts them: load1 31 with the CPU 57% idle, its runs waiting on paging", () => {
    expect(slots({ idle: 57, load1: 31 })).toBe("1\n")
  })

  test("load1 at 29 leaves them open", () => {
    expect(slots({ idle: 80, load1: 29.9 })).toBe("4\n")
  })
})

// spawn.sh's swapins() reads vm_stat's swap-ins a second, and a GLM session starts under 100/s
describe("memory shuts slots 2 to 4 as mem_ok reads it", () => {
  test("swap-ins at 100/s shut them, 99/s leave them open", () => {
    expect(slots({ swapins: 100 })).toBe("1\n")
    expect(slots({ swapins: 99 })).toBe("4\n")
  })

  test("a free share under 40% shuts them, as does pressure over normal", () => {
    expect(slots({ free: 39 })).toBe("1\n")
    expect(slots({ pressure: 2 })).toBe("1\n")
  })
})

describe("the gauges", () => {
  test("an unread top shuts slots 2 to 4 and says so once a run", () => {
    const m = machine()
    writeFileSync(join(m.bin, "top"), "#!/bin/bash\nexit 1\n")
    chmodSync(join(m.bin, "top"), 0o755)
    const { err, slots } = look(m)
    expect(slots).toBe("1\n")
    expect(err.match(/^run-slot\.sh: cannot read the CPU's idle share /gm)).toHaveLength(1)
  })

  test("an unread swap-in count shuts them too", () => {
    const m = machine()
    writeFileSync(join(m.bin, "vm_stat"), "#!/bin/bash\nexit 1\n")
    chmodSync(join(m.bin, "vm_stat"), 0o755)
    expect(look(m).slots).toBe("1\n")
  })

  // the first row counts since boot, so with the second sample missing no rate is read, rather than the boot count's 4 a second
  test("a vm_stat that prints its first sample alone shuts them", () => {
    const m = machine()
    writeFileSync(
      join(m.bin, "vm_stat"),
      '#!/bin/bash\necho "Mach Virtual Memory Statistics: (page size of 16384 bytes)"\necho "    free  swapins swapouts"\necho "  203349        4        0"\n',
    )
    chmodSync(join(m.bin, "vm_stat"), 0o755)
    expect(look(m).slots).toBe("1\n")
  })

  test("the rate is the second sample's: 4,049,933 swap-ins since boot and none in the last second leave them open", () => {
    expect(slots({ swapins: 0 })).toBe("4\n")
  })

  test("every look within 10 s shares one top reading, as top's own sample", () => {
    const m = machine()
    look(m)
    look(m)
    expect(readFileSync(join(m.root, "top.log"), "utf8")).toBe("-l 2 -n 0\n")
  })

  test("a run's look records idle% and load1 in run-slot.runs.log when the lanes open and when they shut, and nothing while they stay", async () => {
    const m = machine({ idle: 52.9, load1: 18.6 })
    expect(await m.runs("worker-x")).toBe(true)
    expect(await m.runs("worker-x")).toBe(true)
    expect(lanes(m)).toEqual([
      expect.stringMatching(/^\S+Z lanes worker-x \d+ open idle=52\.9% load1=18\.60 swapins=0$/),
    ])
    writeFileSync(
      join(m.bin, "top"),
      '#!/bin/bash\necho "CPU usage: 1.00% user, 1.00% sys, 98.00% idle "\necho "CPU usage: 40.00% user, 30.00% sys, 30.00% idle "\n',
    )
    // a reading taken at the epoch is past its 10 s, so the next look reads top again
    writeFileSync(join(m.ops, "run-slot.gauges"), "0 52.9 0\n")
    expect(await m.runs("worker-x")).toBe(true)
    expect(lanes(m)).toHaveLength(2)
    expect(lanes(m)[1]).toMatch(/ lanes worker-x \d+ shut idle=30\.00% load1=18\.60 swapins=0$/)
  })

  test("a read subcommand records no lanes line", () => {
    const m = machine()
    look(m)
    expect(lanes(m)).toEqual([])
  })
})

// each switch closes what it closed before the gauges changed
describe("the ops switches work as before", () => {
  test("run-slot.3-off closes the third, and run-slot.4-off the fourth", () => {
    expect(slots({ off: ["run-slot.3-off"] })).toBe("3\n")
    expect(slots({ off: ["run-slot.4-off"] })).toBe("3\n")
  })

  test("run-slot.single leaves run-slot-2 alone open, under load5 22 with memory passing", () => {
    expect(slots({ load1: 21, off: ["run-slot.single"] })).toBe("2\n")
    expect(slots({ load1: 22, off: ["run-slot.single"] })).toBe("1\n")
  })

  test("run-slot.load5-cap lowers single-slot mode's load5 line", () => {
    const capped = (load1: number) => {
      const m = machine({ load1, off: ["run-slot.single"] })
      writeFileSync(join(m.ops, "run-slot.load5-cap"), "12\n")
      return look(m).slots
    }
    expect(capped(11)).toBe("2\n")
    expect(capped(12)).toBe("1\n")
  })
})
