import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { z } from "zod"

import { entries, issuesOf } from "../entries"
// Relative, not @/: the web tests type-check this file under web/next's own @/ paths.
import { dataDir } from "../sessions/paths"

// The ops report the ops-report job writes in plain words, ops/report.json in the data folder, and the earlier ones it keeps in ops/reports/ beside it (one file each time the state changes, named by its time). The dashboard only reads them: the Plan page's Report view says what is going on and why, written so the owner can follow the work and judge it.
const isoTime = z.iso.datetime({ offset: true })

const text = z.string().min(1)

const url = z.url({ protocol: /^https$/ })

// Something stuck or unhealthy: what it is, its state, why, what is being done and who does it.
export const findingSchema = z.object({
  action: text.nullable().optional(),
  item: text,
  owner: text.nullable().optional(),
  since: isoTime.nullable().optional(),
  state: text,
  why: text,
})

// One reading of the factory's health or the machine's, in plain words; now is when it was read.
export const healthSchema = z.object({
  label: text,
  now: text.nullable().optional(),
  reading: text,
})

// One line of what changed, or of what merged, with its link when it has one.
export const lineSchema = z.object({ line: text, url: url.nullable().optional() })

// The job's own bookkeeping (fields, seen, sentAt, sentHash, alerted, text) is not read.
const envelopeSchema = z.object({
  changes: z.unknown().optional(),
  findings: z.unknown().optional(),
  generatedAt: isoTime,
  hash: z.unknown().optional(),
  health: z.unknown().optional(),
  merges: z.unknown().optional(),
})

export type OpsFinding = z.infer<typeof findingSchema>
export type OpsHealth = z.infer<typeof healthSchema>
export type OpsLine = z.infer<typeof lineSchema>

export type OpsReport = {
  changes: OpsLine[]
  findings: OpsFinding[]
  generatedAt: string
  hash: string | null
  health: OpsHealth[]
  merges: OpsLine[]
}

// report is null when the file is missing, or unreadable with no good read before it; stale is true when it does not read as a whole and report is the last read that did. earlier holds the reports kept before it, newest first, at most EARLIER_LIMIT. problems names each part of any of them that did not read.
export type OpsReportRead = {
  earlier: OpsReport[]
  problems: string[]
  report: OpsReport | null
  stale: boolean
}

export const EARLIER_LIMIT = 10

export const opsDir = (): string => join(dataDir(), "ops")

export const reportPath = (): string => join(opsDir(), "report.json")

export const reportsDir = (): string => join(opsDir(), "reports")

// Pure: the report a file's text holds, every part that did not read named, each prefixed with `name`. A file that is not JSON or has no generatedAt is no report; anything smaller costs only its own entry.
export function parseReport(
  text: string,
  name = "report.json",
): { problems: string[]; report: OpsReport | null } {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { problems: [`${name} is not valid JSON`], report: null }
  }
  const envelope = envelopeSchema.safeParse(json)
  if (!envelope.success) {
    return { problems: [`${name}: ${issuesOf(envelope.error, [])}`], report: null }
  }
  const faults: string[] = []
  const { changes, findings, generatedAt, hash, health, merges } = envelope.data
  const report: OpsReport = {
    changes: entries<OpsLine>(lineSchema, changes, ["changes"], faults),
    findings: entries<OpsFinding>(findingSchema, findings, ["findings"], faults),
    generatedAt,
    hash: typeof hash === "string" && hash ? hash : null,
    health: entries<OpsHealth>(healthSchema, health, ["health"], faults),
    merges: entries<OpsLine>(lineSchema, merges, ["merges"], faults),
  }
  return { problems: faults.map((fault) => `${name}: ${fault}`), report }
}

const missing = (err: unknown): boolean =>
  err instanceof Error && "code" in err && err.code === "ENOENT"

const reasonOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

let cached: { key: string; problems: string[]; report: OpsReport | null } | null = null
const lastGood = new Map<string, OpsReport>()

// The current report, read again only when the file changes; one that stops reading keeps its last good read, marked stale.
async function readCurrent(
  path: string,
): Promise<{ problems: string[]; report: OpsReport | null; stale: boolean }> {
  try {
    const stat = await Bun.file(path).stat()
    const key = `${path}:${stat.mtimeMs}:${stat.size}`
    if (cached?.key !== key) {
      cached = { key, ...parseReport(await Bun.file(path).text()) }
      if (cached.report) lastGood.set(path, cached.report)
    }
    if (cached.report) return { problems: cached.problems, report: cached.report, stale: false }
    return fallBack(path, cached.problems)
  } catch (err) {
    if (missing(err)) return { problems: [], report: null, stale: false }
    return fallBack(path, [`report.json could not be read: ${reasonOf(err)}`])
  }
}

const fallBack = (path: string, problems: string[]) => {
  const good = lastGood.get(path)
  return { problems, report: good ?? null, stale: Boolean(good) }
}

// The reports kept before the current one, newest first by file name (each is named by its time), without the current one itself.
async function readEarlier(
  dir: string,
  current: OpsReport | null,
): Promise<{ earlier: OpsReport[]; problems: string[] }> {
  let names: string[]
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json"))
  } catch (err) {
    if (missing(err)) return { earlier: [], problems: [] }
    return { earlier: [], problems: [`reports could not be read: ${reasonOf(err)}`] }
  }
  const problems: string[] = []
  const earlier: OpsReport[] = []
  for (const name of names.sort().reverse()) {
    if (earlier.length === EARLIER_LIMIT) break
    let read: { problems: string[]; report: OpsReport | null }
    try {
      read = parseReport(await Bun.file(join(dir, name)).text(), `reports/${name}`)
    } catch (err) {
      problems.push(`reports/${name} could not be read: ${reasonOf(err)}`)
      continue
    }
    problems.push(...read.problems)
    if (!read.report || read.report.generatedAt === current?.generatedAt) continue
    earlier.push(read.report)
  }
  return { earlier, problems }
}

// Never throws: a missing report is no report and no problem, and every fault is named.
export async function readOpsReport(
  path = reportPath(),
  dir = reportsDir(),
): Promise<OpsReportRead> {
  const current = await readCurrent(path)
  const { earlier, problems } = await readEarlier(dir, current.report)
  return { ...current, earlier, problems: [...current.problems, ...problems] }
}
