"use client"
"use no memo"

import type {
  AccountUsage,
  PrCost,
  Spend,
  UsageReport,
  WindowView,
  ZaiUsage,
  ZaiWindow,
} from "@api/hono"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { useState } from "react"
import { Bar, BarChart, XAxis, YAxis } from "recharts"

import { useDashboard } from "@/components/dashboard/dashboard"
import { OwnerOnly } from "@/components/dashboard/owner-only"
import { SetupEmpty } from "@/components/dashboard/setup-empty"
import {
  DataTable,
  DataTableCellText,
  DataTableColumnHeader,
  numberColumn,
  textColumn,
  useStaticTable,
  type ColumnConfig,
  type Features,
} from "@/components/data-table"
import { PageHeader } from "@/components/shell/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { appById } from "@/lib/apps"
import { useNow } from "@/lib/dashboard"
import { SETUP } from "@/lib/setup"
import { byWeekReset, joinedLine } from "@/lib/system"
import { relativeTime } from "@/lib/time"
import {
  fetchUsage,
  forecastLine,
  type Period,
  tokensLabel,
  topFor,
  USAGE_QUERY_KEY,
  usdLabel,
  wallLabel,
} from "@/lib/usage"

const { description: DESCRIPTION, title: TITLE } = appById("usage")

const PERIOD_LABELS: Record<Period, string> = { today: "Today", week: "Last 7 days" }

const TOP_SESSIONS = 20

const burnConfig: ChartConfig = { usd: { color: "var(--chart-2)", label: "Dollars" } }

function Section({
  children,
  id,
  title,
}: {
  children: React.ReactNode
  id: string
  title: string
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-muted-foreground text-sm font-medium">
        {title}
      </h2>
      {children}
    </section>
  )
}

// One row of a spend table: what spent, a muted second word (a role, the session it came from), and the period's spend.
type SpendRow = { id: string; name: React.ReactNode; second: string; spend: Spend }

const spendColumns = (
  name: string,
  second: string | null,
): ColumnDef<Features, SpendRow, unknown>[] => [
  textColumn<SpendRow>("name", name, (row) => row.name),
  ...(second ? [textColumn<SpendRow>("second", second, (row) => row.second, true)] : []),
  numberColumn<SpendRow>(
    "calls",
    "Calls",
    (row) => row.spend.calls,
    (row) => Math.round(row.spend.calls).toLocaleString(),
  ),
  numberColumn<SpendRow>(
    "tokens",
    "Tokens",
    (row) => row.spend.tokens,
    (row) => tokensLabel(row.spend.tokens),
  ),
  numberColumn<SpendRow>(
    "usd",
    "Dollars",
    (row) => row.spend.usd,
    (row) => usdLabel(row.spend.usd),
  ),
]

export const usageSpendConfig: Record<string, ColumnConfig> = {
  name: { extra: 36, flex: true },
  second: { extra: 24 },
  calls: { numeric: true },
  tokens: { numeric: true },
  usd: { numeric: true },
}

const AGENT_COLUMNS = spendColumns("Agent", "Role")
const SESSION_COLUMNS = spendColumns("Session", "Started from")
const MODEL_COLUMNS = spendColumns("Model", null)
const PERIOD_COLUMNS = spendColumns("Period", null)

// A spend table: rows in the order given (dearest first), each number column sortable.
function SpendTable({
  columns,
  label,
  rows,
}: {
  columns: ColumnDef<Features, SpendRow, unknown>[]
  label: string
  rows: SpendRow[]
}) {
  const table = useStaticTable({
    columnConfig: usageSpendConfig,
    columns,
    data: rows,
    getRowId: (row) => row.id,
  })
  return <DataTable aria-label={label} size="sm" table={table} />
}

type WindowRow = { id: string; label: string; window: WindowView | null }

const windowColumns = (now: Date): ColumnDef<Features, WindowRow, unknown>[] => [
  textColumn<WindowRow>("window", "Window", (row) => row.label),
  textColumn<WindowRow>("used", "Used", (row) =>
    row.window ? `${Math.round(row.window.usedPercent)}%` : "No reading",
  ),
  textColumn<WindowRow>(
    "forecast",
    "Forecast",
    (row) => (row.window ? forecastLine(row.window, now) : "-"),
    true,
  ),
]

