import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  EARLIER_LIMIT,
  parseReport,
  readOpsReport,
} from "../../../../../../api/hono/src/lib/apps/ops-report"
import { inFixture, onLiveDashboard } from "../../../../../dashboard-fixture"

const dir = mkdtempSync(join(tmpdir(), "ops-report-"))
afterAll(() => rmSync(dir, { force: true, recursive: true }))

const report = (at: string, patch: Record<string, unknown> = {}) => ({
  changes: [{ line: "PR #5 now reads in review", url: "https://github.com/example/app/pull/5" }],
  fields: { internal: true },
  findings: [
    {
      action: "Its lead asked the reviewer again",
      item: "#5",
      owner: "worker-a",
      since: "2026-10-06T18:00:00Z",
      state: "waiting on its reviewer",
      why: "No score on the latest push",
    },
  ],
  generatedAt: at,
  hash: "abc123",
  health: [{ label: "Memory", now: at, reading: "33% used" }],
  history: "reports",
  merges: [{ line: "#4 merged", url: "https://github.com/example/app/pull/4" }],
  seen: {},
  sentAt: at,
  sentHash: "abc123",
  text: "REPORT abc123",
  ...patch,
})

const parse = (value: unknown) => parseReport(JSON.stringify(value))

describe("parseReport", () => {
  test("reads a whole report with no problem, leaving out the job's own bookkeeping", () => {
    const { problems, report: read } = parse(report("2026-10-06T19:01:08Z"))
    expect(problems).toEqual([])
    expect(read).toEqual({
      changes: [
        { line: "PR #5 now reads in review", url: "https://github.com/example/app/pull/5" },
      ],
      findings: [
        {
          action: "Its lead asked the reviewer again",
          item: "#5",
          owner: "worker-a",
          since: "2026-10-06T18:00:00Z",
          state: "waiting on its reviewer",
          why: "No score on the latest push",
        },
      ],
      generatedAt: "2026-10-06T19:01:08Z",
      hash: "abc123",
      health: [{ label: "Memory", now: "2026-10-06T19:01:08Z", reading: "33% used" }],
      merges: [{ line: "#4 merged", url: "https://github.com/example/app/pull/4" }],
    })
  })

  test("a finding without its why is refused and named; one with a bad optional key keeps its row", () => {
    const { problems, report: read } = parse(
      report("2026-10-06T19:01:08Z", {
        findings: [
          { item: "#6", state: "stuck" },
          { item: "#7", since: "yesterday", state: "stuck", why: "No reviewer" },
        ],
      }),
    )
    expect(read?.findings).toEqual([{ item: "#7", state: "stuck", why: "No reviewer" }])
    expect(problems).toHaveLength(2)
    expect(problems[0]).toStartWith("report.json: findings.0.why:")
    expect(problems[1]).toEndWith("(ignored)")
  })

  test("a line whose link is not https keeps its words without the link; a part that is not a list reads as empty", () => {
    const { problems, report: read } = parse(
      report("2026-10-06T19:01:08Z", {
        changes: [{ line: "Lanes moved", url: "javascript:alert(1)" }],
        merges: "none",
      }),
    )
    expect(read?.changes).toEqual([{ line: "Lanes moved" }])
    expect(read?.merges).toEqual([])
    expect(problems).toContain("report.json: merges: not a list (ignored)")
  })

  test("a file that is not JSON, or has no generatedAt, is no report, with the fault named", () => {
    expect(parseReport("{")).toEqual({ problems: ["report.json is not valid JSON"], report: null })
    const { problems, report: read } = parse({ findings: [] })
    expect(read).toBeNull()
    expect(problems[0]).toStartWith("report.json: generatedAt:")
  })
})

