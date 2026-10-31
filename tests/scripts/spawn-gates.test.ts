import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SOURCES, sourceIn } from "../glm-refused-sources"
import { OLD } from "../old-names"
import {
  beat,
  execLine,
  FACTORY_SETTINGS,
  herdrPin,
  homes,
  launchAfterRm,
  launchOf,
  LSTART,
  minutesAgo,
  others,
  paneRun,
  placing,
  resumeFile,
  root,
  scratch,
  script,
  spawn,
  TOKEN,
  usage,
  workers,
  unplugged,
  zai,
} from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

describe("the capacity gate refuses and spawns nothing", () => {
  const logOf = (r: Awaited<ReturnType<typeof spawn>>) =>
    (readFileSync(join(r.home, ".playground", "ops", "capacity.jsonl"), "utf8") || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))

  // No cap on the count of sessions: no count of live sessions or workers holds a spawn; the load, memory and usage gates guard the Mac.
  test.each([30, 50])("%d live sessions, workers among them, hold nothing", async (n) => {
    const r = await spawn(
      ["column", "tester", "tester-x", "worker-x", "w1:p2", "b.md"],
      [...others(n - 8), ...workers(8)],
    )
    expect(r.code).toBe(0)
    expect(logOf(r)).toEqual([expect.objectContaining({ verdict: "pass" })])
  })

  test("load5 at the cores' count, however many sessions are live", async () => {
    const r = await spawn(["runner", "runner-x", "b.md"], [...others(42), ...workers(8)], {
      FAKE_LOAD5: "15.00",
    })
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      "the load gate holds it: max(load1, load5) is 15.00 and 0 started in the last 5 minutes",
    )
    expect(r.err).toContain("the 15 cores")
    expect(logOf(r)).toEqual([expect.objectContaining({ gate: "load", verdict: "refused" })])
  })

  test("a load multiplier raises the cap", async () => {
    const r = await spawn(["runner", "runner-x", "b.md", "--size", "small"], [], {
      FAKE_LOAD5: "16.50",
      PLAYGROUND_LOAD_MULT: "1.2",
    })
    expect(r.code).toBe(0)
    expect(placing(r)).not.toEqual([])
  })

  test("a set load multiplier names itself when the raised cap still holds", async () => {
    const r = await spawn(["runner", "runner-x", "b.md", "--size", "small"], [], {
      FAKE_LOAD5: "18.00",
      PLAYGROUND_LOAD_MULT: "1.2",
    })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(
      "the load gate holds it: max(load1, load5) is 18.00 and 0 started in the last 5 minutes",
    )
    expect(r.err).toContain("at or over 18, the 15 cores at PLAYGROUND_LOAD_MULT 1.2")
  })

  test("a load multiplier that is not a number above 0 refuses", async () => {
    for (const mult of ["0", "1.2x", "inf"]) {
      const r = await spawn(["runner", "runner-x", "b.md"], [], { PLAYGROUND_LOAD_MULT: mult })
      expect(r.code).not.toBe(0)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain(`PLAYGROUND_LOAD_MULT is ${mult}`)
    }
  })

  test("load1 above load5 is the reading that counts", async () => {
    const r = await spawn(["runner", "runner-x", "b.md"], [], {
      FAKE_LOAD1: "20.00",
      FAKE_LOAD5: "2.00",
    })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("max(load1, load5) is 20.00")
  })

  test("starts of the last 5 minutes count toward the cores, and older ones do not", async () => {
    const fresh = [...Array(14)]
      .map(() => JSON.stringify({ at: minutesAgo(1), gate: null, readings: {}, verdict: "pass" }))
      .join("\n")
    const lagged = await spawn(["worker", "worker-brave-otter", "b.md", "--size", "small"], [], {
      CAPACITY_JSONL: `${fresh}\n`,
    })
    expect(lagged.code).not.toBe(0)
    expect(lagged.err).toContain("and 14 started in the last 5 minutes, at or over the 15 cores")
    const old = [...Array(14)]
      .map((_, k) =>
        JSON.stringify({ at: minutesAgo(6 + k), gate: null, readings: {}, verdict: "pass" }),
      )
      .join("\n")
    const settled = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      CAPACITY_JSONL: `${old}\n`,
    })
    expect(settled.code).toBe(0)
  })

  // on 22 Oct load 24 on 15 cores read 55% CPU idle, so the gate also reads the CPU's real use, in cores.
  describe("CPU use", () => {
    test("a load over the line passes while the CPU is mostly idle", async () => {
      const r = await spawn(["runner", "runner-x", "b.md", "--size", "small"], [], {
        FAKE_CPU_IDLE: "55.00",
        FAKE_LOAD5: "24.00",
      })
      expect(r.code).toBe(0)
      expect(placing(r)).not.toEqual([])
      expect(logOf(r)).toEqual([
        expect.objectContaining({
          readings: expect.objectContaining({ cpu_busy: 6.75, cpu_idle: 55 }),
          verdict: "pass",
        }),
      ])
      expect(readFileSync(join(r.home, "top.calls"), "utf8")).toBe("-l 2 -n 0\n")
    })

    test("a load and a CPU use both over the line refuse, naming both", async () => {
      const r = await spawn(["runner", "runner-x", "b.md", "--size", "medium"], [], {
        FAKE_CPU_IDLE: "20.00",
        FAKE_LOAD5: "24.00",
      })
      expect(r.code).not.toBe(0)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain("max(load1, load5) is 24.00 and 0 started in the last 5 minutes")
      expect(r.err).toContain(
        "the CPU is 80% busy (top), 12 of the 15 cores, which with the starts is at or over 11.25 too",
      )
    })

    test("a CPU at its cores' count holds a small start at a multiplied load line", async () => {
      const r = await spawn(["runner", "runner-x", "b.md", "--size", "small"], [], {
        FAKE_LOAD5: "30.00",
        PLAYGROUND_LOAD_MULT: "2",
      })
      expect(r.code).not.toBe(0)
      expect(r.err).toContain("the CPU is 100% busy (top), 15 of the 15 cores")
    })

    test("a load multiplier leaves a medium start's CPU line at the cores less a quarter", async () => {
      const r = await spawn(["runner", "runner-x", "b.md", "--size", "medium"], [], {
        FAKE_CPU_IDLE: "40.00",
        FAKE_LOAD5: "24.00",
        PLAYGROUND_LOAD_MULT: "2",
      })
      expect(r.code).toBe(0)
      expect(logOf(r)).toEqual([
        expect.objectContaining({
          readings: expect.objectContaining({ cpu_busy: 9 }),
          verdict: "pass",
        }),
      ])
    })

    test("the starts of the last 5 minutes count toward the CPU's line too", async () => {
      const passes = [...Array(2)]
        .map(() =>
          JSON.stringify({
            at: minutesAgo(1),
            gate: null,
            readings: { units: 2 },
            verdict: "pass",
          }),
        )
        .join("\n")
      const r = await spawn(["runner", "runner-x", "b.md", "--size", "medium"], [], {
        CAPACITY_JSONL: `${passes}\n`,
        FAKE_CPU_IDLE: "30.00",
        FAKE_LOAD5: "24.00",
      })
      expect(r.code).not.toBe(0)
      expect(r.err).toContain("the CPU is 70% busy (top), 10.5 of the 15 cores")
    })

    test("a start under the line never reads the CPU", async () => {
      const r = await spawn(["runner", "runner-x", "b.md", "--size", "small"], [])
      expect(r.code).toBe(0)
      expect(existsSync(join(r.home, "top.calls"))).toBe(false)
    })

    test("a CPU use it cannot read leaves the load alone to decide", async () => {
      const r = await spawn(["runner", "runner-x", "b.md", "--size", "small"], [], {
        FAKE_LOAD5: "24.00",
        FAKE_TOP_BROKEN: "1",
      })
      expect(r.code).not.toBe(0)
      expect(r.err).toContain("max(load1, load5) is 24.00")
      expect(r.err).toContain("it cannot read the CPU use (top), so the load alone decides")
    })
  })

  test("a malformed line in the log costs itself alone, the starts count reads on", async () => {
    const fresh = [...Array(14)]
      .map(() => JSON.stringify({ at: minutesAgo(1), gate: null, readings: {}, verdict: "pass" }))
      .join("\n")
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--size", "small"], [], {
      CAPACITY_JSONL: `${fresh}\nnot json\n`,
    })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain("and 14 started in the last 5 minutes, at or over the 15 cores")
  })

  // Load is weighed by size, so a big plan never blocks small runs: small, medium and big weigh 1, 2 and 3.
  describe("load units", () => {
    test("a medium start leaves a quarter of the cap for small items", async () => {
      const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], { FAKE_LOAD5: "12.00" })
      expect(r.code).not.toBe(0)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain(
        "at or over 11.25: the 15 cores, less the 3.75 kept for small items (this start is medium)",
      )
      expect(logOf(r)).toEqual([
        expect.objectContaining({
          gate: "load",
          readings: expect.objectContaining({ reserve: 3.75, size: "medium", units: 2 }),
        }),
      ])
    })

    test("a small start may use that reserve", async () => {
      const r = await spawn(["worker", "worker-brave-otter", "b.md", "--size", "small"], [], {
        FAKE_LOAD5: "12.00",
      })
      expect(r.code).toBe(0)
      expect(logOf(r)).toEqual([
        expect.objectContaining({
          readings: expect.objectContaining({ size: "small", units: 1 }),
          verdict: "pass",
        }),
      ])
    })

    test("the roster's size counts when --size is not given", async () => {
      const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
        FAKE_LOAD5: "12.00",
        ROSTER_JSON: JSON.stringify({ agents: [{ name: "worker-brave-otter", size: "small" }] }),
      })
      expect(r.code).toBe(0)
    })

    // one test per start, so each start has the whole timeout to itself on a loaded runner
    test.each<{ passes: boolean; role: string; size: string; sizeArgs: string[]; units: number }>([
      { passes: true, role: "reviewer", size: "small", sizeArgs: [], units: 1 },
      { passes: true, role: "tester", size: "small", sizeArgs: [], units: 1 },
      { passes: false, role: "reviewer", size: "medium", sizeArgs: ["--size", "medium"], units: 2 },
      { passes: false, role: "tester", size: "medium", sizeArgs: ["--size", "medium"], units: 2 },
    ])(
      "a $role with no --size starts small, and --size still wins: $size",
      async ({ passes, role, size, sizeArgs, units }) => {
        const column = ["column", role, `${role}-x`, "worker-x", "w1:p2", "r.md", ...sizeArgs]
        const r = await spawn(column, [], { FAKE_LOAD5: "12.00" })
        if (passes) expect(r.code).toBe(0)
        else expect(r.code).not.toBe(0)
        expect(logOf(r)).toEqual([
          expect.objectContaining({ readings: expect.objectContaining({ size, units }) }),
        ])
      },
    )

    test("each start of the last 5 minutes weighs half its units", async () => {
      const starts = (units: number) =>
        [...Array(10)]
          .map(() =>
            JSON.stringify({ at: minutesAgo(1), gate: null, readings: { units }, verdict: "pass" }),
          )
          .join("\n")
      const light = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
        CAPACITY_JSONL: `${starts(1)}\n`,
      })
      expect(light.code).toBe(0)
      const heavy = await spawn(["worker", "worker-brave-otter", "b.md", "--size", "small"], [], {
        CAPACITY_JSONL: `${starts(3)}\n`,
      })
      expect(heavy.code).not.toBe(0)
      expect(heavy.err).toContain("and 15 started in the last 5 minutes, at or over the 15 cores")
    })

    test("--size takes small, medium or big alone", async () => {
      const r = await spawn(["worker", "worker-brave-otter", "b.md", "--size", "huge"], [])
      expect(r.code).toBe(2)
      expect(r.err).toContain('--size takes small, medium or big, not "huge"')
    })
  })

  test("memory pressure away from normal", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], { FAKE_PRESSURE: "4" })
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      "the memory gate holds it: pressure level is 4 (sysctl kern.memorystatus_vm_pressure_level), 1 or 2 passes",
    )
  })

  test("memory pressure level 2 with room passes", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      FAKE_FREE: "50",
      FAKE_PRESSURE: "2",
    })
    expect(r.code).toBe(0)
  })

  test("memory pressure level 2 at 12% free, this Mac's usual reading, passes (#1249)", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      FAKE_FREE: "12",
      FAKE_PRESSURE: "2",
    })
    expect(r.code).toBe(0)
  })

  test("memory pressure level 2 at the 8% floor passes", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      FAKE_FREE: "8",
      FAKE_PRESSURE: "2",
    })
    expect(r.code).toBe(0)
  })

  test("memory pressure level 2 under the free floor", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      FAKE_FREE: "7",
      FAKE_PRESSURE: "2",
    })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(
      "the memory gate holds it: free is 7% (sysctl kern.memorystatus_level), 8% is the floor",
    )
  })

  test("a pressure level it cannot read", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], { FAKE_PRESSURE: "x" })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(
      "the memory gate holds it: it cannot read the pressure level (sysctl kern.memorystatus_vm_pressure_level)",
    )
  })

  // a GLM session draws no Claude usage, so it starts while memory is normal, swap-ins are under 100/s and load5 is under 30.
  describe("a GLM session's own gate", () => {
    const glm = ["worker", "worker-brave-otter", "b.md", "--backend", "glm"]
    const claude = ["worker", "worker-brave-otter", "b.md"]

    test("a GLM start at load5 20 with normal memory passes, where a Claude start is refused", async () => {
      const allowed = await spawn(glm, [], { FAKE_LOAD5: "20.00" })
      expect(allowed.code).toBe(0)
      expect(placing(allowed)).not.toEqual([])
      const refused = await spawn(claude, [], { FAKE_LOAD5: "20.00" })
      expect(refused.code).not.toBe(0)
      expect(refused.err).toContain("the load gate holds it: max(load1, load5) is 20.00")
    })

    test("a GLM start at swap-ins 150/s is refused", async () => {
      const r = await spawn(glm, [], { FAKE_SWAPINS: "150" })
      expect(r.code).not.toBe(0)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain(
        "the memory gate holds it: swap-ins are 150/s (vm_stat), and a GLM session starts under 100/s",
      )
    })

    test("a GLM start at load5 30 is refused", async () => {
      const r = await spawn(glm, [], { FAKE_LOAD5: "30.00" })
      expect(r.code).not.toBe(0)
      expect(r.err).toContain(
        "the load gate holds it: load5 is 30.00 (sysctl vm.loadavg), and a GLM session starts under 30",
      )
    })

    test("a GLM start at pressure level 2 is refused", async () => {
      const r = await spawn(glm, [], { FAKE_PRESSURE: "2" })
      expect(r.code).not.toBe(0)
      expect(r.err).toContain(
        "the memory gate holds it: pressure level is 2 (sysctl kern.memorystatus_vm_pressure_level), and a GLM session starts at 1 alone",
      )
    })

    test("a GLM start refuses when it cannot read the swap-ins", async () => {
      const r = await spawn(glm, [], { FAKE_VMSTAT_BROKEN: "1" })
      expect(r.code).not.toBe(0)
      expect(r.err).toContain(
        "the memory gate holds it: it cannot read the swap-ins (vm_stat -c 2 1)",
      )
    })
  })

  test("a free share it cannot read", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], { FAKE_FREE: "x" })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(
      "the memory gate holds it: it cannot read the free share (sysctl kern.memorystatus_level)",
    )
  })

  test("free memory under 8%", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], { FAKE_FREE: "5" })
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(
      "the memory gate holds it: free is 5% (sysctl kern.memorystatus_level), 8% is the floor",
    )
  })

  // The gate's lines are settings: a render set that moves one moves what spawn.sh holds a start to, with no edit to spawn.sh.
  describe("the gate's lines as settings", () => {
    const withGates = (values: Record<string, unknown>) => ({
      SETTINGS_JSON: JSON.stringify(values),
    })
    const glm = ["worker", "worker-brave-otter", "b.md", "--backend", "glm"]

    test("gates.glmLoad5Max and gates.glmSwapinsMax move a GLM session's lines", async () => {
      const env = withGates({ "gates.glmLoad5Max": 20, "gates.glmSwapinsMax": 200 })
      const load = await spawn(glm, [], { ...env, FAKE_LOAD5: "20.00" })
      expect(load.err).toContain(
        "the load gate holds it: load5 is 20.00 (sysctl vm.loadavg), and a GLM session starts under 20",
      )
      const swap = await spawn(glm, [], { ...env, FAKE_SWAPINS: "150" })
      expect(swap.code, swap.err).toBe(0)
    })

    test("gates.memoryFreeMin moves the free floor", async () => {
      const env = withGates({ "gates.memoryFreeMin": 10 })
      const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
        ...env,
        FAKE_FREE: "9",
      })
      expect(r.err).toContain(
        "the memory gate holds it: free is 9% (sysctl kern.memorystatus_level), 10% is the floor",
      )
    })

    test("gates.smallReserve moves the share kept for small items", async () => {
      const env = withGates({ "gates.smallReserve": 0.5 })
      const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
        ...env,
        FAKE_LOAD5: "8.00",
      })
      expect(r.err).toContain(
        "at or over 7.5: the 15 cores, less the 7.5 kept for small items (this start is medium)",
      )
    })

    // ops, 31 Oct: another factory's starts on this Mac never reached this gate, and the two together took load1 to 77
    test("slots.peers counts another factory's starts from its own log beside this one's", async () => {
      const peer = mkdtempSync(join(tmpdir(), "peer-ops-"))
      const fresh = [...Array(14)]
        .map(() => JSON.stringify({ at: minutesAgo(1), gate: null, readings: {}, verdict: "pass" }))
        .join("\n")
      writeFileSync(join(peer, "capacity.jsonl"), `${fresh}\n`)
      const args = ["worker", "worker-brave-otter", "b.md", "--size", "small"]
      try {
        const alone = await spawn(args, [])
        expect(alone.code, alone.err).toBe(0)
        const r = await spawn(args, [], withGates({ "slots.peers": [peer] }))
        expect(r.err).toContain("and 14 started in the last 5 minutes, at or over the 15 cores")
        expect(readFileSync(join(peer, "capacity.jsonl"), "utf8")).toBe(`${fresh}\n`)
      } finally {
        rmSync(peer, { force: true, recursive: true })
      }
    })

    test("gates.startsWindow moves how long a start counts", async () => {
      const env = withGates({ "gates.startsWindow": 600 })
      const older = [...Array(14)]
        .map(() => JSON.stringify({ at: minutesAgo(6), gate: null, readings: {}, verdict: "pass" }))
        .join("\n")
      const r = await spawn(["worker", "worker-brave-otter", "b.md", "--size", "small"], [], {
        ...env,
        CAPACITY_JSONL: `${older}\n`,
      })
      expect(r.err).toContain("and 14 started in the last 10 minutes, at or over the 15 cores")
    })
  })

  const capResetsAt = new Date(Date.now() + 3_600_000)
  // Each row builds its file inside the test, so no stamp is older than the moment the case runs.
  const claudeUsageRefusals: [string, () => string, ...string[]][] = [
    [
      "usage.json unreadable",
      () => "{ nope",
      "the usage gate holds it: it cannot read",
      "usage.json (does not read)",
    ],
    [
      "usage.json stale",
      () => JSON.stringify(usage({ writtenAt: minutesAgo(16) })),
      "the usage gate holds it: usage.json was written 16 minutes ago (writtenAt), 15 is its limit",
      "The ops-usage job writes it every 5 minutes; wait for its next run and try again.",
    ],
    [
      "the 5-hour window at its cap",
      () =>
        JSON.stringify(
          usage({
            rate_limits: {
              five_hour: { used_percentage: 90, resets_at: capResetsAt.toISOString() },
              seven_day: {
                used_percentage: 20,
                resets_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
              },
            },
          }),
        ),
      "the usage gate holds it: the 5-hour window is at 90% (usage.json five_hour.used_percentage), 90 is its cap",
      `. It resets ${capResetsAt.toISOString().slice(11, 16)} UTC.`,
    ],
    [
      "the week past its pace",
      () =>
        JSON.stringify(
          usage({
            rate_limits: {
              five_hour: {
                used_percentage: 10,
                resets_at: new Date(Date.now() + 3_600_000).toISOString(),
              },
              seven_day: {
                used_percentage: 29,
                resets_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
              },
            },
          }),
        ),
      "the usage gate holds it: the week is at 29% (usage.json seven_day.used_percentage), past 14.3 points a day (2.0 days in, 28.6 is its pace)",
    ],
    [
      "no week share",
      () => JSON.stringify(usage({ rate_limits: { five_hour: usage().rate_limits.five_hour } })),
      "the usage gate holds it: usage.json holds no week share",
    ],
  ]
  for (const [name, raw, ...says] of claudeUsageRefusals) {
    test(`Claude usage: ${name} is refused`, async () => {
      const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], { USAGE_JSON: raw() })
      expect(r.code).not.toBe(0)
      expect(placing(r)).toEqual([])
      for (const fragment of says) expect(r.err).toContain(fragment)
      // the row carries the words the refusal printed, so the log alone names why
      const detail = r.err.match(/the usage gate holds it: (.*)/)?.[1]
      expect(logOf(r)).toEqual([
        expect.objectContaining({ detail, gate: "usage", verdict: "refused" }),
      ])
    })
  }

  // A fresh install has no usage.json until its usage job first runs, which nothing in the app starts: a file never written passes every start, the dispatcher's and each worker's it starts, and its row says so; one that exists still has to read, be fresh and be under its limits.
  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md"]],
    ["the dispatcher", ["manager", "dispatcher", "b.md"]],
  ])("Claude usage: %s starts while usage.json has never been written", async (_, args) => {
    const r = await spawn(args, [], { USAGE_JSON: "absent" })
    expect(r.err).not.toContain("the usage gate holds it")
    expect(r.code).toBe(0)
    expect(placing(r)).not.toEqual([])
    expect(logOf(r)).toEqual([
      expect.objectContaining({
        gate: null,
        readings: expect.objectContaining({ usage: "unread (usage.json not yet written)" }),
        verdict: "pass",
      }),
    ])
  })

  test("a session on --account with no usage.json yet skips the usage check as before", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--account", "spare@example.com"],
      [],
      { USAGE_JSON: "absent" },
    )
    expect(r.code).toBe(0)
    expect(logOf(r)).toEqual([
      expect.objectContaining({
        readings: expect.objectContaining({
          usage: "skipped (--account spare@example.com, whose usage this machine does not read)",
        }),
        verdict: "pass",
      }),
    ])
  })

  // The week-pace override: a future time in usage-pace-off-until lets a week past its pace through,
  // the 5-hour cap and a 98% sanity backup still hold, and anything else leaves the pace check on.
  const weekAt = (week: number, fiveHour = 10, daysIn = 2) =>
    JSON.stringify(
      usage({
        rate_limits: {
          five_hour: {
            used_percentage: fiveHour,
            resets_at: new Date(Date.now() + 3_600_000).toISOString(),
          },
          seven_day: {
            used_percentage: week,
            resets_at: new Date(Date.now() + (7 - daysIn) * 86_400_000).toISOString(),
          },
        },
      }),
    )
  // A whole-second time a day out, written as OLD.dispatcher would (IST), and the UTC form the pass line names.
  const offUntil = new Date(Math.floor(Date.now() / 1000 + 86_400) * 1000)
  const offUntilUtc = `${offUntil.toISOString().slice(0, 19)}Z`
  const offUntilIst = `${new Date(offUntil.getTime() + 19_800_000).toISOString().slice(0, 19)}+05:30`
  const paceMessage =
    "the usage gate holds it: the week is at 29% (usage.json seven_day.used_percentage), past 14.3 points a day (2.0 days in, 28.6 is its pace)"

  test("Claude usage: a future pace-off time lets a week past its pace through, and the pass line names the skip", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      PACE_OFF_UNTIL: `${offUntilIst}\n`,
      USAGE_JSON: weekAt(29),
    })
    expect(r.code).toBe(0)
    expect(placing(r)).not.toEqual([])
    expect(logOf(r)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        readings: expect.objectContaining({
          pace: `skipped until ${offUntilUtc} (usage-pace-off-until)`,
          week: 29,
        }),
      }),
    ])
  })

  // the pace never sits below one day's share, so a week that has just reset is not refused for its first points.
  test("Claude usage: a week at 2% that reset 0.1 days ago passes, on its first day's share", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      USAGE_JSON: weekAt(2, 10, 0.1),
    })
    expect(r.code).toBe(0)
    expect(placing(r)).not.toEqual([])
  })

  test("Claude usage: a week at 30% one day in is still refused, past that first day's share", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      USAGE_JSON: weekAt(30, 10, 1),
    })
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      "the usage gate holds it: the week is at 30% (usage.json seven_day.used_percentage), past 14.3 points a day (1.0 days in, 14.3 is its pace)",
    )
  })

  const paceStaysOn: { label: string; until?: string }[] = [
    { label: "a past time", until: `${new Date(Date.now() - 60_000).toISOString().slice(0, 19)}Z` },
    { label: "a missing file" },
    { label: "an empty file", until: "" },
    { label: "a time that does not parse", until: "Tuesday 21:29 IST" },
    { label: "a time with no zone", until: offUntilUtc.slice(0, 19) },
  ]
  for (const { label, until } of paceStaysOn) {
    test(`Claude usage: the week past its pace is still refused with ${label} in usage-pace-off-until`, async () => {
      const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
        ...(until === undefined ? {} : { PACE_OFF_UNTIL: until }),
        USAGE_JSON: weekAt(29),
      })
      expect(r.code).not.toBe(0)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain(paceMessage)
    })
  }

  test("Claude usage: the 5-hour cap still refuses at 90% with a future pace-off time", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      PACE_OFF_UNTIL: offUntilUtc,
      USAGE_JSON: weekAt(29, 90),
    })
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      "the usage gate holds it: the 5-hour window is at 90% (usage.json five_hour.used_percentage), 90 is its cap",
    )
  })

  test("Claude usage: with a future pace-off time, a week at 97.9% passes and one at 98% meets the sanity backup", async () => {
    const under = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      PACE_OFF_UNTIL: offUntilUtc,
      USAGE_JSON: weekAt(97.9),
    })
    expect(under.code).toBe(0)
    expect(placing(under)).not.toEqual([])
    const at = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      PACE_OFF_UNTIL: offUntilUtc,
      USAGE_JSON: weekAt(98),
    })
    expect(at.code).not.toBe(0)
    expect(placing(at)).toEqual([])
    expect(at.err).toContain(
      `the usage gate holds it: the week is at 98% (usage.json seven_day.used_percentage), and 98% is the sanity backup while the pace check is off until ${offUntilUtc} (usage-pace-off-until)`,
    )
  })

  test("a session on --account skips the usage check, since the readings name one login", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--account", "spare@example.com"],
      [],
      { USAGE_JSON: JSON.stringify(usage({ writtenAt: minutesAgo(16) })) },
    )
    expect(r.code).toBe(0)
    expect(logOf(r)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        readings: expect.objectContaining({
          usage: "skipped (--account spare@example.com, whose usage this machine does not read)",
        }),
      }),
    ])
  })

  // a bare spawn starts on the login with the most room this week, among usage.json and each usage-<name>.json.
  const login = (account: string, week: number, written = minutesAgo(0)) =>
    JSON.stringify({ ...JSON.parse(weekAt(week)), account, writtenAt: written })
  const loginFiles =
    (files: Record<string, string>) =>
    (home: string): void => {
      for (const [name, raw] of Object.entries(files))
        writeFileSync(join(home, ".playground", name), raw)
    }

  test("a bare spawn whose own login is at 98% starts on the login with the most room, and says which", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { PACE_OFF_UNTIL: offUntilUtc, USAGE_JSON: weekAt(98) },
      script,
      undefined,
      loginFiles({
        "usage-nd941z.json": login("quilla@example.net", 30, minutesAgo(50)),
        "usage-pride.json": login("pride@example.com", 82),
      }),
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      "no --account, so it starts on quilla@example.net, the login with the most room this week: its week is at 30% (usage-nd941z.json)",
    )
    expect(r.security).toContain(
      "find-generic-password -s playground-claude-oauth -a quilla@example.net",
    )
    expect(launchOf(r)).toContain("-a quilla@example.net -w")
    expect(logOf(r)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        readings: expect.objectContaining({ account: "quilla@example.net", week: 30 }),
      }),
    ])
  })

  test("a bare spawn stays on its own login when that has the most room", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {},
      script,
      undefined,
      loginFiles({ "usage-pride.json": login("pride@example.com", 25) }),
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      "spawn.sh: no --account, so it stays on quilla@example.org, the login with the most room this week: its week is at 20% (usage.json)",
    )
    expect((r.security ?? []).join("\n")).not.toContain("pride@example.com")
    expect(launchOf(r)).not.toContain("CLAUDE_CODE_OAUTH_TOKEN")
  })

  // a bare spawn follows login-flip.json's account split, by smooth weighted round robin over split-picks.json's credits
  const splitFiles =
    (shares: Record<string, number>, credit?: Record<string, number>, age = 0) =>
    (home: string): void => {
      const dir = join(home, ".playground", "ops", "usage")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "login-flip.json"),
        JSON.stringify({ split: { at: Date.now() / 1000 - age * 60, shares } }),
      )
      if (credit) writeFileSync(join(dir, "split-picks.json"), JSON.stringify(credit))
    }

  test("a bare spawn starts on the ending login next in the split, short of 100%, over a login with more room, so its last week is spent before it ends", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { PACE_OFF_UNTIL: offUntilUtc },
      script,
      undefined,
      (h) => {
        loginFiles({
          "usage-spare.json": login("spare@example.com", 10),
          "usage-second.json": login("second@example.com", 95),
        })(h)
        splitFiles({ "spare@example.com": 0.3, "second@example.com": 0.7 })(h)
      },
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      "no --account, so it starts on second@example.com, next in the account split (70% of new sessions): its week is at 95% (usage-second.json)",
    )
    expect(launchOf(r)).toContain("-a second@example.com -w")
    const credit = JSON.parse(
      readFileSync(join(r.home, ".playground", "ops", "usage", "split-picks.json"), "utf8"),
    )
    expect(credit["spare@example.com"]).toBeCloseTo(0.3)
    expect(credit["second@example.com"]).toBeCloseTo(-0.3)
  })

  test("the next bare spawn goes to the login whose credit the split has raised highest", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { PACE_OFF_UNTIL: offUntilUtc },
      script,
      undefined,
      (h) => {
        loginFiles({
          "usage-spare.json": login("spare@example.com", 10),
          "usage-second.json": login("second@example.com", 95),
        })(h)
        splitFiles(
          { "spare@example.com": 0.3, "second@example.com": 0.7 },
          { "spare@example.com": 0.3, "second@example.com": -0.3 },
        )(h)
      },
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain("no --account, so it starts on spare@example.com, next in")
  })

  test("a split 30 minutes old is not followed: the bare spawn takes the login with the most room", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { PACE_OFF_UNTIL: offUntilUtc },
      script,
      undefined,
      (h) => {
        loginFiles({
          "usage-spare.json": login("spare@example.com", 10),
          "usage-second.json": login("second@example.com", 95),
        })(h)
        splitFiles({ "spare@example.com": 0.3, "second@example.com": 0.7 }, undefined, 30)(h)
      },
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      "no --account, so it starts on spare@example.com, the login with the most room this week: its week is at 10% (usage-spare.json)",
    )
  })

  // login-flip.json's split shares accounts it probes with no usage-<name>.json, each reading in its `seen` (#85)
  const probedFiles =
    (seen: Record<string, object>, shares: Record<string, number>) =>
    (home: string): void => {
      const dir = join(home, ".playground", "ops", "usage")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "login-flip.json"),
        JSON.stringify({ seen, split: { at: Date.now() / 1000, shares } }),
      )
    }
  const probed = (week: number, minutes = 10) => ({
    at: Date.now() / 1000 - minutes * 60,
    five: 5,
    fiveReset: Date.now() / 1000 + 3600,
    via: "token",
    week,
    weekReset: Date.now() / 1000 + 5 * 86_400,
  })

  test("a bare spawn whose own login is over its pace starts on an account login-flip probes, by its share in the split (#85)", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { USAGE_JSON: weekAt(98) },
      script,
      undefined,
      probedFiles({ "probed@example.com": probed(20) }, { "probed@example.com": 0.5 }),
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      "no --account, so it starts on probed@example.com, next in the account split (50% of new sessions): its week is at 20% (login-flip.json seen)",
    )
    expect(launchOf(r)).toContain("-a probed@example.com -w")
  })

  test("a probed reading with no 5-hour window passes on its week, and one whose 5-hour window is at 95% does not (#85)", async () => {
    const run = (five: number | null) =>
      spawn(
        ["worker", "worker-brave-otter", "b.md"],
        [],
        { USAGE_JSON: weekAt(98) },
        script,
        undefined,
        probedFiles(
          {
            "probed@example.com": {
              ...probed(20),
              five,
              fiveReset: five === null ? null : Date.now() / 1000 + 3600,
            },
          },
          { "probed@example.com": 0.5 },
        ),
      )
    const none = await run(null)
    expect(none.code).toBe(0)
    expect(launchOf(none)).toContain("-a probed@example.com -w")
    expect((await run(95)).code).not.toBe(0)
  })

  test("a probed reading 60 minutes old is not followed, and the refusal names its age (#85)", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { USAGE_JSON: weekAt(98) },
      script,
      undefined,
      probedFiles({ "probed@example.com": probed(20, 61) }, { "probed@example.com": 0.5 }),
    )
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(
      "probed@example.com (login-flip.json seen): login-flip.json seen was written 61 minutes ago (writtenAt), 60 is its limit",
    )
  })

  test("a bare spawn refuses when every login is over the gate, naming each one's reading", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { PACE_OFF_UNTIL: offUntilUtc, USAGE_JSON: weekAt(98) },
      script,
      undefined,
      loginFiles({
        "usage-spare.json": login("spare@example.com", 99),
        "usage-nd941z.json": login("quilla@example.net", 30, minutesAgo(75)),
      }),
    )
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    for (const fragment of [
      "the usage gate holds it: every login is over it:",
      "quilla@example.org (usage.json): the week is at 98% (usage.json seven_day.used_percentage)",
      "spare@example.com (usage-spare.json): the week is at 99% (usage-spare.json seven_day.used_percentage)",
      "quilla@example.net (usage-nd941z.json): usage-nd941z.json was written 75 minutes ago (writtenAt), 60 is its limit",
    ])
      expect(r.err).toContain(fragment)
  })

  // a resume takes the same pick a start does, a pick stays out of the resume record, and a week at 100% refuses any --account.
  test("a resume given no --account starts on the login with the most room, and says which", async () => {
    const r = await spawn(
      ["resume", "worker-brave-otter", root],
      [],
      { PACE_OFF_UNTIL: offUntilUtc, USAGE_JSON: weekAt(98) },
      script,
      { name: "worker-brave-otter", backend: "claude" },
      loginFiles({ "usage-nd941z.json": login("quilla@example.net", 30) }),
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      "no --account, so it starts on quilla@example.net, the login with the most room this week: its week is at 30% (usage-nd941z.json)",
    )
    expect(launchOf(r)).toContain("-a quilla@example.net -w")
  })

  test("the login a bare start picks stays off its resume record's exec line, so a restore picks again, and on its account line", async () => {
    const r = await spawn(
      ["worker", "worker-x", "b.md", "--runtime", "herdr"],
      [],
      { PACE_OFF_UNTIL: offUntilUtc, USAGE_JSON: weekAt(98) },
      script,
      undefined,
      (home) => {
        herdrPin()(home)
        loginFiles({ "usage-nd941z.json": login("quilla@example.net", 30) })(home)
      },
    )
    expect(r.code).toBe(0)
    expect(launchOf(r)).toContain("-a quilla@example.net -w")
    expect(execLine(r, "worker-x")).not.toContain("--account")
    expect(resumeFile(r, "worker-x")).toContain("\n# account: quilla@example.net\n")
  })

  test.each([
    ["a start", ["worker", "worker-brave-otter", "b.md"]],
    ["a resume", ["resume", "worker-brave-otter", root]],
  ])(
    "%s refuses an --account whose week reads 100%%, naming it and its reading",
    async (_, args) => {
      const r = await spawn(
        [...args, "--account", "quilla@example.net"],
        [],
        {},
        script,
        { name: "worker-brave-otter", backend: "claude" },
        loginFiles({ "usage-nd941z.json": login("quilla@example.net", 100) }),
      )
      expect(r.code).not.toBe(0)
      expect(r.cmux).toBeUndefined()
      expect(r.err).toContain(
        "the usage gate holds it: --account quilla@example.net: its week reads 100% (usage-nd941z.json seven_day.used_percentage)",
      )
    },
  )

  test("an --account whose week reads under 100% still starts, the pace left to its own login", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--account", "quilla@example.net"],
      [],
      {},
      script,
      undefined,
      loginFiles({ "usage-nd941z.json": login("quilla@example.net", 99) }),
    )
    expect(r.code).toBe(0)
    expect(launchOf(r)).toContain("-a quilla@example.net -w")
  })

  test("an --account whose 100% week has since reset still starts", async () => {
    const reset = JSON.parse(login("quilla@example.net", 100))
    reset.rate_limits.seven_day.resets_at = new Date(Date.now() - 3_600_000).toISOString()
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--account", "quilla@example.net"],
      [],
      {},
      script,
      undefined,
      loginFiles({ "usage-nd941z.json": JSON.stringify(reset) }),
    )
    expect(r.code).toBe(0)
    expect(launchOf(r)).toContain("-a quilla@example.net -w")
  })

  test("a usage-<name>.json naming this machine's own login is not another login", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      { PACE_OFF_UNTIL: offUntilUtc, USAGE_JSON: weekAt(98) },
      script,
      undefined,
      loginFiles({ "usage-quilla.json": login("quilla@example.org", 10) }),
    )
    expect(r.code).not.toBe(0)
    expect(r.err).toContain(
      "the usage gate holds it: the week is at 98% (usage.json seven_day.used_percentage)",
    )
  })

  // usage.json reads the factory account, while a bare start runs on the config's own login, which ops-usage reads into ops/usage/stored-login.json. usage.json carries no storedLogin here, as when ops-usage cannot read the stored login.
  const factoryUsage = (week: number) => login("factory@example.com", week)
  const storedLogin =
    (account: string, week: number, age = 0) =>
    (home: string) => {
      mkdirSync(join(home, ".playground", "ops", "usage"), { recursive: true })
      writeFileSync(
        join(home, ".playground", "ops", "usage", "stored-login.json"),
        login(account, week, minutesAgo(age)),
      )
    }
  const ownLogin = JSON.stringify({ oauthAccount: { emailAddress: "own@example.com" } })

  test("a bare start is judged by the login it runs on: own login at 98%, factory at 53%, it starts on the factory with --account", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {
        CLAUDE_JSON: ownLogin,
        PACE_OFF_UNTIL: offUntilUtc,
        USAGE_JSON: factoryUsage(53),
      },
      script,
      undefined,
      storedLogin("own@example.com", 98),
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      "no --account, so it starts on factory@example.com, the login with the most room this week: its week is at 53% (usage.json)",
    )
    expect(r.security).toContain(
      "find-generic-password -s playground-claude-oauth -a factory@example.com",
    )
    expect(launchOf(r)).toContain("-a factory@example.com -w")
    expect(logOf(r)).toEqual([
      expect.objectContaining({
        readings: expect.objectContaining({ account: "factory@example.com", week: 53 }),
      }),
    ])
  })

  test("a bare start whose own login and factory are both over the gate refuses, naming the own login's reading", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {
        CLAUDE_JSON: ownLogin,
        PACE_OFF_UNTIL: offUntilUtc,
        USAGE_JSON: factoryUsage(99),
      },
      script,
      undefined,
      storedLogin("own@example.com", 98),
    )
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(
      "own@example.com (stored-login.json): the week is at 98% (ops/usage/stored-login.json seven_day.used_percentage)",
    )
  })

  test("a bare start stays on its own stored login when that has the most room, and names it", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      {
        CLAUDE_JSON: ownLogin,
        PACE_OFF_UNTIL: offUntilUtc,
        USAGE_JSON: factoryUsage(53),
      },
      script,
      undefined,
      storedLogin("own@example.com", 20),
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      "spawn.sh: no --account, so it stays on own@example.com, the login with the most room this week: its week is at 20% (stored-login.json)",
    )
    expect(launchOf(r)).not.toContain("CLAUDE_CODE_OAUTH_TOKEN")
  })

  test.each([
    ["missing", () => {}, "ops/usage/stored-login.json (no such file)"],
    [
      "stale",
      storedLogin("own@example.com", 20, 20),
      "ops/usage/stored-login.json was written 20 minutes ago (writtenAt), 15 is its limit",
    ],
    [
      "naming another account",
      storedLogin("other@example.com", 20),
      "ops/usage/stored-login.json reads other@example.com, not own@example.com",
    ],
  ])(
    "a %s stored-login.json fails the own login, so a bare start never runs on it unjudged",
    async (_, files, reason) => {
      const r = await spawn(
        ["worker", "worker-brave-otter", "b.md"],
        [],
        {
          CLAUDE_JSON: ownLogin,
          PACE_OFF_UNTIL: offUntilUtc,
          USAGE_JSON: factoryUsage(99),
        },
        script,
        undefined,
        files,
      )
      expect(r.code).not.toBe(0)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain("the usage gate holds it: every login is over it:")
      expect(r.err).toContain(reason)
    },
  )

  test("a usage.json without five_hour is an account with no 5-hour limit, read as none rather than 0%, and passes (#85)", async () => {
    const raw = JSON.stringify(usage({ rate_limits: { seven_day: usage().rate_limits.seven_day } }))
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], { USAGE_JSON: raw })
    expect(r.code).toBe(0)
    expect(logOf(r)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        readings: expect.objectContaining({ fiveHour: "none", week: 20 }),
      }),
    ])
  })

  const glmUsageRefusals: [string, () => Record<string, string>, ...string[]][] = [
    [
      "zai-usage.json missing",
      () => ({ ZAI_USAGE_JSON: "absent" }),
      "zai-usage.json (no such file)",
    ],
    [
      "zai-usage.json unreadable",
      () => ({ ZAI_USAGE_JSON: "{ nope" }),
      "zai-usage.json (does not read)",
    ],
    [
      "the meter's heartbeat missing",
      () => ({ ZAI_HEARTBEAT_JSON: "absent" }),
      "it cannot read",
      "ops-zai-usage.json (no such file)",
    ],
    [
      "the meter's last beat not ok",
      () => ({ ZAI_HEARTBEAT_JSON: JSON.stringify(beat({ lastResult: "loop exited" })) }),
      "the zai usage job's last beat is not ok (loop exited, ops-zai-usage.json)",
    ],
    [
      "the meter's beat far stale",
      () => ({ ZAI_HEARTBEAT_JSON: JSON.stringify(beat({ lastBeatAt: minutesAgo(32) })) }),
      "the zai usage job's last beat is 7 cycles old (ops-zai-usage.json), 3 is the limit",
    ],
    [
      "the meter's beat just past three cycles",
      () => ({ ZAI_HEARTBEAT_JSON: JSON.stringify(beat({ lastBeatAt: minutesAgo(16) })) }),
      "the zai usage job's last beat is 4 cycles old (ops-zai-usage.json), 3 is the limit",
    ],
    [
      "the 5-hour credits at their cap",
      () => ({ ZAI_USAGE_JSON: JSON.stringify(zai(26600, 7000)) }),
      "the usage gate holds it: the 5-hour window is at 95% of its credits (zai-usage.json windows.fiveHour), 95 is its cap",
    ],
    [
      "a window the endpoint did not answer",
      () => ({
        ZAI_USAGE_JSON: JSON.stringify({
          windows: { fiveHour: null, week: null },
          writtenAt: new Date().toISOString(),
        }),
      }),
      "the usage gate holds it: zai-usage.json holds no five-hour window",
    ],
    [
      "the meter's beat names no cycle length",
      () => ({ ZAI_HEARTBEAT_JSON: JSON.stringify(beat({ cycleSeconds: 0 })) }),
      "it cannot read ops-zai-usage.json (does not read)",
    ],
  ]
  for (const [name, env, ...says] of glmUsageRefusals) {
    test(`GLM usage: ${name} is refused`, async () => {
      const r = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], env())
      expect(r.code).not.toBe(0)
      expect(placing(r)).toEqual([])
      for (const fragment of says) expect(r.err).toContain(fragment)
    })
  }

  test("GLM usage: the week at 99% passes, there is no week cap", async () => {
    const glm = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], {
      ZAI_USAGE_JSON: JSON.stringify(zai(1400, 138600)),
    })
    expect(glm.code).toBe(0)
    expect(logOf(glm)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        readings: expect.objectContaining({ backend: "glm", fiveHour: 5, week: 99 }),
      }),
    ])
  })

  test("GLM usage: the 5-hour window at 94% passes the gate", async () => {
    const glm = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], {
      ZAI_USAGE_JSON: JSON.stringify(zai(26320, 70000)),
    })
    expect(glm.code).toBe(0)
    expect(logOf(glm)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        readings: expect.objectContaining({ backend: "glm", fiveHour: 94, week: 50 }),
      }),
    ])
  })

  test("GLM usage: a missing week window passes, its reading null", async () => {
    const glm = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], {
      ZAI_USAGE_JSON: JSON.stringify({
        windows: {
          fiveHour: {
            cap: 28000,
            resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
            used: 1400,
          },
          week: null,
        },
        writtenAt: new Date().toISOString(),
      }),
    })
    expect(glm.code).toBe(0)
    expect(logOf(glm)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        readings: expect.objectContaining({ backend: "glm", fiveHour: 5, week: null }),
      }),
    ])
  })

  test("ISO resets_at, the shape an older usage.json holds, reads too", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      USAGE_JSON: JSON.stringify(
        usage({
          rate_limits: {
            five_hour: {
              used_percentage: 10,
              resets_at: new Date(Date.now() + 3_600_000).toISOString(),
            },
            seven_day: {
              used_percentage: 20,
              resets_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
            },
          },
        }),
      ),
    })
    expect(r.code).toBe(0)
  })

  test("a pass appends its readings, and the GLM pass names its backend", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], others(3))
    expect(r.code).toBe(0)
    expect(logOf(r)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        gate: null,
        readings: expect.objectContaining({
          backend: "claude",
          starts: 0,
          cores: 15,
          load5: 2,
          pressure: 1,
          free: 50,
          fiveHour: 10,
          week: 20,
        }),
      }),
    ])
    expect(logOf(r)[0].readings).not.toHaveProperty("live")
    const glm = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [])
    expect(glm.code).toBe(0)
    expect(logOf(glm)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        readings: expect.objectContaining({ backend: "glm", fiveHour: 5, week: 5 }),
      }),
    ])
  })

  test("with no arguments it prints the whole header, the worker line and the pin note included", async () => {
    const r = await spawn([], [])
    expect(r.code).toBe(2)
    expect(r.err).toContain("spawn.sh worker")
    expect(r.err).toContain("backends/<name>")
  })
})