export const usageWindowConfig: Record<string, ColumnConfig> = {
  window: { extra: 12 },
  used: { extra: 12, numeric: true },
  forecast: { extra: 48, flex: true, wrap: true },
}

const percentOf = (window: AccountUsage["usage"]["sevenDay"]): string =>
  window ? `${Math.round(window.usedPercent)}%` : "No reading"

const accountColumns = (now: Date): ColumnDef<Features, AccountUsage, unknown>[] => [
  textColumn<AccountUsage>("account", "Account", (row) => row.account),
  textColumn<AccountUsage>("fiveHour", "5-hour", (row) => percentOf(row.usage.fiveHour)),
  textColumn<AccountUsage>("week", "Week", (row) => percentOf(row.usage.sevenDay)),
  textColumn<AccountUsage>(
    "read",
    "Read",
    (row) => `${relativeTime(row.usage.writtenAt, now)}${row.usage.stale ? ", stale" : ""}`,
    true,
  ),
]

export const usageAccountConfig: Record<string, ColumnConfig> = {
  account: { extra: 48, wrap: true },
  fiveHour: { extra: 12, numeric: true },
  week: { extra: 12, numeric: true },
  read: { extra: 48, flex: true, wrap: true },
}

// Every account's own share of each window over one row per account, when there are two or more, above the windows table and its forecast.
function Accounts({ accounts, now }: { accounts: AccountUsage[]; now: Date }) {
  const table = useStaticTable({
    columnConfig: usageAccountConfig,
    columns: accountColumns(now),
    data: accounts,
    getRowId: (row) => row.account,
  })
  return (
    <>
      <p className="text-sm">
        {joinedLine({ account: null, accounts, usage: null }, now.getTime())}
      </p>
      <DataTable aria-label="Each account" size="sm" table={table} />
    </>
  )
}

function ZaiLines({ now, zai }: { now: Date; zai: ZaiUsage | null }) {
  if (!zai) {
    return (
      <p className="text-muted-foreground text-xs">
        No GLM reading yet: the GLM usage job saves the credit windows every 5 minutes.
      </p>
    )
  }
  const line = (label: string, window: ZaiWindow | null) => (
    <p key={label}>
      {label}:{" "}
      {window
        ? `${window.used.toLocaleString("en-US")} of ${window.cap.toLocaleString("en-US")} credits (${Math.round((window.used / window.cap) * 100)}%), resets ${window.resetsAt ? relativeTime(window.resetsAt, now) : "an unknown time"}`
        : "can't read"}
    </p>
  )
  return (
    <div className="text-muted-foreground text-xs">
      {line("GLM 5-hour", zai.fiveHour)}
      {line("GLM week", zai.week)}
      <p>Read {relativeTime(zai.writtenAt, now)} from the ops-zai-usage job.</p>
    </div>
  )
}

function Windows({ now, report }: { now: Date; report: UsageReport }) {
  const { windows } = report
  const table = useStaticTable({
    columnConfig: usageWindowConfig,
    columns: windowColumns(now),
    data: windows
      ? [
          { id: "five", label: "5-hour", window: windows.fiveHour },
          { id: "week", label: "Week", window: windows.sevenDay },
        ]
      : [],
    getRowId: (row) => row.id,
  })
  return (
    <Section id="usage-windows" title="Usage windows">
      {report.accounts.length > 1 && <Accounts accounts={byWeekReset(report.accounts)} now={now} />}
      {windows ? (
        <>
          <DataTable aria-label="Each window" size="sm" table={table} />
          <p className="text-muted-foreground text-xs">
            The usage job wrote these {relativeTime(windows.writtenAt, now)}. The forecast assumes
            the burn since the window opened goes on at the same rate.
          </p>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">
          No reading yet: the usage job writes the windows every 5 minutes.
        </p>
      )}
      <ZaiLines now={now} zai={report.zai} />
    </Section>
  )
}

function Totals({ report }: { report: UsageReport }) {
  return (
    <SpendTable
      columns={PERIOD_COLUMNS}
      label="Spend by period"
      rows={(["today", "week"] as const).map((period) => ({
        id: period,
        name: PERIOD_LABELS[period],
        second: "",
        spend: report.totals[period],
      }))}
    />
  )
}

