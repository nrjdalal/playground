import { describe, expect, test } from "bun:test"

import type { Plan, PlanItem } from "../../../../../api/hono/src/lib/apps/plan"
import {
  boardColumns,
  queuedIds,
  sameOrder,
  stageOf,
  standing,
} from "../../../../../web/next/src/lib/plan-board"

const item = (id: string, status: string, fields: Partial<PlanItem> = {}): PlanItem => ({
  outcome: `${id} in plain words`,
  id,
  status,
  title: `Item ${id}`,
  ...fields,
})

const plan: Plan = {
  doneToday: [
    {
      at: "2026-10-06T10:00:00Z",
      outcome: "A merged thing",
      pr: "#199",
      url: "https://github.com/a/b/pull/199",
    },
  ],
  generatedAt: "2026-10-06T09:00:00Z",
  inFlight: [],
  landingNext: [],
  lanes: [
    {
      id: "easy",
      items: [
        item("F1", "IN REVIEW", { pr: "https://github.com/a/b/pull/102" }),
        item("F2", "READY", { estimateRange: "1.0-1.4h", tags: ["@web/next", "@tests"] }),
        item("F3", "WAITS ON F2"),
      ],
      title: "Easy",
      worker: "worker-greed",
    },
    {
      id: "medium",
      items: [item("F4", "IN FLIGHT"), item("F5", "READY", { worker: "worker-lust" })],
      title: "Medium",
      worker: null,
    },
  ],
}

describe("stageOf", () => {
  test("reads the planner's status codes, and anything not started is queued", () => {
    expect(stageOf("IN REVIEW")).toBe("review")
    expect(stageOf("IN FLIGHT")).toBe("flight")
    expect(stageOf("MERGED")).toBe("done")
    expect(stageOf("DONE")).toBe("done")
    expect(stageOf("READY")).toBe("queued")
    expect(stageOf("WAITS ON F2")).toBe("queued")
    expect(stageOf(undefined)).toBe("queued")
  })
})

describe("queuedIds", () => {
  test("with no order, each lane's queued items in the plan's order", () => {
    expect(queuedIds(plan, null)).toEqual({ easy: ["F2", "F3"], medium: ["F5"] })
  })

  test("Merritt's order leads, a moved item shows in its new lane, and the rest follow in plan order", () => {
    expect(queuedIds(plan, { easy: ["F3"], medium: ["F2", "F5"] })).toEqual({
      easy: ["F3"],
      medium: ["F2", "F5"],
    })
    expect(queuedIds(plan, { medium: ["F5"] })).toEqual({ easy: ["F2", "F3"], medium: ["F5"] })
  })

  test("an id no longer queued, unknown, or named twice drops out of his order", () => {
    expect(queuedIds(plan, { easy: ["F4", "F9", "F3", "F3"], medium: ["F3"] })).toEqual({
      easy: ["F3", "F2"],
      medium: ["F5"],
    })
  })
})

describe("boardColumns", () => {
  test("a Queued column per lane, then In flight, In review and Done today", () => {
    const columns = boardColumns(plan, queuedIds(plan, null))
    expect(columns.map((c) => [c.title, c.cards.map((card) => card.id)])).toEqual([
      ["Easy · Queued", ["F2", "F3"]],
      ["Medium · Queued", ["F5"]],
      ["In flight", ["F4"]],
      ["In review", ["F1"]],
      ["Done today", ["done:#199"]],
    ])
    expect(columns.map((c) => c.lane)).toEqual(["easy", "medium", null, null, null])
  })

  test("only queued cards drag, and each keeps its worker, lane and estimate", () => {
    const cards = boardColumns(plan, queuedIds(plan, null)).flatMap((c) => c.cards)
    const byId = new Map(cards.map((card) => [card.id, card]))
    expect(cards.filter((card) => card.draggable).map((card) => card.id)).toEqual([
      "F2",
      "F3",
      "F5",
    ])
    expect(byId.get("F2")).toMatchObject({
      estimateRange: "1.0-1.4h",
      lane: "easy",
      worker: "worker-greed",
    })
    expect(byId.get("F2")?.tags).toEqual(["@web/next", "@tests"])
    expect(byId.get("F3")?.tags).toEqual([])
    expect(byId.get("F5")?.worker).toBe("worker-lust")
    expect(byId.get("F1")?.pr).toBe("https://github.com/a/b/pull/102")
    expect(byId.get("done:#199")).toMatchObject({
      pr: "https://github.com/a/b/pull/199",
      title: "A merged thing",
    })
  })
})

describe("sameOrder and standing", () => {
  test("compares lane by lane, and says where a card stands", () => {
    expect(sameOrder({ easy: ["F2"] }, { easy: ["F2"] })).toBe(true)
    expect(sameOrder({ easy: ["F2", "F3"] }, { easy: ["F3", "F2"] })).toBe(false)
    expect(standing({ easy: ["F2", "F3"] }, "F3", { easy: "Easy" })).toBe("in Easy, 2 of 2")
    expect(standing({ easy: [] }, "F9", { easy: "Easy" })).toBe("outside the queues")
  })
})

describe("boardColumns, from the plan's own in-flight list", () => {
  // The live plan keeps work under way in inFlight, with no lane item marked IN FLIGHT or IN REVIEW.
  const live: Plan = {
    ...plan,
    doneToday: [{ outcome: "F7 merged", pr: "#107", url: "https://github.com/a/b/pull/107" }],
    inFlight: [
      { outcome: "F2 being built", id: "F2", worker: "worker-greed" },
      { outcome: "F9 under review", id: "F9", pr: "https://github.com/a/b/pull/109" },
    ],
    lanes: [
      {
        id: "easy",
        items: [
          item("F2", "READY"),
          item("F3", "READY"),
          item("F7", "MERGED", { pr: "https://github.com/a/b/pull/107" }),
        ],
        title: "Easy",
        worker: null,
      },
    ],
  }

  test("an in-flight entry shows under In flight, or In review once it has a pull request, and leaves Queued", () => {
    const ids = queuedIds(live, null)
    expect(ids).toEqual({ easy: ["F3"] })
    const columns = boardColumns(live, ids)
    const byTitle = Object.fromEntries(columns.map((c) => [c.title, c.cards]))
    expect(
      byTitle["In flight"]?.map((card) => [card.id, card.title, card.worker, card.status]),
    ).toEqual([["F2", "Item F2", "worker-greed", null]])
    expect(byTitle["In review"]?.map((card) => [card.id, card.title, card.pr])).toEqual([
      ["F9", "F9 under review", "https://github.com/a/b/pull/109"],
    ])
    expect(byTitle["In flight"]?.every((card) => !card.draggable)).toBe(true)
  })

  test("a merged item shows once in Done today, whether the lane or the merged list names it", () => {
    const done = boardColumns(live, queuedIds(live, null)).find((c) => c.title === "Done today")
    expect(done?.cards.map((card) => card.id)).toEqual(["F7"])
  })
})
