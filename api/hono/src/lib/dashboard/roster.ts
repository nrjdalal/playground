import { join } from "node:path"

import { ROSTER_KINDS } from "@packages/config/kinds"
import { z } from "zod"

import { dataDir } from "@/lib/sessions/paths"
import { TICKET_ID_RE } from "@/lib/ticket-id"

// The roster the dispatcher keeps of the agents it dispatched: each one's role and kind (what it does), the task it was given, a short triaged title, when it expects to be done (the ETA it last sent its lead), and where its work stands, plus a backlog of what is queued for the next free agent. The dispatcher and its leads write it, only through scripts/roster.ts, as they dispatch and as reports come in; the dashboard only reads it.
const isoTime = z.iso.datetime({ offset: true })

const PR_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

export const ROSTER_ROLES = ["manager", "runner", "worker"] as const

const index = z.number().int().min(0)

// roster.ts writes every value as a string, so a whole number arrives as "5" and a list of them as "3 7"; JSON's own number and array read too.
const wholeNumber = z.union([index, z.string().regex(/^\d+$/).transform(Number)], {
  error: "a whole number",
})

const indices = z.union(
  [
    z.array(index),
    z
      .string()
      .regex(/^\s*(\d+(\s+\d+)*)?\s*$/)
      .transform((text) => (text.trim() ? text.trim().split(/\s+/).map(Number) : [])),
  ],
  { error: "space-separated whole numbers" },
)

export const rosterAgentSchema = z.object({
  backlogNext: wholeNumber.optional(),
  backlogTaken: indices.optional(),
  branch: z.string().min(1).optional(),
  eta: isoTime.optional(),
  kind: z.enum(ROSTER_KINDS).optional(),
  lastReport: z.string().min(1).optional(),
  lastReportAt: isoTime.optional(),
  name: z.string().min(1),
  pr: z.string().regex(PR_URL_RE, "a GitHub pull request URL").optional(),
  repo: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/, "owner/name")
    .optional(),
  role: z.enum(ROSTER_ROLES),
  schedule: z.string().min(1).optional(),
  status: z.string().min(1),
  surface: z
    .string()
    .regex(/^surface:\d+$/, "a surface ref (surface:<n>)")
    .optional(),
  task: z.string().min(1),
  ticket: z.string().regex(TICKET_ID_RE, "a Linear ticket ID").optional(),
  title: z.string().min(1).max(40).optional(),
  worker: z.string().min(1).optional(),
  workspace: z.string().min(1).optional(),
})

const backlogSchema = z.array(z.string().min(1))

const envelopeSchema = z.object({
  agents: z.array(z.unknown()),
  backlog: z.unknown().optional(),
  updatedAt: isoTime,
})

// The keys an agent can do without: one off its schema is ignored rather than costing the agent its row.
const OPTIONAL_KEYS = new Set(
  Object.entries(rosterAgentSchema.shape)
    .filter(([, schema]) => schema.safeParse(undefined).success)
    .map(([key]) => key),
)

export const rosterSchema = envelopeSchema.extend({
  agents: z.array(rosterAgentSchema),
  backlog: backlogSchema.optional(),
})

export type Roster = z.infer<typeof rosterSchema>
export type RosterAgent = z.infer<typeof rosterAgentSchema>
export type RosterRole = RosterAgent["role"]

// problem says what in the file did not read (a field off its schema, a name listed twice), so a page can show it; an ended row names nothing. roster is null when the file is missing or unreadable as a whole.
export type RosterRead = { problem: string | null; roster: Roster | null }

export const rosterPath = (): string => join(dataDir(), "roster.json")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const issuesOf = (error: z.ZodError, at: (string | number)[]): string =>
  error.issues.map((issue) => `${[...at, ...issue.path].join(".")}: ${issue.message}`).join("; ")

// Each agent is checked on its own, so one bad entry drops only that agent and is named in problem, rather than blanking the whole roster; an ended row drops the same and names nothing. An agent whose only faults are in optional keys (a title over 40 characters, a malformed time) keeps its row without them, and the keys are named too; so is a backlog that is not a list of strings, which reads as empty.
export function parseRoster(text: string): RosterRead {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { problem: "roster.json is not valid JSON", roster: null }
  }
  const envelope = envelopeSchema.safeParse(json)
  if (!envelope.success) return { problem: issuesOf(envelope.error, []), roster: null }
  const agents: RosterAgent[] = []
  const problems: string[] = []
  const names = new Set<string>()
  // an ended row's problems leave the line, so a live row's stands out
  const note = (ended: boolean, text: string) => {
    if (!ended) problems.push(text)
  }
  for (const [i, raw] of envelope.data.agents.entries()) {
    let parsed = rosterAgentSchema.safeParse(raw)
    const faults = parsed.success ? [] : parsed.error.issues.map((issue) => String(issue.path[0]))
    // the status reads before any count, from the parse or the raw row
    const rawStatus = isRecord(raw) && typeof raw.status === "string" ? raw.status : null
    const ended = (parsed.success ? parsed.data.status : rawStatus) === "ended"
    if (!parsed.success && isRecord(raw) && faults.every((key) => OPTIONAL_KEYS.has(key))) {
      note(ended, `${issuesOf(parsed.error, ["agents", i])} (ignored)`)
      parsed = rosterAgentSchema.safeParse(
        Object.fromEntries(Object.entries(raw).filter(([key]) => !faults.includes(key))),
      )
    }
    if (!parsed.success) {
      note(ended, issuesOf(parsed.error, ["agents", i]))
    } else if (names.has(parsed.data.name)) {
      note(ended, `agents.${i}.name: ${parsed.data.name} is listed twice`)
    } else {
      names.add(parsed.data.name)
      agents.push(parsed.data)
    }
  }
  const backlog = backlogSchema.safeParse(envelope.data.backlog ?? [])
  if (!backlog.success) problems.push(`${issuesOf(backlog.error, ["backlog"])} (ignored)`)
  return {
    problem: problems.length > 0 ? problems.join("; ") : null,
    roster: {
      agents,
      backlog: backlog.success ? backlog.data : [],
      updatedAt: envelope.data.updatedAt,
    },
  }
}

let cached: { key: string; read: RosterRead } | null = null

const NO_ROSTER: RosterRead = { problem: null, roster: null }

const missing = (err: unknown): boolean =>
  err instanceof Error && "code" in err && err.code === "ENOENT"

// Read again only when the file changes: every caller on a refresh loop shares one parse per write. A file that is missing, or goes between the stat and the read, is no roster; one that cannot be read (a directory, no permission) is a problem, never a thrown error.
export async function readRoster(path = rosterPath()): Promise<RosterRead> {
  try {
    const stat = await Bun.file(path).stat()
    const key = `${path}:${stat.mtimeMs}:${stat.size}`
    if (cached?.key === key) return cached.read
    const read = parseRoster(await Bun.file(path).text())
    cached = { key, read }
    return read
  } catch (err) {
    if (missing(err)) return NO_ROSTER
    const reason = err instanceof Error ? err.message : String(err)
    return { problem: `roster.json could not be read: ${reason}`, roster: null }
  }
}