const hourLabel = (at: string): string =>
  new Date(at).toLocaleTimeString("en-US", { hour: "numeric" })

function Burn({ report }: { report: UsageReport }) {
  const points = report.hours.map((hour) => ({ ...hour, label: hourLabel(hour.at) }))
  return (
    <Section id="usage-burn" title="Hourly burn, last 24 hours">
      <ChartContainer
        config={burnConfig}
        className="aspect-auto h-40 w-full"
        role="img"
        aria-label="Dollars spent each hour over the last 24 hours"
      >
        <BarChart data={points} margin={{ bottom: 0, left: 16, right: 16, top: 4 }}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={3} />
          <YAxis hide />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const point = payload?.[0]?.payload as (typeof points)[number] | undefined
                  return point ? `${point.label}: ${tokensLabel(point.tokens)} tokens` : ""
                }}
                formatter={(value) => usdLabel(Number(value))}
              />
            }
          />
          <Bar dataKey="usd" fill="var(--color-usd)" radius={2} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </Section>
  )
}

function ByAgent({ period, report }: { period: Period; report: UsageReport }) {
  return (
    <Section id="usage-agents" title="By agent">
      <SpendTable
        columns={AGENT_COLUMNS}
        label="Spend by agent"
        rows={topFor(report.agents, period).map((agent) => ({
          id: agent.label,
          name: agent.label,
          second: agent.role,
          spend: agent[period],
        }))}
      />
      <p className="text-muted-foreground text-xs">
        A subagent, fork or headless run counts toward the session it was started from.
      </p>
    </Section>
  )
}

function BySession({ period, report }: { period: Period; report: UsageReport }) {
  return (
    <Section id="usage-sessions" title="Costliest sessions">
      <SpendTable
        columns={SESSION_COLUMNS}
        label="Sessions by spend"
        rows={topFor(report.sessions, period, TOP_SESSIONS).map((session) => ({
          id: session.id,
          name: session.label,
          second: session.parent ?? "-",
          spend: session[period],
        }))}
      />
    </Section>
  )
}

function ByModel({ period, report }: { period: Period; report: UsageReport }) {
  return (
    <Section id="usage-models" title="By model">
      <SpendTable
        columns={MODEL_COLUMNS}
        label="Spend by model"
        rows={topFor(report.models, period).map((model) => ({
          id: model.model,
          name: (
            <>
              {model.model}
              {!model.priced && <span className="text-muted-foreground"> (no price)</span>}
            </>
          ),
          second: "",
          spend: model[period],
        }))}
      />
    </Section>
  )
}

const fixLabel = (pr: PrCost): string =>
  pr.fixes.length === 0 ? "None yet" : pr.fixes.map((n) => `#${n}`).join(", ")

const prColumns: ColumnDef<Features, PrCost, unknown>[] = [
  {
    id: "pr",
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => (
      <DataTableCellText column={column}>
        <a href={row.original.url} target="_blank" rel="noreferrer" className="underline">
          {row.original.repo}#{row.original.number}
        </a>{" "}
        <span className="text-muted-foreground">{row.original.title}</span>
      </DataTableCellText>
    ),
    enableSorting: false,
    meta: { label: "PR" },
  },
  textColumn<PrCost>("worker", "Worker", (row) => row.worker),
  numberColumn<PrCost>(
    "build",
    "Build",
    (row) => row.workerSpend.usd,
    (row) => usdLabel(row.workerSpend.usd),
  ),
  numberColumn<PrCost>(
    "review",
    "Review",
    (row) => row.review.usd,
    (row) => usdLabel(row.review.usd),
  ),
  numberColumn<PrCost>(
    "test",
    "Test",
    (row) => row.test.usd,
    (row) => usdLabel(row.test.usd),
  ),
  numberColumn<PrCost>(
    "tokens",
    "Tokens",
    (row) => row.total.tokens,
    (row) => tokensLabel(row.total.tokens),
  ),
  numberColumn<PrCost>(
    "total",
    "Total",
    (row) => row.total.usd,
    (row) => usdLabel(row.total.usd),
  ),
  numberColumn<PrCost>(
    "rounds",
    "Rounds",
    (row) => row.rounds,
    (row) => `${row.rounds}`,
  ),
  numberColumn<PrCost>(
    "wall",
    "Wall",
    (row) => row.wallMinutes ?? 0,
    (row) => wallLabel(row.wallMinutes),
  ),
  textColumn<PrCost>("fixes", "Fix within 7 days", (row) => fixLabel(row)),
]

