import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { beat, capacityLog, minutesAgo, others, placing, spawn, usage, zai } from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

describe("the capacity gate refuses and spawns nothing", () => {
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
    expect(capacityLog(glm)).toEqual([
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
    expect(capacityLog(glm)).toEqual([
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
    expect(capacityLog(glm)).toEqual([
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
    expect(capacityLog(r)).toEqual([
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
    expect(capacityLog(r)[0].readings).not.toHaveProperty("live")
    const glm = await spawn(["worker", "worker-brave-otter", "b.md", "--backend", "glm"], [])
    expect(glm.code).toBe(0)
    expect(capacityLog(glm)).toEqual([
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
