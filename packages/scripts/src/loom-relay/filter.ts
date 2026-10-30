// What reaches Loom: only the usage its collector stores (collector/server.ts in the collector's own repo), every body built field by field from an allowlist once a fixed blocklist of known text, path and name keys is dropped, so no text, name or other account's identity goes out, and all of it under the one login the relay sends as.

type Attribute = { key: string; value: { stringValue: string } }
type Point = {
  asDouble?: number
  asInt?: number | string
  attributes: Attribute[]
  startTimeUnixNano?: string
  timeUnixNano?: string
}
type Metric = {
  name: string
  sum: { aggregationTemporality?: number | string; dataPoints: Point[]; isMonotonic?: boolean }
}
export type Metrics = {
  resourceMetrics: {
    resource: { attributes: Attribute[] }
    scopeMetrics: { metrics: Metric[] }[]
  }[]
}

const METRICS = new Set([
  "claude_code.cost.usage",
  "claude_code.session.count",
  "claude_code.token.usage",
])
const TEMPORALITIES = new Set([
  "AGGREGATION_TEMPORALITY_CUMULATIVE",
  "AGGREGATION_TEMPORALITY_DELTA",
])
const TOKEN_TYPES = new Set([
  "cacheCreation",
  "cacheRead",
  "cache_creation",
  "cache_read",
  "input",
  "output",
])
// A Claude model id as Claude Code sends one (claude-opus-5-5, its [1m] variant, a Vertex @date, a Bedrock us., global. or us-gov.anthropic. id), so no path, email or sentence passes as a model; a name shaped like one (claude-something) still would.
const MODEL =
  /^(?:[a-z]{2,6}(?:-[a-z]{2,6})?\.)?(?:anthropic\.)?claude-[a-z0-9.-]{1,80}(?:-v\d+:\d+)?(?:@\d{8})?(?:\[1m\])?$/i

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const digits = (v: unknown): v is string => typeof v === "string" && /^\d{1,20}$/.test(v)
const isInt = (v: unknown): v is number | string =>
  (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^-?\d{1,20}$/.test(v))
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0)
const string = (key: string, stringValue: string): Attribute => ({ key, value: { stringValue } })

// The blocklist: exact keys known to carry a prompt, transcript text, a path, a command, or a tool, skill or agent name, dropped at every depth, and as the name of an OTLP attribute, before the allowlist reads a body, so no prompt or transcript ever reaches Loom.
const BLOCKED = new Set([
  "command",
  "content",
  "cwd",
  "file_path",
  "input",
  "message",
  "messages",
  "output",
  "path",
  "prompt",
  "prompt_text",
  "prompts",
  "skillCounts",
  "subagentCounts",
  "text",
  "toolCalls",
  "toolCounts",
  "tool_input",
  "tool_output",
  "transcript",
  "transcripts",
  "user_prompt",
])

const drop = (v: unknown, dropped: Set<string>): unknown => {
  if (Array.isArray(v))
    return v
      .filter(
        (x) =>
          !(isObject(x) && typeof x.key === "string" && BLOCKED.has(x.key) && dropped.add(x.key)),
      )
      .map((x) => drop(x, dropped))
  if (!isObject(v)) return v
  const out: Record<string, unknown> = Object.create(null)
  for (const [k, x] of Object.entries(v))
    if (BLOCKED.has(k)) dropped.add(k)
    else out[k] = drop(x, dropped)
  return out
}

// body with every blocked key gone, and the names it dropped, A to Z.
export const dropBlocked = (body: unknown) => {
  const dropped = new Set<string>()
  return { body: drop(body, dropped), dropped: [...dropped].sort() }
}

// The string value of the attribute named key, when it is one.
const stringOf = (raw: unknown, key: string): string | undefined => {
  for (const a of list(raw))
    if (
      isObject(a) &&
      a.key === key &&
      isObject(a.value) &&
      typeof a.value.stringValue === "string"
    )
      return a.value.stringValue
}

const point = (raw: unknown, login: string): Point[] => {
  if (!isObject(raw)) return []
  const attributes = [string("user.email", login)]
  const model = stringOf(raw.attributes, "model")
  // A model that is not a Claude id is another backend's (GLM), whose use is not this login's: the point goes whole.
  if (model && !MODEL.test(model)) return []
  if (model) attributes.push(string("model", model))
  const type = stringOf(raw.attributes, "type")
  if (type && TOKEN_TYPES.has(type)) attributes.push(string("type", type))
  const p: Point = { attributes }
  // Each point keeps its own export time: Loom's duplicate guard hashes the body, so two exports must never come out the same.
  if (digits(raw.timeUnixNano)) p.timeUnixNano = raw.timeUnixNano
  if (digits(raw.startTimeUnixNano)) p.startTimeUnixNano = raw.startTimeUnixNano
  if (isInt(raw.asInt)) p.asInt = raw.asInt
  else if (typeof raw.asDouble === "number" && Number.isFinite(raw.asDouble))
    p.asDouble = raw.asDouble
  else return []
  return [p]
}

