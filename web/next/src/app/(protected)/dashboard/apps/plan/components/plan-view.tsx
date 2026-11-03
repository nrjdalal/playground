"use client"
"use no memo"

import type { OpsReport, Plan, PlanLane } from "@api/hono"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef, RowData } from "@tanstack/react-table"
import { parseAsStringLiteral, useQueryState } from "nuqs"

import { PlanBoard } from "@/app/(protected)/dashboard/apps/plan/components/board/plan-board"
import {
  doneColumnConfig,
  doneColumns,
  inFlightColumnConfig,
  inFlightColumns,
  laneColumnConfig,
  laneColumns,
  landingColumnConfig,
  landingColumns,
  type LaneRow,
} from "@/app/(protected)/dashboard/apps/plan/components/data-columns"
import { Problems, ReportPanel } from "@/app/(protected)/dashboard/apps/plan/components/report-view"
import { Section } from "@/app/(protected)/dashboard/apps/plan/components/section"
import { AgentLink } from "@/components/dashboard/agent-link"
import { useDashboard } from "@/components/dashboard/dashboard"
import { OwnerOnly } from "@/components/dashboard/owner-only"
import { SetupEmpty } from "@/components/dashboard/setup-empty"
import {
  DataTable,
  useStaticTable,
  type ColumnConfig,
  type Features,
} from "@/components/data-table"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useOwnerZone } from "@/hooks/use-owner-zone"
import { appById } from "@/lib/apps"
import { useUrlKey } from "@/lib/aside-url"
import { useNow } from "@/lib/dashboard"
import { fetchPlan, PLAN_QUERY_KEY, zoneTime } from "@/lib/plan"
import { fetchReport, REPORT_QUERY_KEY } from "@/lib/report"
import { SETUP } from "@/lib/setup"
import { relativeTime } from "@/lib/time"

const { description: DESCRIPTION, title: TITLE } = appById("plan")

// A plan table: rows in the plan's order, or one muted line when the part is empty.
function PlanTable<T extends RowData>({
  columnConfig,
  columns,
  empty,
  getRowId,
  label,
  rows,
}: {
  columnConfig: Record<string, ColumnConfig>
  columns: ColumnDef<Features, T, unknown>[]
  empty: string
  getRowId: (row: T) => string
  label: string
  rows: T[]
}) {
  const table = useStaticTable({ columnConfig, columns, data: rows, getRowId })
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>
  return <DataTable aria-label={label} size="sm" table={table} />
}

function Lane({ lane }: { lane: PlanLane }) {
  const rows: LaneRow[] = lane.items.map((item) => ({
    ...item,
    runBy: item.worker ?? lane.worker ?? null,
  }))
  const id = `plan-lane-${lane.id}`
  return (
    <Section
      id={id}
      title={
        <>
          {lane.title}
          {lane.worker && (
            <>
              {" · "}
              <AgentLink name={lane.worker} />
            </>
          )}
        </>
      }
    >
      <PlanTable
        columnConfig={laneColumnConfig}
        columns={laneColumns}
        empty="Nothing planned in this lane."
        getRowId={(row) => row.id}
        label={`${lane.title} lane`}
        rows={rows}
      />
    </Section>
  )
}

function PlanSections({ now, plan }: { now: Date; plan: Plan }) {
  return (
    <>
      <Section id="plan-in-flight" title="In flight">
        <PlanTable
          columnConfig={inFlightColumnConfig}
          columns={inFlightColumns}
          empty="Nothing is being built right now."
          getRowId={(row) => row.id}
          label="What is being built"
          rows={plan.inFlight}
        />
      </Section>
      <Section id="plan-landing" title="Landing next">
        <PlanTable
          columnConfig={landingColumnConfig}
          columns={landingColumns}
          empty="Nothing is due to land."
          getRowId={(row) => row.id}
          label="What lands next"
          rows={plan.landingNext}
        />
      </Section>
      {plan.lanes.map((lane) => (
        <Lane key={lane.id} lane={lane} />
      ))}
      <Section id="plan-done" title="Done today">
        <PlanTable
          columnConfig={doneColumnConfig}
          columns={doneColumns(now)}
          empty="Nothing has merged today."
          getRowId={(row) => row.pr}
          label="What merged today"
          rows={plan.doneToday}
        />
      </Section>
    </>
  )
}