describe("a name a live session holds is refused, so no session starts under a generated name", () => {
  const lead = ["column", "lead", OLD.planner, OLD.dispatcher, "w1:p2", "handoff.md"]

  test(`a live ${OLD.planner} refuses its successor, naming the live session`, async () => {
    const r = await spawn(lead, [{ name: OLD.planner, pid: 5000 }])
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.roster).toBeUndefined()
    expect(r.err).toContain(`a live session already holds the name ${OLD.planner} (pid 5000)`)
    expect(r.err).toContain("close it first")
  })

  test("a live session refuses a resume under its name too", async () => {
    const r = await spawn(
      ["resume", "worker-brave-otter", root],
      [{ name: "worker-brave-otter", pid: 5001 }],
    )
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
  })

  test("an ended session, its pid gone or reused, frees its name", async () => {
    const gone = await spawn(lead, [{ name: OLD.planner, pid: 5002 }], { FAKE_DEAD: "5002" })
    expect(gone.code).toBe(0)
    const reused = await spawn(lead, [
      { name: OLD.planner, pid: 5003, procStart: "Mon Oct 12 01:00:00 2026" },
    ])
    expect(reused.code).toBe(0)
  })

  test("another live session's name does not block it", async () => {
    const r = await spawn(lead, [{ name: `${OLD.planner}-reactive-penguin`, pid: 5004 }])
    expect(r.code).toBe(0)
  })

  // Claude Code 2.1.302 writes a registry file for a `claude -p` run too, its entrypoint sdk-cli where an interactive session's reads cli.
  test("a claude -p run under the name does not block it, while an interactive or Agent SDK session does", async () => {
    const run = (entrypoint: string) => ({
      pid: 5005,
      raw: JSON.stringify({
        entrypoint,
        kind: "interactive",
        name: OLD.planner,
        procStart: LSTART,
      }),
    })
    expect((await spawn(lead, [run("sdk-cli")])).code).toBe(0)
    for (const entrypoint of ["cli", "sdk-ts"]) {
      const live = await spawn(lead, [run(entrypoint)])
      expect(live.err).toContain(`a live session already holds the name ${OLD.planner} (pid 5005)`)
    }
  })
})

