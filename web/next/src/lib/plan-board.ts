import type { Plan, PlanItem, PlanOrder } from "@api/hono"

import { apiClient, unwrap } from "@/lib/api/client"

// The Plan page's board: each lane's queued items, which the owner drags to set what is built first, then what is in flight, in review and done today, which move by themselves.

export type OrderLanes = PlanOrder["lanes"]

export type CardStage = "done" | "flight" | "queued" | "review"

export type BoardCard = {
  draggable: boolean
  estimateRange: string | null
  id: string
  // The lane the plan puts it in, by id, so a card dragged to another lane still says where it came from.
  lane: string | null
  outcome: string
  pr: string | null
  stage: CardStage
  status: string | null
  tags: string[]
  title: string
  worker: string | null
}

export type BoardColumn = {
  cards: BoardCard[]
  // A queued lane's id (easy), else the stage's.
  id: string
  // Only a queued lane takes a drop.
  lane: string | null
  title: string
}

// Pure: where an item stands, from the status the planner gives it. Anything not yet started is queued.
export function stageOf(status: string | null | undefined): CardStage {
  const code = (status ?? "").toUpperCase()
  if (code.startsWith("IN REVIEW")) return "review"
  if (code.startsWith("IN FLIGHT")) return "flight"
  if (code.startsWith("DONE") || code.startsWith("MERGED")) return "done"
  return "queued"
}

const cardOf = (item: PlanItem, lane: { id: string; worker?: string | null }): BoardCard => {
  const stage = stageOf(item.status)
  return {
    draggable: stage === "queued",
    estimateRange: item.estimateRange ?? null,
    id: item.id,
    lane: lane.id,
    outcome: item.outcome,
    pr: item.pr ?? null,
    stage,
    status: item.status ?? null,
    tags: item.tags ?? [],
    title: item.title,
    worker: item.worker ?? lane.worker ?? null,
  }
}

// Pure: the stage of each item the plan lists as in flight: its lane status when that says flight or review, else In review once it has a pull request, else In flight. The live plan keeps work under way here rather than in a lane status.
function inFlightStages(plan: Plan): Map<string, "flight" | "review"> {
  const statuses = new Map(
    plan.lanes.flatMap((lane) => lane.items.map((item) => [item.id, item.status])),
  )
  return new Map(
    plan.inFlight.map((entry) => {
      const stage = stageOf(statuses.get(entry.id))
      return [
        entry.id,
        stage === "flight" || stage === "review" ? stage : entry.pr ? "review" : "flight",
      ]
    }),
  )
}

// Pure: each lane's queued item ids in the order the board shows them: the owner's order first (an id moved to another lane shows there), then every queued item his order does not name, in the plan's order, at the end of its own lane. An id his order names that is no longer queued drops out.
export function queuedIds(plan: Plan, order: OrderLanes | null): OrderLanes {
  const home = new Map<string, string>()
  const underWay = inFlightStages(plan)
  for (const lane of plan.lanes) {
    for (const item of lane.items) {
      if (stageOf(item.status) === "queued" && !underWay.has(item.id)) home.set(item.id, lane.id)
    }
  }
  const placed = new Set<string>()
  const ids: OrderLanes = Object.fromEntries(plan.lanes.map((lane) => [lane.id, [] as string[]]))
  for (const lane of plan.lanes) {
    for (const id of order?.[lane.id] ?? []) {
      if (!home.has(id) || placed.has(id)) continue
      ids[lane.id]!.push(id)
      placed.add(id)
    }
  }
  for (const [id, lane] of home) {
    if (placed.has(id)) continue
    ids[lane]!.push(id)
    placed.add(id)
  }
  return ids
}

const STAGES: { id: Exclude<CardStage, "queued">; title: string }[] = [
  { id: "flight", title: "In flight" },
  { id: "review", title: "In review" },
  { id: "done", title: "Done today" },
]

// Pure: the board's columns, left to right: one Queued column per lane in the given order, then In flight, In review and Done today. In flight and In review hold the plan's in-flight list (inFlightStages); Done today holds what the planner marks done and every pull request merged today, each once.
export function boardColumns(plan: Plan, ids: OrderLanes): BoardColumn[] {
  const cards = new Map<string, BoardCard>()
  for (const lane of plan.lanes)
    for (const item of lane.items) cards.set(item.id, cardOf(item, lane))
  const underWay = inFlightStages(plan)
  for (const entry of plan.inFlight) {
    const stage = underWay.get(entry.id) ?? "flight"
    const card = cards.get(entry.id)
    cards.set(entry.id, {
      draggable: false,
      estimateRange: card?.estimateRange ?? null,
      id: entry.id,
      lane: card?.lane ?? null,
      outcome: entry.outcome,
      pr: entry.pr ?? card?.pr ?? null,
      stage,
      // A lane status that still says queued (READY) would contradict the column, so it is left out.
      status: card && card.stage === stage ? card.status : null,
      tags: card?.tags ?? [],
      title: card?.title ?? entry.outcome,
      worker: entry.worker ?? card?.worker ?? null,
    })
  }
  const queued = plan.lanes.map((lane) => ({
    cards: (ids[lane.id] ?? []).flatMap((id) => cards.get(id) ?? []),
    id: lane.id,
    lane: lane.id,
    title: `${lane.title} · Queued`,
  }))
  const donePrs = new Set(
    [...cards.values()].flatMap((card) => (card.stage === "done" && card.pr ? [card.pr] : [])),
  )
  const merged: BoardCard[] = plan.doneToday
    .filter((done) => !done.url || !donePrs.has(done.url))
    .map((done) => ({
      draggable: false,
      estimateRange: null,
      id: `done:${done.pr}`,
      lane: null,
      outcome: done.outcome,
      pr: done.url ?? null,
      stage: "done",
      status: "MERGED",
      tags: [],
      title: done.outcome,
      worker: null,
    }))
  const staged = STAGES.map(({ id, title }) => ({
    cards: [
      ...[...cards.values()].filter((card) => card.stage === id),
      ...(id === "done" ? merged : []),
    ],
    id,
    lane: null,
    title,
  }))
  return [...queued, ...staged]
}

// Pure: the lane holding an id, null when none does.
export const laneOf = (ids: OrderLanes, id: string): string | null =>
  Object.keys(ids).find((lane) => ids[lane]!.includes(id)) ?? null

export const sameOrder = (a: OrderLanes, b: OrderLanes): boolean =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((lane) => (a[lane] ?? []).join("\n") === (b[lane] ?? []).join("\n"))

// Pure: where a card stands, in words, for the screen reader: "in Easy, 2 of 4".
export function standing(ids: OrderLanes, id: string, titles: Record<string, string>): string {
  const lane = laneOf(ids, id)
  if (!lane) return "outside the queues"
  const list = ids[lane]!
  return `in ${titles[lane] ?? lane}, ${list.indexOf(id) + 1} of ${list.length}`
}

export async function saveOrder(lanes: OrderLanes) {
  const { data, error } = await unwrap(apiClient.v1.apps.plan.order.$post({ json: { lanes } }))
  if (error) throw new Error(error.message)
  return data
}
