import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { z } from "zod"

// Relative, not @/: the web tests type-check this file under web/next's own @/ paths.
import { dataDir } from "../sessions/paths"

// The owner's own build order, set by dragging cards on the Plan page's kanban board: each lane's queued item ids, first to build first. It sits beside plan.json, which the planner owns, so the page never writes the plan and the planner never writes this; on every re-groom the planner keeps this order pinned above its own.
export const orderPath = (): string => join(dataDir(), "bundles", "order.json")

const id = z.string().min(1).max(100)

// Lane ids as plan.json names them (easy, medium, hard), each to its queued item ids in order. An id sits in one lane at most.
export const orderLanesSchema = z
  .record(id, z.array(id).max(500))
  .refine((lanes) => Object.keys(lanes).length <= 20, "at most 20 lanes")
  .refine((lanes) => {
    const ids = Object.values(lanes).flat()
    return new Set(ids).size === ids.length
  }, "an item is in two lanes, or twice in one")

export const orderSchema = z.object({
  lanes: orderLanesSchema,
  updatedAt: z.iso.datetime({ offset: true }),
})

export type PlanOrder = z.infer<typeof orderSchema>

// order is null when no drag has written one yet; problem names a file that is there but does not read, never a thrown error.
export type OrderRead = { order: PlanOrder | null; problem: string | null }

export async function readOrder(path = orderPath()): Promise<OrderRead> {
  const file = Bun.file(path)
  try {
    if (!(await file.exists())) return { order: null, problem: null }
    const parsed = orderSchema.safeParse(JSON.parse(await file.text()))
    if (parsed.success) return { order: parsed.data, problem: null }
    return { order: null, problem: `order.json does not read: ${parsed.error.issues[0]?.message}` }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { order: null, problem: `order.json could not be read: ${reason}` }
  }
}

let queue: Promise<unknown> = Promise.resolve()

// Writes the order whole: beside the old file, then renamed over it, so the planner never reads half of one. Writes run one at a time in this process, so two quick drags land in the order they were made.
export function writeOrder(
  lanes: PlanOrder["lanes"],
  path = orderPath(),
  now = new Date(),
): Promise<PlanOrder> {
  const work = async () => {
    const order: PlanOrder = { lanes, updatedAt: now.toISOString() }
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(order, null, 2)}\n`)
      await rename(temp, path)
    } catch (err) {
      await rm(temp, { force: true })
      throw err
    }
    return order
  }
  const next = queue.then(work, work)
  queue = next.catch(() => {})
  return next
}