describe("a session starts the same on any Mac", () => {
  const command = launchAfterRm

  test("every launch passes the factory's bypass itself, never relying on the machine's settings", async () => {
    const worker = await spawn(["worker", "worker-brave-otter", "b.md"], [])
    expect(command(worker)).toContain(" --dangerously-skip-permissions ")
    const checker = await spawn(["column", "tester", "tester-x", "worker-x", "w1:p2", "b.md"], [])
    expect(command(checker)).toContain(" --dangerously-skip-permissions ")
    const resume = await spawn(["resume", "worker-brave-otter", root], [], {}, undefined, {
      name: "worker-brave-otter",
      backend: "claude",
    })
    expect(command(resume)).toContain(" --dangerously-skip-permissions ")
  })

  test("with no inscope config dir the launch keeps the environment as it is", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], {
      INSCOPE_HOOK: 'export GITHUB_TOKEN="$tok"',
    })
    expect(command(r)).toStartWith("(env PLAYGROUND_ROLE=worker claude ")
  })

  test.each([
    [
      "an inscope hook that exports a config dir",
      { INSCOPE_HOOK: 'export CLAUDE_CONFIG_DIR="$ccd"' },
    ],
    ["inscope's config dir in the environment", { INSCOPE_CCD: "/work/.claude" }],
  ])("with %s the launch drops it, so the session starts logged in", async (_, env) => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], env)
    expect(r.code).toBe(0)
    expect(command(r)).toStartWith(
      "(env -u CLAUDE_CONFIG_DIR -u INSCOPE_CCD PLAYGROUND_ROLE=worker claude ",
    )
  })

  test("with inscope, the live-name check reads the sessions under ~/.claude, where its launches run", async () => {
    const env = { CLAUDE_CONFIG_DIR: "/no/such/inscope/dir", INSCOPE_CCD: "/no/such/inscope/dir" }
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [{ name: "worker-brave-otter", pid: 1000 }],
      env,
    )
    expect(r.err).toContain("a live session already holds the name worker-brave-otter")
  })

  test("the roster write runs this checkout's roster.ts, set alone, keeping a successor's work", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [])
    expect(r.rosterScript).toBe(join(root, "scripts", "roster.ts"))
    expect(r.rosterLog).toEqual([
      "set worker-brave-otter kind=worker surface= title=Plain test work task=b.md",
    ])
  })

  test("a roster failure shows roster.ts's own words", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [], { FAKE_ROSTER_BROKEN: "1" })
    expect(r.rosterLog?.length).toBe(1)
    expect(r.err).toContain("roster.ts says: roster broken")
    expect(r.err).toContain("worker-brave-otter started, but its roster write failed")
  })
})