const metric = (raw: unknown, login: string): Metric[] => {
  if (!isObject(raw) || typeof raw.name !== "string" || !METRICS.has(raw.name)) return []
  if (!isObject(raw.sum)) return []
  const dataPoints = list(raw.sum.dataPoints).flatMap((p) => point(p, login))
  if (!dataPoints.length) return []
  const sum: Metric["sum"] = { dataPoints }
  const t = raw.sum.aggregationTemporality
  if (typeof t === "number" || (typeof t === "string" && TEMPORALITIES.has(t)))
    sum.aggregationTemporality = t
  if (typeof raw.sum.isMonotonic === "boolean") sum.isMonotonic = raw.sum.isMonotonic
  return [{ name: raw.name, sum }]
}

// An OTLP/HTTP JSON metrics export cut to Loom's three metrics, every point under login whatever account sent it, with no other account's email, uuid or organisation; null when nothing is left to send. Loom adds each point to its day's row, so usage from two logins adds up there.
export const filterMetrics = (body: unknown, login: string): Metrics | null => {
  const metrics = list(isObject(body) ? body.resourceMetrics : null).flatMap((rm) =>
    list(isObject(rm) ? rm.scopeMetrics : null).flatMap((sm) =>
      list(isObject(sm) ? sm.metrics : null).flatMap((m) => metric(m, login)),
    ),
  )
  if (!metrics.length) return null
  return {
    resourceMetrics: [
      { resource: { attributes: [string("user.email", login)] }, scopeMetrics: [{ metrics }] },
    ],
  }
}

const COUNTS = [
  "assistantTurns",
  "cacheCreationTokens",
  "cacheReadTokens",
  "inputTokens",
  "outputTokens",
  "sessions",
] as const
// Loom's measured sub-agent token counts: an absent one reads there as not measured, so unlike COUNTS it is never sent as 0, and a sum carries one only when every row in it measured it.
const MEASURED = [
  "subagentCacheCreationTokens",
  "subagentCacheReadTokens",
  "subagentInputTokens",
  "subagentOutputTokens",
] as const
type Rollup = Record<(typeof COUNTS)[number], number> &
  Partial<Record<(typeof MEASURED)[number], number>> & {
    accountEmail: string
    day: string
    machineId: string
    model: string
    seatDir: string
  }
// Loom keys a backfill row on the machine and the seat; these fixed values stand in for this Mac's own.
const MACHINE = "relay"
const SEAT = ".claude"

// The backfill's sums: Loom replaces the row it keys (token holder, machine, seat, day, model), and the backfill posts in batches, so each call sends every key it touches as the sum of the newest copy of every row seen for it, from this batch or an earlier one. A row is the harvester's whole answer for its machine, seat, day and model (one login a seat), so a row seen again, whatever login it now names, replaces its copy and a re-run sends the same sums. A relay that restarts mid-backfill has only what came since, so the backfill is run again.
export const transcriptSums = () => {
  const seen = new Map<string, Map<string, (number | null)[]>>()
  return (body: unknown, login: string): { rollups: Rollup[] } | null => {
    const touched = new Set<string>()
    for (const r of list(isObject(body) ? body.rollups : null)) {
      if (!isObject(r) || typeof r.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) continue
      if (typeof r.model === "string" && r.model && !MODEL.test(r.model)) continue
      const model = typeof r.model === "string" && r.model ? r.model : "unknown"
      const key = `${r.day}\0${model}`
      const rows = seen.get(key) ?? new Map<string, (number | null)[]>()
      seen.set(key, rows)
      rows.set(JSON.stringify([r.machineId, r.seatDir, r.model]), [
        ...COUNTS.map((k) => count(r[k])),
        ...MEASURED.map((k) => (count(r[k]) === r[k] ? (r[k] as number) : null)),
      ])
      touched.add(key)
    }
    if (!touched.size) return null
    const rollups = [...touched].map((key) => {
      const [day = "", model = ""] = key.split("\0")
      const row = { accountEmail: login, day, machineId: MACHINE, model, seatDir: SEAT } as Rollup
      const copies = [...(seen.get(key)?.values() ?? [])]
      COUNTS.forEach((k, i) => {
        row[k] = 0
        for (const counts of copies) row[k] += counts[i] ?? 0
      })
      MEASURED.forEach((k, j) => {
        const i = COUNTS.length + j
        if (copies.every((counts) => counts[i] !== null))
          row[k] = copies.reduce((n, counts) => n + (counts[i] ?? 0), 0)
      })
      return row
    })
    return { rollups }
  }
}
