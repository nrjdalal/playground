import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parsePlan, readPlan } from "../../../../../../api/hono/src/lib/apps/plan"
import { inFixture, onLiveDashboard } from "../../../../../dashboard-fixture"

const dir = mkdtempSync(join(tmpdir(), "plan-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

const item = (id: string, patch: Record<string, unknown> = {}) => ({
  bundle: id,
  dependsOn: [],
  difficulty: 2,
  estimateHours: 1,
  finish: "2026-10-06T20:51:00+00:00",
  outcome: `What ${id} does, in plain words.`,
  id,
  priority: "P1",
  start: "2026-10-06T19:57:00+00:00",
  status: "READY",
  title: `Item ${id}`,
  visible: true,
  ...patch,
})

const plan = (
  lanes: unknown[] = [{ id: "easy", items: [item("24")], title: "Easy", worker: "worker-a" }],
) => ({
  doneToday: [
    {
      at: "2026-10-06T18:22:29Z",
      outcome: "Merged in plain words.",
      pr: "#106",
      url: "https://github.com/example/app/pull/106",
    },
  ],
  generatedAt: "2026-10-06T18:34:00+00:00",
  inFlight: [
    {
      eta: "2026-10-06T19:57:00Z",
      id: "19",
      outcome: "Being built.",
      pr: null,
      worker: "worker-a",
    },
  ],
  landingNext: [{ finish: "2026-10-06T20:51:00+00:00", id: "24", title: "Item 24" }],
  lanes,
  later: [{ id: "12", why: "parked" }],
})

const parse = (value: unknown) => parsePlan(JSON.stringify(value))

describe("parsePlan", () => {
  test("reads a whole plan with no problem, keeping the plan's order", () => {
    const { plan: read, problems } = parse(
      plan([
        { id: "easy", items: [item("24"), item("25")], title: "Easy", worker: "worker-a" },
        { id: "hard", items: [item("14a")], title: "Hard", worker: null },
      ]),
    )
    expect(problems).toEqual([])
    expect(read?.lanes.map((lane) => lane.items.map((i) => i.id))).toEqual([["24", "25"], ["14a"]])
    expect(read?.landingNext).toHaveLength(1)
    expect(read?.inFlight[0]?.worker).toBe("worker-a")
    expect(read?.doneToday[0]?.url).toBe("https://github.com/example/app/pull/106")
  })

  test("refuses an item with no outcome line and names it, keeping the rest of its lane", () => {
    const { outcome: _, ...bare } = item("25")
    const { plan: read, problems } = parse(
      plan([{ id: "easy", items: [item("24"), bare, item("26", { outcome: "" })], title: "Easy" }]),
    )
    expect(read?.lanes[0]?.items.map((i) => i.id)).toEqual(["24"])
    expect(problems).toHaveLength(2)
    expect(problems[0]).toStartWith("lanes.0.items.1.outcome:")
    expect(problems[1]).toStartWith("lanes.0.items.2.outcome:")
  })

  test("an item whose only faults are in keys it can do without keeps its row without them", () => {
    const { plan: read, problems } = parse(
      plan([
        {
          id: "easy",
          items: [item("24", { difficulty: "hard", pr: "#5", start: "soon" })],
          title: "Easy",
        },
      ]),
    )
    const kept = read?.lanes[0]?.items[0]
    expect(kept?.id).toBe("24")
    expect(kept?.difficulty).toBeUndefined()
    expect(kept?.pr).toBeUndefined()
    expect(kept?.start).toBeUndefined()
    expect(problems).toHaveLength(1)
    expect(problems[0]).toEndWith("(ignored)")
  })

  test("a lane off its shape is dropped alone, and a part that is not a list reads as empty", () => {
    const value = {
      ...plan([{ items: [] }, { id: "easy", items: [item("24")], title: "Easy" }]),
      inFlight: "none",
    }
    const { plan: read, problems } = parse(value)
    expect(read?.lanes.map((lane) => lane.id)).toEqual(["easy"])
    expect(read?.inFlight).toEqual([])
    expect(problems.some((p) => p.startsWith("lanes.0.id:"))).toBe(true)
    expect(problems).toContain("inFlight: not a list (ignored)")
  })

  test("an item listed twice, in its lane or another, keeps its first row and is named", () => {
    const { plan: read, problems } = parse(
      plan([
        { id: "easy", items: [item("24"), item("24")], title: "Easy" },
        { id: "hard", items: [item("24"), item("14a")], title: "Hard" },
        { id: "easy", items: [], title: "Easy again" },
      ]),
    )
    expect(read?.lanes.map((lane) => lane.items.map((i) => i.id))).toEqual([["24"], ["14a"]])
    expect(problems).toEqual([
      "lanes.0.items.1: 24 is listed twice",
      "lanes.1.items.0: 24 is listed twice",
      "lanes.2: easy is listed twice",
    ])
  })

  test("a file that is not JSON, or has no lanes, is no plan, with the fault named", () => {
    expect(parsePlan("{")).toEqual({ plan: null, problems: ["plan.json is not valid JSON"] })
    const { plan: read, problems } = parse({ generatedAt: "2026-10-06T18:34:00Z" })
    expect(read).toBeNull()
    expect(problems[0]).toStartWith("lanes:")
  })
})

// A "now" stamp is the clock's: one typed ahead (plan.json's generatedAt read 01:22Z at 00:43Z, 31 Oct) is refused, while an ETA or a finish, future by design, reads.
describe("parsePlan refuses a now stamp ahead of the clock", () => {
  const now = new Date("2026-10-06T18:40:00Z")
  const ahead = "2026-10-06T18:45:00Z"

  test("a generatedAt ahead is no plan, named, and one within the slack reads", () => {
    expect(parsePlan(JSON.stringify({ ...plan(), generatedAt: ahead }), now)).toEqual({
      plan: null,
      problems: [`generatedAt: ${ahead} is ahead of the clock`],
    })
    expect(
      parsePlan(JSON.stringify({ ...plan(), generatedAt: "2026-10-06T18:41:30Z" }), now).plan,
    ).not.toBeNull()
  })

  test("an inFlight since or a doneToday at ahead costs that stamp alone, named", () => {
    const value = plan()
    value.inFlight[0] = { ...value.inFlight[0]!, since: ahead } as (typeof value.inFlight)[0]
    value.doneToday[0] = { ...value.doneToday[0]!, at: ahead }
    const { plan: read, problems } = parsePlan(JSON.stringify(value), now)
    expect(read?.inFlight.map((row) => [row.id, row.since])).toEqual([["19", undefined]])
    expect(read?.doneToday.map((row) => [row.pr, row.at])).toEqual([["#106", undefined]])
    expect(problems).toEqual([
      `doneToday.0.at: ${ahead} is ahead of the clock (ignored)`,
      `inFlight.0.since: ${ahead} is ahead of the clock (ignored)`,
    ])
  })

  test("a decision's at ahead is named", () => {
    const { plan: read, problems } = parsePlan(
      JSON.stringify({
        ...plan(),
        decisions: [{ at: "2026-10-06T18:00:00Z" }, { at: ahead, id: "d2" }],
      }),
      now,
    )
    expect(read).not.toBeNull()
    expect(problems).toEqual([`decisions.1.at: ${ahead} is ahead of the clock`])
  })

  test("an inFlight eta and a lane item's start and finish ahead read, as they are future by design", () => {
    const { plan: read, problems } = parsePlan(
      JSON.stringify(plan()),
      new Date("2026-10-06T18:35:00Z"),
    )
    expect(problems).toEqual([])
    expect(read?.inFlight[0]?.eta).toBe("2026-10-06T19:57:00Z")
    expect(read?.lanes[0]?.items[0]?.finish).toBe("2026-10-06T20:51:00+00:00")
  })
})

describe("readPlan", () => {
  test("a missing file is no plan and no problem", async () => {
    expect(await readPlan(join(dir, "missing.json"))).toEqual({
      plan: null,
      problems: [],
      stale: false,
    })
  })

  test("a file that stops reading keeps its last good read in view, marked stale, with the fault", async () => {
    const file = join(dir, "plan.json")
    writeFileSync(file, JSON.stringify(plan()))
    const good = await readPlan(file)
    expect(good.stale).toBe(false)
    expect(good.plan?.lanes[0]?.items[0]?.id).toBe("24")
    writeFileSync(file, "{ not json")
    utimesSync(file, new Date(), new Date(Date.now() + 5_000))
    const bad = await readPlan(file)
    expect(bad.stale).toBe(true)
    expect(bad.plan).toEqual(good.plan)
    expect(bad.problems).toEqual(["plan.json is not valid JSON"])
  })

  test("a file that never read is an empty plan with the fault", async () => {
    const file = join(dir, "never.json")
    writeFileSync(file, "[]")
    const read = await readPlan(file)
    expect(read.plan).toBeNull()
    expect(read.stale).toBe(false)
    expect(read.problems).toHaveLength(1)
  })

  test("a path that cannot be read is a problem, never a thrown error", async () => {
    const folder = join(dir, "folder.json")
    mkdirSync(folder)
    const read = await readPlan(folder)
    expect(read.plan).toBeNull()
    expect(read.problems[0]).toStartWith("plan.json could not be read")
  })

  test.skipIf(onLiveDashboard())(
    "a fixture stack's plan is playground/bundles/plan.json in its fixture",
    async () => {
      const { code, result, stderr } = await inFixture(
        `const { planPath } = await import(\`\${API}/lib/apps/plan\`)\nconsole.log(JSON.stringify(planPath()))`,
        dir,
      )
      expect(stderr).toBe("")
      expect(code).toBe(0)
      expect(result).toBe(join(dir, "fixture", "claude", "playground", "bundles", "plan.json"))
    },
  )

  test.skipIf(onLiveDashboard())(
    "a fixture stack reads its fixture's made-up plan, every item with its line",
    async () => {
      const { code, result, stderr } = await inFixture(
        `const { readPlan } = await import(\`\${API}/lib/apps/plan\`)\nconsole.log(JSON.stringify(await readPlan()))`,
        dir,
      )
      expect(stderr).toBe("")
      expect(code).toBe(0)
      const read = result as Awaited<ReturnType<typeof readPlan>>
      expect(read.problems).toEqual([])
      const items = read.plan?.lanes.flatMap((lane) => lane.items) ?? []
      expect(items.length).toBeGreaterThan(0)
      for (const i of items) expect(i.outcome).toStartWith("Fixture")
    },
  )
})