describe("a worker's prompt names brief-rush.md only while that file exists (#1465)", () => {
  const rush = " ~/.playground/brief-rush.md binds you too, on this Claude lane."

  test("with the file a worker is told it binds it, without it the line is left out", async () => {
    const present = await spawn(["worker", "worker-brave-otter", "b.md"], [], { RUSH: "1" })
    expect(launchOf(present)).toContain(`read it in full and follow it.${rush} Report to builder`)
    const absent = await spawn(["worker", "worker-brave-otter", "b.md"], [])
    expect(launchOf(absent)).toContain("read it in full and follow it. Report to builder")
    expect(launchOf(absent)).not.toContain("brief-rush.md")
  })

  test("a GLM worker is never told, since the rush is a Claude lane's", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], {
      RUSH: "1",
    })
    expect(launchOf(r)).toContain("read it in full and follow it.")
    expect(launchOf(r)).not.toContain("brief-rush.md")
  })

  test("a checker is never told, file or not", async () => {
    const r = await spawn(["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "b.md"], [], {
      RUSH: "1",
    })
    expect(launchOf(r)).toContain("read it in full and follow it.")
    expect(launchOf(r)).not.toContain("brief-rush.md")
  })
})

describe("it fails closed when it cannot read the machine", () => {
  // A missing registry is a Mac that never ran a session, which holds none (spawn.test.ts), so the registry case makes the path one it cannot list.
  const unlistable = (home: string) => {
    mkdirSync(join(home, ".claude"), { recursive: true })
    writeFileSync(join(home, ".claude", "sessions"), "")
  }
  test.each([
    ["a session registry it cannot list", { NO_REGISTRY: "1" }],
    ["ps cannot be read", { FAKE_PS_BROKEN: "1" }],
    ["the load cannot be read", { FAKE_SYSCTL_BROKEN: "1" }],
  ])("%s", async (_name, env) => {
    const setup = "NO_REGISTRY" in env ? unlistable : undefined
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md"],
      [],
      env,
      undefined,
      undefined,
      setup,
    )
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("spawn.sh refuses")
  })
})

