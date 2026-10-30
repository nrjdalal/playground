import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import { isManagerKind, managerKindOfName } from "@packages/config/kinds"
import { z } from "zod"

import type { RosterAgent } from "@/lib/dashboard/roster"
import { DISPATCHER } from "@/lib/dashboard/workers"
import { dataDir } from "@/lib/sessions/paths"

// The order the owner drags the sidebar's Orchestrators rows into, kept beside the other sidebar state; the dashboard is its only reader and writer.
export const managersOrderPath = (): string => join(dataDir(), "sidebar", "managers-order.json")

export const MAX_MANAGERS = 20

const name = z.string().min(1).max(100)

export const managersOrderSchema = z.strictObject({
  names: z
    .array(name)
    .max(MAX_MANAGERS)
    .refine((names) => new Set(names).size === names.length, "a name is listed twice")
    .refine((names) => !names.includes(DISPATCHER), "the dispatcher's row sits above the groups"),
})

export type ManagersOrder = { names: string[]; updatedAt: string }

// The first name that is no manager: one whose name places as a manager kind (managerKindOfName: an `<id>-<kind>` name or today's), or one the roster gives the manager role or a manager kind.
export function unknownManager(names: string[], agents: readonly RosterAgent[]): string | null {
  const known = new Set<string>()
  for (const agent of agents)
    if (agent.role === "manager" || isManagerKind(agent.kind)) known.add(agent.name)
  return names.find((each) => !known.has(each) && !managerKindOfName(each)) ?? null
}

// Each entry is checked on its own, so one bad name never drops the order; a missing or unreadable file is no order.
export async function readManagersOrder(path = managersOrderPath()): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(await Bun.file(path).text())
    const names = (parsed as { names?: unknown } | null)?.names
    if (!Array.isArray(names)) return []
    const seen = new Set<string>()
    for (const entry of names) {
      if (name.safeParse(entry).success && entry !== DISPATCHER) seen.add(entry as string)
    }
    return [...seen].slice(0, MAX_MANAGERS)
  } catch {
    return []
  }
}

// on globalThis, so a bun --hot reload keeps the one queue
const QUEUE = Symbol.for("playground.dashboard.managers-order.queue")
const held = globalThis as { [QUEUE]?: Promise<unknown> }

// Writes run one at a time in this process, so two quick drags land in the order they were made.
function inOrder<T>(work: () => Promise<T>): Promise<T> {
  const next = (held[QUEUE] ?? Promise.resolve()).then(work, work)
  held[QUEUE] = next.catch(() => {})
  return next
}

// Beside the old file, then renamed over it, so a reader never sees half of one.
export function writeManagersOrder(
  names: string[],
  path = managersOrderPath(),
  now = new Date(),
): Promise<ManagersOrder> {
  return inOrder(async () => {
    const order: ManagersOrder = { names, updatedAt: now.toISOString() }
    await mkdir(dirname(path), { mode: 0o700, recursive: true })
    const temp = `${path}.${process.pid}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(order, null, 2)}\n`, { mode: 0o600 })
      await rename(temp, path)
    } catch (err) {
      await rm(temp, { force: true })
      throw err
    }
    return order
  })
}

export function clearManagersOrder(path = managersOrderPath()): Promise<void> {
  return inOrder(() => rm(path, { force: true }))
}
