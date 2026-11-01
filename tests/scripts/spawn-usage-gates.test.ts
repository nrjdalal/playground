import { describe, expect, setDefaultTimeout, test } from "bun:test"

import {
  capacityLog,
  minutesAgo,
  offUntil,
  offUntilUtc,
  placing,
  spawn,
  usage,
  weekAt,
} from "./spawn-fake"

// Every case runs spawn.sh, which starts fake processes and waits on them; one took 19.9s on the loaded runner box, so each gets twice that.
setDefaultTimeout(40_000)

describe("the capacity gate refuses and spawns nothing", () => {
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
      expect(capacityLog(r)).toEqual([
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
    expect(capacityLog(r)).toEqual([
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
    expect(capacityLog(r)).toEqual([
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
  // offUntil written as OLD.dispatcher would (IST).
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
    expect(capacityLog(r)).toEqual([
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
    expect(capacityLog(r)).toEqual([
      expect.objectContaining({
        verdict: "pass",
        readings: expect.objectContaining({
          usage: "skipped (--account spare@example.com, whose usage this machine does not read)",
        }),
      }),
    ])
  })
})