describe("it refuses what it cannot spawn safely", () => {
  test.each([
    ["no mode", []],
    ["an unknown mode", ["launch", "worker-a", "b.md"]],
    ["a worker whose name reads as another kind", ["worker", "k3m9px-reviewer", "b.md"]],
    ["a worker under a manager's name", ["worker", OLD.builder, "b.md"]],
    [
      "another model, since every session runs on Opus",
      ["worker", "worker-a", "b.md", "claude-sonnet-5-5"],
    ],
    ["a name with a quote", ["worker", 'worker-a"b', "b.md"]],
    ["a brief with a space", ["worker", "worker-a", "b c.md"]],
    [
      "a checker whose name is not its role's",
      ["column", "reviewer", "tester-x", "worker-x", "w1:p2", "b.md"],
    ],
    [
      "a column role it does not know",
      ["column", "worker", "worker-x", OLD.builder, "w1:p2", "b.md"],
    ],
    ["a surface that is not one", ["column", "tester", "tester-x", "worker-x", "7", "b.md"]],
    ["a resume into a folder that is not there", ["resume", "worker-x", "/no/such/dir"]],
    ["a resume of a session outside the factory", ["resume", "my-notes", "/tmp"]],
    ["a resume of an id that is not one", ["resume", "worker-x", "/tmp", "x;y"]],
  ])("%s", async (_name, args) => {
    const r = await spawn(args, [])
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
  })
})