export const usagePrConfig: Record<string, ColumnConfig> = {
  pr: { extra: 64, flex: true },
  worker: { extra: 18 },
  build: { numeric: true },
  review: { numeric: true },
  test: { numeric: true },
  tokens: { numeric: true },
  total: { numeric: true },
  rounds: { numeric: true },
  wall: { numeric: true },
  fixes: { extra: 6 },
}

function Prs({ report }: { report: UsageReport }) {
  const table = useStaticTable({
    columnConfig: usagePrConfig,
    columns: prColumns,
    data: report.prs,
    getRowId: (row) => row.url,
  })
  return (
    <Section id="usage-prs" title="Cost per merged PR, last 7 days">
      {report.prsPending && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Spinner /> Reading merged PRs from GitHub.
        </p>
      )}
      {report.prs.length === 0 ? (
        !report.prsPending && (
          <p className="text-muted-foreground text-sm">
            No PR a worker opened has merged in the last 7 days.
          </p>
        )
      ) : (
        <>
          <DataTable aria-label="Cost per merged PR" size="sm" table={table} />
          <p className="text-muted-foreground text-xs">
            A PR&apos;s span runs from its worker&apos;s start (or that worker&apos;s previous
            merge) to the merge, and Wall is its length. Build is what the worker spent in it: the
            session that opened the PR or worked its branch, with its subagents. Review and Test are
            the calls of the sessions that reviewed and tested it, split where two of that
            worker&apos;s PRs were open at once. Rounds count the heads a ReviewBot comment scored.
          </p>
        </>
      )}
    </Section>
  )
}

function Calibration({ report }: { report: UsageReport }) {
  const cal = report.calibration
  if (!cal) return null
  return (
    <p className="text-muted-foreground text-xs">
      Dollars are API-equivalent, at the published per-token prices. Over {cal.sessions} exited{" "}
      {cal.sessions === 1 ? "session" : "sessions"} this week they come to {usdLabel(cal.usd)};
      Claude Code&apos;s own totals say {usdLabel(cal.claudeCodeUsd)}.
    </p>
  )
}

function Usage() {
  const [period, setPeriod] = useState<Period>("today")
  const nowMs = useNow()
  const now = new Date(nowMs)
  const { data, error, isPending, refetch } = useQuery({
    queryKey: USAGE_QUERY_KEY,
    queryFn: fetchUsage,
    refetchInterval: (query) => (query.state.data?.prsPending ? 5_000 : 60_000),
  })
  if (isPending) return <Spinner />
  if (error) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Usage could not be read</EmptyTitle>
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
        <Alert>
          <AlertTitle>Part of the usage did not read</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {data.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <Windows now={now} report={data} />
      {data.sessions.length === 0 ? (
        <SetupEmpty setup={SETUP.usage} />
      ) : (
        <>
          <Section id="usage-spend" title="Spend">
            <Totals report={data} />
            <Calibration report={data} />
          </Section>
          <Burn report={data} />
          <ToggleGroup
            aria-label="Period"
            variant="outline"
            value={[period]}
            onValueChange={(value) => {
              const next = value[0]
              if (next === "today" || next === "week") setPeriod(next)
            }}
          >
            {(["today", "week"] as const).map((p) => (
              <ToggleGroupItem key={p} value={p} className="text-xs">
                {PERIOD_LABELS[p]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ByAgent period={period} report={data} />
          <BySession period={period} report={data} />
          <ByModel period={period} report={data} />
          <Prs report={data} />
        </>
      )}
    </div>
  )
}

// The Usage app: what the factory spends, read from the claude_* tables the importer fills and the windows the usage job writes. Read-only.
export function UsageView() {
  const { allowed } = useDashboard()
  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      {allowed ? (
        <div className="flex flex-col gap-4">
          <Usage />
        </div>
      ) : (
        <OwnerOnly />
      )}
    </>
  )
}