// The subtitle: when the plan was groomed, or the app's description until it has read.
const planSubtitle = (
  plan: Plan | null | undefined,
  stale: boolean,
  now: Date,
  zone: string | undefined,
): string =>
  plan
    ? `${stale ? "Last good read, groomed" : "Groomed"} ${relativeTime(plan.generatedAt, now)}${zone ? `, at ${zoneTime(plan.generatedAt, zone)}` : ""}`
    : DESCRIPTION

// The subtitle on the Report tab: when the report was written, or the app's description until it has read.
const reportSubtitle = (
  report: OpsReport | null | undefined,
  stale: boolean,
  now: Date,
  zone: string | undefined,
): string =>
  report
    ? `${stale ? "Last good read, reported" : "Reported"} ${relativeTime(report.generatedAt, now)}${zone ? `, at ${zoneTime(report.generatedAt, zone)}` : ""}`
    : DESCRIPTION

const VIEWS = ["report", "plan", "board"] as const

// The plan itself: what is in flight (first, at the owner's ask), what lands next, each lane's items and what merged today. As a board, the same plan in columns, its queued items in the owner's order, which he drags to set.
function PlanPanel({ board = false, now }: { board?: boolean; now: Date }) {
  const { data, error, isPending, refetch } = useQuery({
    queryKey: PLAN_QUERY_KEY,
    queryFn: fetchPlan,
    refetchInterval: 60_000,
  })
  if (isPending) return <Spinner />
  if (error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>The plan could not be read</EmptyTitle>
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
  return (
    <div className="flex flex-col gap-6">
      {data.problems.length > 0 && (
        <Problems
          problems={data.problems}
          title={
            data.plan && !data.stale
              ? "Part of the plan did not read"
              : "The plan does not read now"
          }
        />
      )}
      {data.plan ? (
        board ? (
          <PlanBoard order={data.order?.lanes ?? null} plan={data.plan} />
        ) : (
          <PlanSections now={now} plan={data.plan} />
        )
      ) : (
        <SetupEmpty setup={SETUP.plan} />
      )}
    </div>
  )
}

// The Plan app: the ops report in plain words (the Report tab, which opens first), the plan the planner writes, and the plan as a board, where the owner drags queued items to set the build order (its one write, order.json; the plan itself stays the planner's).
export function PlanView() {
  const now = new Date(useNow())
  const { allowed } = useDashboard()
  const [view, setView] = useQueryState(
    useUrlKey("view"),
    parseAsStringLiteral(VIEWS).withDefault("report"),
  )
  const plan = useQuery({ enabled: allowed, queryKey: PLAN_QUERY_KEY, queryFn: fetchPlan })
  const report = useQuery({ enabled: allowed, queryKey: REPORT_QUERY_KEY, queryFn: fetchReport })
  const zone = useOwnerZone()
  const description =
    view !== "report"
      ? planSubtitle(plan.data?.plan, plan.data?.stale ?? false, now, zone)
      : reportSubtitle(report.data?.report, report.data?.stale ?? false, now, zone)
  const header = <PageHeader title={TITLE} description={description} />
  if (!allowed) {
    return (
      <>
        {header}
        <OwnerOnly />
      </>
    )
  }
  return (
    <>
      {header}
      <div className="flex flex-col gap-6">
        <Tabs
          value={view}
          onValueChange={(next) => {
            const picked = VIEWS.find((value) => value === next)
            if (picked) void setView(picked)
          }}
          className="gap-6"
        >
          <TabsList>
            <TabsTrigger value="report" className="text-xs">
              Report
            </TabsTrigger>
            <TabsTrigger value="plan" className="text-xs">
              Plan
            </TabsTrigger>
            <TabsTrigger value="board" className="text-xs">
              Board
            </TabsTrigger>
          </TabsList>
          <TabsContent value="report">
            <ReportPanel now={now} />
          </TabsContent>
          <TabsContent value="plan">
            <PlanPanel now={now} />
          </TabsContent>
          <TabsContent value="board">
            <PlanPanel board now={now} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