describe("--account logs the session in as another Claude account", () => {
  const email = "spare@example.com"
  const lookup = `tk="$(security find-generic-password -s playground-claude-oauth -a ${email} -w)" || exit 1; [ -n "$tk" ] || { echo "The playground-claude-oauth item for ${email} holds an empty token; save it again with security add-generic-password -s playground-claude-oauth -a ${email} -w, then respawn." >&2; exit 1; }; CLAUDE_CODE_OAUTH_TOKEN="$tk" `
  const command = launchAfterRm
  const leaks = (r: Awaited<ReturnType<typeof spawn>>) =>
    [...placing(r).flat(), ...(r.roster ?? []), r.out, r.err].join("\n").includes(TOKEN)

  test.each([
    ["worker", ["worker", "worker-brave-otter", "b.md", "--account", email]],
    [
      "column",
      ["column", "lead", OLD.planner, OLD.dispatcher, "w1:p2", "h.md", "--account", email],
    ],
    [
      "resume",
      ["resume", OLD.dispatcher, root, "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27", "--account", email],
    ],
    ["a flag before the mode", ["--account", email, "runner", "runner-calm-heron", "b.md"]],
  ])("%s: the pane's shell reads the token, which spawn.sh never sees", async (_, args) => {
    const r = await spawn(
      args,
      [],
      {},
      undefined,
      args[0] === "resume" ? { name: args[1] as string, backend: "claude" } : undefined,
    )
    expect(r.code).toBe(0)
    expect(command(r)).toStartWith(`(${lookup}env PLAYGROUND_ROLE=`)
    expect(command(r)).not.toContain("--account")
    expect(leaks(r)).toBe(false)
    expect(r.security).toEqual([`find-generic-password -s playground-claude-oauth -a ${email}`])
  })

  test("with inscope's config dir, the lookup comes before the env that drops it", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--account", email], [], {
      INSCOPE_CCD: "/work/.claude",
    })
    expect(command(r)).toStartWith(
      `(${lookup}env -u CLAUDE_CONFIG_DIR -u INSCOPE_CCD PLAYGROUND_ROLE=worker claude -n `,
    )
  })

  test("with no --account the command is what it was, and the Keychain is not asked", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [])
    const home = join(scratch, `home-${homes}`)
    expect(unplugged(command(r))).toBe(
      `(env PLAYGROUND_ROLE=worker claude -n worker-brave-otter --model claude-opus-5-5 --effort high --settings ${home}/.playground/factory-settings-400k.json --dangerously-skip-permissions "You are worker-brave-otter, a worker in the Playground factory; you report to builder. Load the playbook skill first. Your brief is in ~/.playground/b.md: read it in full and follow it. Report to builder with SendMessage (to: builder).")`,
    )
    expect(r.security).toBeUndefined()
  })

  test("an empty token stops the pane before claude runs", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--account", email], [], {
      FAKE_EMPTY_TOKEN: "1",
    })
    const cmd = command(r)
    expect(cmd).toContain("holds an empty token")
    expect(cmd.indexOf('[ -n "$tk" ]')).toBeLessThan(cmd.indexOf(" claude "))
    expect(cmd).not.toContain(TOKEN)
  })

  test("an empty token ends the launch before claude runs", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--account", email], [], {
      FAKE_EMPTY_TOKEN: "1",
    })
    const pane = await paneRun(r, { FAKE_EMPTY_TOKEN: "1" })
    expect(pane.err).toContain("holds an empty token")
    expect(pane.code).toBe(1)
    expect(existsSync(join(r.home, "claude.args"))).toBe(false)
  })

  // A session on the machine's own login shares its usage, which --account's skipped usage check would then never read.
  const own = (email: string) => JSON.stringify({ oauthAccount: { emailAddress: email } })
  test.each([
    ["a worker", ["worker", "worker-brave-otter", "b.md", "--account", email], {}],
    [
      `${OLD.dispatcher}-2`,
      ["manager", `${OLD.dispatcher}-2`, `brief-${OLD.dispatcher}-2.md`, "--account", email],
      { CLAUDE_JSON: own(email.toUpperCase()) },
    ],
  ])("%s on this machine's own login is refused before herdr runs", async (_, args, env) => {
    const r = await spawn(args as string[], [], { CLAUDE_JSON: own(email), ...env })
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.roster).toBeUndefined()
    expect(r.err).toContain(`--account ${email} is this machine's own Claude login`)
  })

  test("the own login is read from the config folder's .claude.json when CLAUDE_CONFIG_DIR is set", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--account", email], [], {
      CLAUDE_JSON: own("quilla@example.org"),
      CONFIG_DIR_CLAUDE_JSON: own(email),
      CLAUDE_CONFIG_DIR: join(scratch, `home-${homes + 1}`, ".claude"),
    })
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain("is this machine's own Claude login")
  })

  test("under inscope, whose folder the launch drops, the own login is read from ~/.claude.json", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--account", email], [], {
      CLAUDE_JSON: own(email),
      CONFIG_DIR_CLAUDE_JSON: own("quilla@example.org"),
      CLAUDE_CONFIG_DIR: join(scratch, `home-${homes + 1}`, ".claude"),
      INSCOPE_CCD: "/work/.claude",
    })
    expect(r.code).toBe(1)
    expect(r.err).toContain("is this machine's own Claude login")
  })

  test.each([
    ["another login", own("quilla@example.org")],
    ["no login", JSON.stringify({ oauthAccount: null })],
    ["a config that does not read", "{"],
  ])("a config naming %s lets --account through", async (_, config) => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--account", email], [], {
      CLAUDE_JSON: config,
    })
    expect(r.code).toBe(0)
  })

  test("an account with no Keychain item is refused before herdr runs", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--account", email], [], {
      FAKE_NO_ITEM: "1",
    })
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.roster).toBeUndefined()
    expect(r.err).toContain(`the Keychain holds no playground-claude-oauth item for ${email}`)
  })

  test.each([
    ["a quote", 'a"b@example.com'],
    ["a space", "a b@example.com"],
    ["a dollar", "$(id)@example.com"],
    ["a backtick", "a`id`@example.com"],
    ["no domain", "acme@"],
    ["no dot in the domain", "acme@localhost"],
    ["a semicolon", "a@example.com;id"],
  ])("an email with %s is refused before the Keychain or herdr", async (_, bad) => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--account", bad], [])
    expect(r.code).toBe(1)
    expect(r.err).toContain("--account takes a plain email")
    expect(r.security).toBeUndefined()
    expect(placing(r)).toEqual([])
  })

  test.each([
    ["no email after it", ["worker", "worker-brave-otter", "b.md", "--account"]],
    ["with an empty email", ["worker", "worker-brave-otter", "b.md", "--account", ""]],
    [
      "empty, then given again",
      ["worker", "worker-a", "b.md", "--account", "", "--account", email],
    ],
    ["given twice", ["worker", "worker-a", "b.md", "--account", email, "--account", email]],
  ])("--account %s is refused", async (_, args) => {
    const r = await spawn(args, [])
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
  })
})