describe("readOpsReport", () => {
  test("a missing report and folder are no report and no problem", async () => {
    expect(await readOpsReport(join(dir, "missing.json"), join(dir, "no-reports"))).toEqual({
      earlier: [],
      problems: [],
      report: null,
      stale: false,
    })
  })

  test("earlier reports come newest first, without the current one, at most ten", async () => {
    const reports = join(dir, "reports")
    mkdirSync(reports)
    for (let i = 0; i < 12; i++) {
      const at = `2026-10-06T${String(i + 6).padStart(2, "0")}:00:00Z`
      writeFileSync(join(reports, `${at.replaceAll(":", "")}.json`), JSON.stringify(report(at)))
    }
    writeFileSync(join(reports, "notes.txt"), "not a report")
    const current = join(dir, "report.json")
    writeFileSync(current, JSON.stringify(report("2026-10-06T17:00:00Z")))
    const read = await readOpsReport(current, reports)
    expect(read.report?.generatedAt).toBe("2026-10-06T17:00:00Z")
    expect(read.earlier).toHaveLength(EARLIER_LIMIT)
    expect(read.earlier[0]?.generatedAt).toBe("2026-10-06T16:00:00Z")
    expect(read.earlier.at(-1)?.generatedAt).toBe("2026-10-06T07:00:00Z")
    expect(read.problems).toEqual([])
  })

  test("an earlier report that does not read is named and skipped", async () => {
    const reports = join(dir, "bad-reports")
    mkdirSync(reports)
    writeFileSync(join(reports, "2026-10-06T100000Z.json"), "{ nope")
    writeFileSync(
      join(reports, "2026-10-06T090000Z.json"),
      JSON.stringify(report("2026-10-06T09:00:00Z")),
    )
    const read = await readOpsReport(join(dir, "none.json"), reports)
    expect(read.earlier.map((r) => r.generatedAt)).toEqual(["2026-10-06T09:00:00Z"])
    expect(read.problems).toEqual(["reports/2026-10-06T100000Z.json is not valid JSON"])
  })

  test("a report that stops reading keeps its last good read in view, marked stale", async () => {
    const file = join(dir, "stale.json")
    writeFileSync(file, JSON.stringify(report("2026-10-06T19:01:08Z")))
    const good = await readOpsReport(file, join(dir, "no-reports"))
    expect(good.stale).toBe(false)
    writeFileSync(file, "{ not json")
    utimesSync(file, new Date(), new Date(Date.now() + 5_000))
    const bad = await readOpsReport(file, join(dir, "no-reports"))
    expect(bad.stale).toBe(true)
    expect(bad.report).toEqual(good.report)
    expect(bad.problems).toEqual(["report.json is not valid JSON"])
  })

  test("a path that cannot be read is a problem, never a thrown error", async () => {
    const folder = join(dir, "folder.json")
    mkdirSync(folder)
    const read = await readOpsReport(folder, join(dir, "no-reports"))
    expect(read.report).toBeNull()
    expect(read.problems[0]).toStartWith("report.json could not be read")
  })

  test.skipIf(onLiveDashboard())(
    "a fixture stack's report is playground/ops/report.json in its fixture, its history beside it",
    async () => {
      const { code, result, stderr } = await inFixture(
        `const { reportPath, reportsDir } = await import(\`\${API}/lib/apps/ops-report\`)\nconsole.log(JSON.stringify([reportPath(), reportsDir()]))`,
        dir,
      )
      expect(stderr).toBe("")
      expect(code).toBe(0)
      const ops = join(dir, "fixture", "claude", "playground", "ops")
      expect(result).toEqual([join(ops, "report.json"), join(ops, "reports")])
    },
  )

  test.skipIf(onLiveDashboard())(
    "a fixture stack reads its fixture's made-up report and its earlier ones",
    async () => {
      const { code, result, stderr } = await inFixture(
        `const { readOpsReport } = await import(\`\${API}/lib/apps/ops-report\`)\nconsole.log(JSON.stringify(await readOpsReport()))`,
        dir,
      )
      expect(stderr).toBe("")
      expect(code).toBe(0)
      const read = result as Awaited<ReturnType<typeof readOpsReport>>
      expect(read.problems).toEqual([])
      expect(read.report?.findings[0]?.why).toStartWith("Fixture")
      expect(read.earlier.length).toBeGreaterThan(0)
      expect(read.earlier.every((r) => r.generatedAt !== read.report?.generatedAt)).toBe(true)
    },
  )
})
