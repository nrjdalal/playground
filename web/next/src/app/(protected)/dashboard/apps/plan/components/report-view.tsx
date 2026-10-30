"use client"
"use no memo"

import type { OpsFinding, OpsHealth, OpsLine, OpsReport, Plan } from "@api/hono"
import { useQuery } from "@tanstack/react-query"

import { Since, textColumn } from "@/app/(protected)/dashboard/apps/plan/components/data-columns"
import { Section } from "@/app/(protected)/dashboard/apps/plan/components/section"
import { AgentLink } from "@/components/dashboard/agent-link"
import { useDashboard } from "@/components/dashboard/dashboard"
import { DataTable, useStaticTable, type ColumnConfig } from "@/components/data-table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { useAgentsBoard } from "@/lib/agents"
import { fetchPlan, PLAN_QUERY_KEY, prLabel } from "@/lib/plan"
import {
  attentionCount,
  fetchReport,
  healthReadAt,
  laneNow,
  REPORT_QUERY_KEY,
  type LaneNow,
} from "@/lib/report"
import { relativeTime } from "@/lib/time"

// What did not read, named, under a one-line title.
export function Problems({ problems, title }: { problems: string[]; title: string }) {
  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

const Muted = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted-foreground text-xs">{children}</p>
)

const prLink = (url: string) => (
  <a href={url} target="_blank" rel="noreferrer" className="underline">
    PR {prLabel(url)}
  </a>
)

// One lane's sentence: who is on what, its status in the Dashboard's words, its pull request and estimate, then the item's line for the owner.
function LaneLine({ lane }: { lane: LaneNow }) {
  const next = lane.item ? `next is ${lane.item}` : "nothing is planned"
  const doing = lane.worker
    ? lane.item && lane.inFlight
      ? ` is on ${lane.item}`
      : lane.availability
        ? ` is ${lane.availability}; ${next}`
        : ` has nothing in flight; ${next}`
    : `; ${next}`
  return (
    <li className="flex flex-col gap-0.5">
      <p className="text-sm">
        <span className="font-medium">{lane.lane}</span>
        {": "}
        {lane.worker ? <AgentLink name={lane.worker} /> : "No worker"}
        {doing}
        {lane.status && <span className="text-muted-foreground"> · {lane.status}</span>}
        {lane.pr && <> · {prLink(lane.pr)}</>}
        {lane.estimate && (
          <span className="text-muted-foreground"> · estimate {lane.estimate}</span>
        )}
      </p>
      {lane.outcome && <Muted>{lane.outcome}</Muted>}
    </li>
  )
}

function Now({ now, plan }: { now: Date; plan: Plan | null }) {
  const { data: board } = useAgentsBoard()
  const { workers } = useDashboard()
  return (
    <Section id="report-now" title="Now">
      {plan && plan.lanes.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {plan.lanes.map((lane) => (
            <LaneLine
              key={lane.id}
              lane={laneNow(lane, plan, board?.agents, now.getTime(), workers)}
            />
          ))}
        </ul>
      ) : (
        <Muted>No plan to read the lanes from yet.</Muted>
      )}
    </Section>
  )
}

function Finding({ finding }: { finding: OpsFinding }) {
  return (
    <li className="flex flex-col gap-0.5">
      <p className="text-sm">
        <span className="font-medium">{finding.item}</span>: {finding.state}
        {finding.since && (
          <span className="text-muted-foreground">
            , for <Since at={finding.since} />
          </span>
        )}
      </p>
      <Muted>Why: {finding.why}</Muted>
      {(finding.action || finding.owner) && (
        <Muted>
          {finding.action ?? "Being handled"}
          {finding.owner && (
            <>
              {", by "}
              <AgentLink name={finding.owner} />
            </>
          )}
        </Muted>
      )}
    </li>
  )
}

function Attention({ report }: { report: OpsReport }) {
  return (
    <Section id="report-attention" title="Needs attention">
      {report.findings.length === 0 ? (
        <p className="text-sm">Nothing needs you.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {report.findings.map((finding, i) => (
            <Finding key={`${finding.item}-${i}`} finding={finding} />
          ))}
        </ul>
      )}
    </Section>
  )
}

