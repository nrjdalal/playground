import { join } from "node:path"

import { z } from "zod"

import { entries, issuesOf } from "../entries"
// Relative, not @/: the web tests type-check this file under web/next's own @/ paths.
import { dataDir } from "../sessions/paths"

// The plan the planner keeps of what each lane builds next, written to bundles/plan.json in the data folder on every re-groom, beside the bundles' README.md. The dashboard only reads it: the plan changes by the planner, never from the page.
const isoTime = z.iso.datetime({ offset: true })

const PR_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

const prUrl = z.string().regex(PR_URL_RE, "a GitHub pull request URL")

const text = z.string().min(1)

// An item on a lane. outcome is required: it is the plain-words line saying what the owner gets, so an item without one is refused and named rather than shown bare.
export const planItemSchema = z.object({
  bundle: text.optional(),
  dependsOn: z.array(text).optional(),
  difficulty: z.number().int().min(0).max(5).optional(),
  estimateHours: z.number().nonnegative().optional(),
  estimateRange: text.optional(),
  finish: isoTime.nullable().optional(),
  id: text,
  outcome: text,
  pr: prUrl.nullable().optional(),
  priority: text.optional(),
  start: isoTime.nullable().optional(),
  status: text.optional(),
  // The planner's tags for the item (@web/next, @tests), shown on the Plan board's card as text.
  tags: z.array(text).optional(),
  title: text,
  visible: z.boolean().optional(),
  worker: text.nullable().optional(),
})

export const landingSchema = z.object({
  finish: isoTime.nullable().optional(),
  id: text,
  title: text,
})

export const inFlightSchema = z.object({
  eta: isoTime.nullable().optional(),
  id: text,
  outcome: text,
  pr: prUrl.nullable().optional(),
  since: isoTime.nullable().optional(),
  worker: text.nullable().optional(),
})

export const doneSchema = z.object({
  at: isoTime.nullable().optional(),
  outcome: text,
  pr: text,
  url: prUrl.nullable().optional(),
})

const laneEnvelopeSchema = z.object({
  id: text,
  items: z.array(z.unknown()),
  title: text,
  worker: text.nullable().optional(),
})

const envelopeSchema = z.object({
  doneToday: z.unknown().optional(),
  generatedAt: isoTime,
  inFlight: z.unknown().optional(),
  landingNext: z.unknown().optional(),
  lanes: z.array(z.unknown()),
})

export type PlanItem = z.infer<typeof planItemSchema>
export type PlanLanding = z.infer<typeof landingSchema>
export type PlanInFlight = z.infer<typeof inFlightSchema>
export type PlanDone = z.infer<typeof doneSchema>
export type PlanLane = Omit<z.infer<typeof laneEnvelopeSchema>, "items"> & { items: PlanItem[] }

export type Plan = {
  doneToday: PlanDone[]
  generatedAt: string
  inFlight: PlanInFlight[]
  landingNext: PlanLanding[]
  lanes: PlanLane[]
}

// problems names each part that did not read, so the page can show it; plan is null when the file is missing, or unreadable with no good read before it. stale is true when the file does not read as a whole and plan is the last read that did.
export type PlanRead = { plan: Plan | null; problems: string[]; stale: boolean }

export const planPath = (): string => join(dataDir(), "bundles", "plan.json")

const byId = (row: { id: string }): string => row.id

// Pure: the plan a file's text holds, with every part that did not read named. A file that is not JSON, or lacks generatedAt or lanes, is no plan; anything smaller costs only its own entry.
export function parsePlan(text: string): { plan: Plan | null; problems: string[] } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { plan: null, problems: ["plan.json is not valid JSON"] }
  }
  const envelope = envelopeSchema.safeParse(json)
  if (!envelope.success) return { plan: null, problems: [issuesOf(envelope.error, [])] }
  const problems: string[] = []
  const lanes: PlanLane[] = []
  const itemIds = new Set<string>()
  for (const [i, raw] of envelope.data.lanes.entries()) {
    const lane = laneEnvelopeSchema.safeParse(raw)
    if (!lane.success) {
      problems.push(issuesOf(lane.error, ["lanes", i]))
      continue
    }
    if (lanes.some((other) => other.id === lane.data.id)) {
      problems.push(`lanes.${i}: ${lane.data.id} is listed twice`)
      continue
    }
    const at = ["lanes", i, "items"]
    const items = entries<PlanItem>(planItemSchema, lane.data.items, at, problems, byId, itemIds)
    lanes.push({ ...lane.data, items })
  }
  const { doneToday, generatedAt, inFlight, landingNext } = envelope.data
  return {
    plan: {
      doneToday: entries<PlanDone>(doneSchema, doneToday, ["doneToday"], problems, (row) => row.pr),
      generatedAt,
      inFlight: entries<PlanInFlight>(inFlightSchema, inFlight, ["inFlight"], problems, byId),
      landingNext: entries<PlanLanding>(
        landingSchema,
        landingNext,
        ["landingNext"],
        problems,
        byId,
      ),
      lanes,
    },
    problems,
  }
}

let cached: { key: string; read: PlanRead } | null = null
const lastGood = new Map<string, Plan>()

const missing = (err: unknown): boolean =>
  err instanceof Error && "code" in err && err.code === "ENOENT"

// A file that does not read as a whole keeps the last good read of that path in view, marked stale, with the fault named.
const fallBack = (path: string, problems: string[]): PlanRead => {
  const good = lastGood.get(path)
  return { plan: good ?? null, problems, stale: Boolean(good) }
}

// Read again only when the file changes. A missing file is no plan and no problem; one that cannot be read (a directory, no permission) or does not parse is a problem, never a thrown error.
export async function readPlan(path = planPath()): Promise<PlanRead> {
  try {
    const stat = await Bun.file(path).stat()
    const key = `${path}:${stat.mtimeMs}:${stat.size}`
    if (cached?.key === key) return cached.read
    const parsed = parsePlan(await Bun.file(path).text())
    const read = parsed.plan
      ? { plan: parsed.plan, problems: parsed.problems, stale: false }
      : fallBack(path, parsed.problems)
    if (parsed.plan) lastGood.set(path, parsed.plan)
    cached = { key, read }
    return read
  } catch (err) {
    if (missing(err)) return { plan: null, problems: [], stale: false }
    const reason = err instanceof Error ? err.message : String(err)
    return fallBack(path, [`plan.json could not be read: ${reason}`])
  }
}