describe("a flag value that starts with -- is refused", () => {
  test.each([
    ["--account", ["worker", "worker-a", "b.md", "--account", "--backend"]],
    ["--backend", ["worker", "worker-a", "b.md", "--backend", "--brief"]],
    [
      "--brief",
      [
        "resume",
        OLD.dispatcher,
        root,
        "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27",
        "--brief",
        "--account",
      ],
    ],
  ])("%s names itself in the refusal", async (flag, args) => {
    const r = await spawn(args, [])
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
    expect(r.err).toContain(`${flag} needs a value;`)
    expect(r.err).toContain(`starts with --`)
  })
})

describe("--backend glm runs the session on Z.ai's GLM through Claude Code", () => {
  const lookup = `tk="$(security find-generic-password -s playground-glm -a zai -w)" || exit 1; [ -n "$tk" ] || { echo "The playground-glm item for zai holds an empty token; save it again with playground accounts add --provider glm --label zai, then respawn." >&2; exit 1; }; ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic ANTHROPIC_AUTH_TOKEN="$tk" ANTHROPIC_DEFAULT_OPUS_MODEL='glm-5.3-flash[1m]' ANTHROPIC_DEFAULT_SONNET_MODEL='glm-5.3-flash[1m]' ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-5.3-flash ENABLE_TOOL_SEARCH=true `
  const command = launchAfterRm

  test("an empty key stops the pane before claude runs", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], {
      FAKE_EMPTY_TOKEN: "1",
    })
    const cmd = command(r)
    expect(cmd).toContain("The playground-glm item for zai holds an empty token")
    expect(cmd.indexOf('[ -n "$tk" ]')).toBeLessThan(cmd.indexOf(" claude "))
  })

  test("an empty key ends the launch before claude runs", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], {
      FAKE_EMPTY_TOKEN: "1",
    })
    const pane = await paneRun(r, { FAKE_EMPTY_TOKEN: "1" })
    expect(pane.err).toContain("The playground-glm item for zai holds an empty token")
    expect(pane.code).toBe(1)
    expect(existsSync(join(r.home, "claude.args"))).toBe(false)
  })

  test.each([
    ["worker", ["worker", "worker-brave-otter", "b.md", "--backend", "glm"]],
    ["column", ["column", "probe", "probe-x", OLD.ops, "w1:p2", "r.md", "--backend", "glm"]],
    [
      "resume",
      ["resume", OLD.dispatcher, root, "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27", "--backend", "glm"],
    ],
    ["a flag before the mode", ["--backend", "glm", "runner", "runner-calm-heron", "b.md"]],
  ])("%s: the pane's shell reads the key, and the model is glm-5.3-flash", async (_, args) => {
    const r = await spawn(args, [])
    expect(r.code).toBe(0)
    expect(command(r)).toStartWith(`(${lookup}env PLAYGROUND_ROLE=`)
    expect(command(r)).toContain(" --model 'glm-5.3-flash[1m]' --effort high ")
    expect(command(r)).not.toContain("claude-opus")
    expect(command(r)).not.toContain("--backend")
    const glm = join(r.home, ".playground", "factory-settings-glm-400k.json")
    expect(command(r).split(" --settings ")).toHaveLength(2)
    expect(command(r)).toContain(` --settings ${glm} --dangerously-skip-permissions`)
    const built = JSON.parse(readFileSync(glm, "utf8"))
    expect(built.hooks).toEqual(FACTORY_SETTINGS.hooks)
    expect(built).toEqual({
      ...FACTORY_SETTINGS,
      autoCompactWindow: 400000,
      enabledPlugins: { "ws-home@ws": false },
      env: {
        ...FACTORY_SETTINGS.env,
        CLAUDE_CODE_ENABLE_TELEMETRY: "0",
        OTEL_METRICS_EXPORTER: "none",
      },
    })
    const seen = [...placing(r).flat(), ...(r.roster ?? []), r.out, r.err].join("\n")
    expect(seen).not.toContain(TOKEN)
    expect(r.security).toEqual(["find-generic-password -s playground-glm -a zai"])
  })

  test("a session on Claude keeps the user's telemetry", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [])
    expect(r.code).toBe(0)
    expect(command(r)).not.toContain("CLAUDE_CODE_ENABLE_TELEMETRY")
    expect(command(r).split(" --settings ")).toHaveLength(2)
    const built = join(r.home, ".playground", "factory-settings-400k.json")
    expect(command(r)).toContain(` --settings ${built} `)
    expect(JSON.parse(readFileSync(built, "utf8")).env).toEqual(FACTORY_SETTINGS.env)
  })

  const loaded =
    "Skill, Read, Bash, Edit and Write are already loaded; ToolSearch lists only deferred tools."

  test.each([
    ["start", ["worker", "worker-brave-otter", "b.md", "--backend", "glm"], {}],
    [
      "resume",
      [
        "resume",
        OLD.dispatcher,
        root,
        "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27",
        "--backend",
        "glm",
        "--brief",
        "b.md",
      ],
      { BRIEF_FILE: "b.md" },
    ],
  ])("a GLM %s's prompt says its core tools are already loaded", async (_, args, extra) => {
    const r = await spawn(args, [], extra)
    expect(r.code).toBe(0)
    expect(command(r)).toContain(`read it in full and follow it. ${loaded}`)
  })

  test("a resume whose backend pin reads glm says its core tools are already loaded", async () => {
    const r = await spawn(
      ["resume", "worker-brave-otter", root, "--brief", "b.md"],
      [],
      { BRIEF_FILE: "b.md" },
      undefined,
      { name: "worker-brave-otter", backend: "glm" },
    )
    expect(r.code).toBe(0)
    expect(command(r)).toContain(`read it in full and follow it. ${loaded}`)
  })

  test("a Claude session's prompt leaves the loaded-tools line out", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md"], [])
    expect(r.code).toBe(0)
    expect(command(r)).not.toContain(loaded)
  })

  test.each([
    ["--backend glm", ["--backend", "glm"]],
    ["Claude", []],
  ])(
    "with no factory settings to build from, %s is refused before herdr runs",
    async (_, extra) => {
      const r = await spawn(["worker", "worker-brave-otter", "b.md", ...extra], [], {
        NO_FACTORY_SETTINGS: "1",
      })
      expect(r.code).toBe(1)
      expect(placing(r)).toEqual([])
      expect(r.err).toContain("it cannot build")
    },
  )

  test("the GLM comment names the plan Max, not Pro", () => {
    const source = readFileSync(script, "utf8")
    expect(source).toContain("Max plan")
    expect(source).not.toContain("Pro plan")
  })

  test.each([
    ["column reviewer", ["column", "reviewer", "reviewer-x", "worker-x", "w1:p2", "r.md"]],
    ["column tester", ["column", "tester", "tester-x", "worker-x", "w1:p2", "t.md"]],
    ["resume reviewer-x", ["resume", "reviewer-x", root, "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"]],
    ["resume tester-x", ["resume", "tester-x", root, "a7e37f18-1fa1-4cb2-a26e-4ff414fd4b27"]],
  ])("a %s stays on Claude: --backend glm is refused before herdr runs", async (_, args) => {
    const r = await spawn([...args, "--backend", "glm"], [])
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.roster).toBeUndefined()
    expect(r.err).toContain("runs on Claude, so it takes no --backend glm")
  })

  test("a backend with no Keychain item is refused before herdr runs", async () => {
    const r = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [], {
      FAKE_NO_ITEM: "1",
    })
    expect(r.code).toBe(1)
    expect(placing(r)).toEqual([])
    expect(r.roster).toBeUndefined()
    expect(r.err).toContain("the Keychain holds no playground-glm item for zai")
  })

  test.each([
    [
      "another backend",
      ["worker", "worker-a", "b.md", "--backend", "openai"],
      "--backend takes glm",
    ],
    [
      "beside a Claude --account",
      ["worker", "worker-a", "b.md", "--backend", "glm", "--account", "spare@example.com"],
      "--account spare@example.com labels no GLM row in usage.accounts, which lists zai",
    ],
  ])("%s is refused before herdr runs", async (_, args, says) => {
    const r = await spawn(args, [])
    expect(r.code).toBe(1)
    expect(r.err).toContain(says)
    expect(placing(r)).toEqual([])
  })

  test("--account names a GLM row by its label, whose Keychain item the pane's shell reads", async () => {
    const r = await spawn(
      ["worker", "worker-brave-otter", "b.md", "--backend", "glm", "--account", "spare"],
      [],
      {
        SETTINGS_JSON: JSON.stringify({
          "usage.accounts": [
            { label: "zai", provider: "glm" },
            { label: "spare", provider: "glm" },
          ],
        }),
      },
    )
    expect(r.code, r.err).toBe(0)
    expect(command(r)).toStartWith(`(${lookup.replaceAll("zai", "spare")}`)
    expect(r.security).toEqual(["find-generic-password -s playground-glm -a spare"])
  })

  test("usage.accounts with no GLM row refuses GLM, naming the command that adds one", async () => {
    const r = await spawn(["worker", "worker-a", "b.md", "--backend", "glm"], [], {
      NO_GLM_ROW: "1",
    })
    expect(r.code).toBe(1)
    expect(r.err).toContain(
      "usage.accounts lists no GLM key: add one with playground accounts add --provider glm --label <label>",
    )
    expect(placing(r)).toEqual([])
  })

  // No guarded org's data reaches GLM, so a brief naming a word of the glm-refused-sources list keeps a session on Claude; the list sits in the data folder's extensions, where a render writes it.
  const listed = (words: unknown) => (home: string) => {
    const root = join(home, ".playground", "extensions")
    mkdirSync(join(root, "hooks"), { recursive: true })
    writeFileSync(
      join(root, "policy.json"),
      JSON.stringify({ orgs: {}, schemaVersion: 1, values: {} }),
    )
    const text = typeof words === "string" ? words : JSON.stringify(words)
    writeFileSync(join(root, "hooks", "glm-refused-sources.json"), text)
  }
  // A null list leaves the extensions out, as on a fresh clone.
  const briefSays =
    (text: string, words: unknown = SOURCES) =>
    (home: string) => {
      if (words !== null) listed(words)(home)
      writeFileSync(join(home, ".playground", "b.md"), text)
    }
  const glmOn = (setup: (home: string) => void, backend = "glm") =>
    spawn(["worker", "worker-a", "b.md", "--backend", backend], [], {}, script, undefined, setup)

  test("a session in a folder named for an org ext.links guards is refused on GLM before herdr runs, with no orgs.map", async () => {
    const r = await spawn(
      ["worker", "worker-a", "b.md", "--backend", "glm", "--in", "{home}/code/acme/app"],
      [],
      { SETTINGS_JSON: JSON.stringify({ "ext.links": { acme: ["acme"] } }) },
      script,
      undefined,
      (home) => {
        mkdirSync(join(home, "code", "acme", "app"), { recursive: true })
        writeFileSync(join(home, ".playground", "b.md"), "A made-up task.\n")
      },
    )
    expect(r.code).toBe(1)
    expect(r.err).toContain(
      "worker-a runs in a checkout of acme, an org ext.links guards, so it runs on Claude",
    )
    expect(placing(r)).toEqual([])
  })

  test("a brief naming a listed source is refused on GLM before herdr runs", async () => {
    const r = await glmOn(briefSays("Read the Example team's Linear board.\n"))
    expect(r.code).toBe(1)
    expect(r.err).toContain(
      "b.md names linear, a source glm-refused-sources keeps off GLM, so it runs on Claude",
    )
    expect(placing(r)).toEqual([])
    expect(r.roster).toBeUndefined()
  })

  test("a brief naming a listed source starts on Claude", async () => {
    const r = await spawn(
      ["worker", "worker-a", "b.md", "--backend", "claude", "--check"],
      [],
      {},
      script,
      undefined,
      briefSays("Read the Example team's Linear board.\n"),
    )
    expect(r.code).toBe(0)
  })

  test.each([
    ["a made-up database by its name", "Query ACME-DB for the rows.\n", "acme-db"],
    ["Slack", "Post the update in Slack.\n", "slack"],
  ])("a brief naming %s is refused on GLM", async (_, text, named) => {
    const r = await glmOn(briefSays(text))
    expect(r.code).toBe(1)
    expect(r.err).toContain(`b.md names ${named}, a source glm-refused-sources keeps off GLM`)
  })

  test("a fresh clone's empty list keeps no brief off GLM", async () => {
    const r = await glmOn(briefSays("Read the Example team's Linear board.\n", null))
    expect(r.err).not.toContain("glm-refused-sources")
  })

  test.each([
    ["malformed", "{ words: ["],
    ["not a list of words", '{"words":[]}'],
  ])("a list that is %s refuses GLM, naming it", async (_, text) => {
    const r = await glmOn(briefSays("Fix the button.\n", text))
    expect(r.code).toBe(1)
    expect(r.err).toContain("glm-refused-sources.json")
    expect(placing(r)).toEqual([])
  })

  const templates = readdirSync(join(root, "scripts", "briefs")).filter((file) =>
    sourceIn(readFileSync(join(root, "scripts", "briefs", file), "utf8")),
  )
  test("the briefs folder holds a template that names a listed source", () => {
    expect(templates.length).toBeGreaterThan(0)
  })
  test.each(templates)(
    "the %s template, which names a listed source, is refused on GLM",
    async (file) => {
      const r = await glmOn(briefSays(readFileSync(join(root, "scripts", "briefs", file), "utf8")))
      expect(r.code).toBe(1)
      expect(r.err).toContain("a source glm-refused-sources keeps off GLM")
    },
  )

  test.each([
    ["no backend after it", ["worker", "worker-a", "b.md", "--backend"]],
    ["given twice", ["worker", "worker-a", "b.md", "--backend", "glm", "--backend", "glm"]],
  ])("--backend %s is refused", async (_, args) => {
    const r = await spawn(args, [])
    expect(r.code).not.toBe(0)
    expect(placing(r)).toEqual([])
  })
})