const healthConfig: Record<string, ColumnConfig> = {
  label: { extra: 24 },
  reading: { extra: 48, flex: true, wrap: true },
}

const healthColumns = [
  textColumn<OpsHealth>("label", "Reading", (row) => row.label),
  textColumn<OpsHealth>("reading", "Now", (row) => row.reading),
]

function Health({ now, report }: { now: Date; report: OpsReport }) {
  const table = useStaticTable({
    columnConfig: healthConfig,
    columns: healthColumns,
    data: report.health,
    getRowId: (row) => row.label,
  })
  const readAt = healthReadAt(report)
  return (
    <Section id="report-health" title="Health and System">
      {report.health.length === 0 ? (
        <Muted>No readings in this report.</Muted>
      ) : (
        <>
          <DataTable aria-label="Each reading" size="sm" table={table} />
          {readAt && <Muted>Read {relativeTime(readAt, now)}.</Muted>}
        </>
      )}
    </Section>
  )
}

// A list of report lines, each linked when it has a link.
function Lines({ empty, lines }: { empty: string; lines: OpsLine[] }) {
  if (lines.length === 0) return <Muted>{empty}</Muted>
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {lines.map((line, i) => (
        <li key={`${line.line}-${i}`}>
          {line.url ? (
            <a href={line.url} target="_blank" rel="noreferrer" className="hover:underline">
              {line.line}
            </a>
          ) : (
            line.line
          )}
        </li>
      ))}
    </ul>
  )
}

const earlierConfig: Record<string, ColumnConfig> = {
  when: { extra: 12 },
  attention: { extra: 12 },
  changed: { extra: 48, flex: true, wrap: true },
}

const earlierColumns = (now: Date) => [
  textColumn<OpsReport>("when", "When", (row) => relativeTime(row.generatedAt, now), true),
  textColumn<OpsReport>("attention", "Needs attention", (row) => attentionCount(row)),
  textColumn<OpsReport>(
    "changed",
    "What changed",
    (row) => row.changes.map((change) => change.line).join("; ") || "-",
    true,
  ),
]

function Earlier({ now, reports }: { now: Date; reports: OpsReport[] }) {
  const table = useStaticTable({
    columnConfig: earlierConfig,
    columns: earlierColumns(now),
    data: reports,
    getRowId: (row) => row.generatedAt,
  })
  return (
    <Section id="report-earlier" title="Earlier reports">
      {reports.length === 0 ? (
        <Muted>No earlier report is kept.</Muted>
      ) : (
        <DataTable aria-label="Earlier reports" size="sm" table={table} />
      )}
    </Section>
  )
}

// The Report tab: what is going on and why, in plain words. Now reads the plan and the Dashboard's board; the rest is the ops report the ops-report job writes.
export function ReportPanel({ now }: { now: Date }) {
  const { data, error, isPending, refetch } = useQuery({
    queryKey: REPORT_QUERY_KEY,
    queryFn: fetchReport,
    refetchInterval: 60_000,
  })
  const { data: plan } = useQuery({ queryKey: PLAN_QUERY_KEY, queryFn: fetchPlan })
  if (isPending) return <Spinner />
  if (error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>The report could not be read</EmptyTitle>
          <EmptyDescription>{error.message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  const { report } = data
  return (
    <div className="flex flex-col gap-6">
      {data.problems.length > 0 && (
        <Problems
          problems={data.problems}
          title={
            report && !data.stale
              ? "Part of the report did not read"
              : "The report does not read now"
          }
        />
      )}
      <Now now={now} plan={plan?.plan ?? null} />
      {report ? (
        <>
          <Attention report={report} />
          <Health now={now} report={report} />
          <Section id="report-changes" title="Since the last report">
            <Lines empty="Nothing changed since the last report." lines={report.changes} />
          </Section>
          <Section id="report-merges" title="Today">
            <Lines empty="Nothing has merged today." lines={report.merges} />
          </Section>
          <Earlier now={now} reports={data.earlier} />
        </>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No report yet</EmptyTitle>
            <EmptyDescription>
              The ops-report job writes it to ops/report.json in the Dashboard's data folder.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
