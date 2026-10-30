"use client"
"use no memo"

import type { PlanDone, PlanInFlight, PlanItem, PlanLanding } from "@api/hono"
import type { ColumnDef, RowData } from "@tanstack/react-table"
import { cn } from "cn"

import { AgentLink } from "@/components/dashboard/agent-link"
import {
  DataTableCellText,
  DataTableColumnHeader,
  type ColumnConfig,
} from "@/components/data-table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useNow } from "@/lib/dashboard"
import type { Features } from "@/lib/data-table-features"
import { duration, remaining } from "@/lib/eta"
import { istTime, prLabel, statusLabel } from "@/lib/plan"
import { relativeTime } from "@/lib/time"

const DASH = "-"

// A plain text column, unsorted: the plan's own order is the order things run in.
export const textColumn = <T extends RowData>(
  id: string,
  label: string,
  text: (row: T) => React.ReactNode,
  muted = false,
): ColumnDef<Features, T, unknown> => ({
  id,
  header: ({ column }) => <DataTableColumnHeader column={column} />,
  cell: ({ column, row }) => (
    <DataTableCellText column={column} className={muted ? "text-muted-foreground" : undefined}>
      {text(row.original)}
    </DataTableCellText>
  ),
  enableSorting: false,
  meta: { label },
})

// A kind of live time: how it reads at now (exact for how long something has been on, approximate for what is ahead), and the widest it can read in mono characters ("12d 23h", "overdue 23h 59m"), so a cell keeps its width as it ticks.
type TimeKind = { ch: string; overdue: boolean; words: (at: string, now: number) => string | null }

const ELAPSED: TimeKind = {
  ch: "w-[7ch]",
  overdue: false,
  words: (at, now) => duration(now - Date.parse(at)),
}
const LEFT: TimeKind = { ch: "w-[15ch]", overdue: true, words: (at, now) => remaining(at, now) }
const FROM_NOW: TimeKind = {
  ch: "w-[15ch]",
  overdue: true,
  words: (at, now) => remaining(at, now, "in"),
}

// Column widths in spacing units that hold each kind's widest reading beside the cell's inset.
const ELAPSED_WIDTH = 21
const AHEAD_WIDTH = 33

const TICK_MS = 60_000

// How long something has been on, inside a sentence, where it ends the line and so needs no fixed width.
const SINCE: TimeKind = { ...ELAPSED, ch: "" }

// A time that ticks: read again every minute, mono and right-aligned at a fixed width, its IST clock on hover. A passed time is overdue, in orange, while it is still due, and how long ago it was once it is not (an item that has started or finished).
function LiveTime({ at, due, kind }: { at: string; due: boolean; kind: TimeKind }) {
  const now = useNow(TICK_MS)
  const passed = kind.overdue && Date.parse(at) <= now
  const text = passed && !due ? `${duration(now - Date.parse(at))} ago` : kind.words(at, now)
  if (!text) return DASH
  const late = passed && due
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "inline-block text-right font-mono tabular-nums",
              kind.ch,
              late && "text-caution",
            )}
          />
        }
      >
        {text}
      </TooltipTrigger>
      <TooltipContent>{istTime(at)} IST</TooltipContent>
    </Tooltip>
  )
}

// How long a finding has held, its IST clock on hover, ticking each minute.
export const Since = ({ at }: { at: string }) => <LiveTime at={at} due kind={SINCE} />

// A live time column; due says whether a row's time still counts as owed once passed. Its value is the ISO time, so a sort would order by the moment rather than the words; unsorted, as every plan column is.
const timeColumn = <T extends RowData>(
  id: string,
  label: string,
  at: (row: T) => string | null | undefined,
  kind: TimeKind,
  due: (row: T) => boolean = () => true,
): ColumnDef<Features, T, unknown> => ({
  id,
  accessorFn: (row) => at(row) ?? "",
  header: ({ column }) => <DataTableColumnHeader column={column} />,
  cell: ({ row }) => {
    const value = at(row.original)
    return value ? (
      <LiveTime at={value} due={due(row.original)} kind={kind} />
    ) : (
      <span className="text-muted-foreground">{DASH}</span>
    )
  },
  enableSorting: false,
  meta: { label },
})

const itemCell = (id: string, title: string) => (
  <>
    <span className="text-muted-foreground">{id}</span> {title}
  </>
)

const workerCell = (name: string | null | undefined) => (name ? <AgentLink name={name} /> : DASH)

const prCell = (url: string | null | undefined, text?: string) =>
  url ? (
    <a href={url} target="_blank" rel="noreferrer" className="underline">
      {text ?? prLabel(url)}
    </a>
  ) : (
    (text ?? DASH)
  )

// The planner's status codes for an item that has started, and for one that has finished: its start, then its finish, is no longer owed.
const STARTED = ["DONE", "IN FLIGHT", "IN REVIEW", "MERGED"]
const FINISHED = ["DONE", "MERGED"]

const isOneOf = (status: string | null | undefined, codes: string[]): boolean =>
  Boolean(status && codes.some((code) => status === code || status.startsWith(`${code} `)))

// A lane's item, with the worker that runs it: its own when the plan names one, else its lane's.
export type LaneRow = PlanItem & { runBy: string | null }

export const laneColumnConfig: Record<string, ColumnConfig> = {
  item: { extra: 36, wrap: true },
  outcome: { extra: 48, flex: true, wrap: true },
  status: { extra: 16, wrap: true },
  worker: { extra: 12 },
  start: { align: "right", width: AHEAD_WIDTH },
  finish: { align: "right", width: AHEAD_WIDTH },
  pr: {},
}

export const laneColumns: ColumnDef<Features, LaneRow, unknown>[] = [
  textColumn<LaneRow>("item", "Item", (row) => itemCell(row.id, row.title)),
  textColumn<LaneRow>("outcome", "What you get", (row) => row.outcome, true),
  textColumn<LaneRow>("status", "Status", (row) => statusLabel(row.status)),
  textColumn<LaneRow>("worker", "Worker", (row) => workerCell(row.runBy)),
  timeColumn<LaneRow>(
    "start",
    "Starts",
    (row) => row.start,
    FROM_NOW,
    (row) => !isOneOf(row.status, STARTED),
  ),
  timeColumn<LaneRow>(
    "finish",
    "Finish",
    (row) => row.finish,
    FROM_NOW,
    (row) => !isOneOf(row.status, FINISHED),
  ),
  textColumn<LaneRow>("pr", "PR", (row) => prCell(row.pr)),
]

export const landingColumnConfig: Record<string, ColumnConfig> = {
  item: { extra: 60, flex: true },
  finish: { align: "right", width: AHEAD_WIDTH },
}

export const landingColumns: ColumnDef<Features, PlanLanding, unknown>[] = [
  textColumn<PlanLanding>("item", "Item", (row) => itemCell(row.id, row.title)),
  timeColumn<PlanLanding>("finish", "Finish", (row) => row.finish, FROM_NOW),
]

export const inFlightColumnConfig: Record<string, ColumnConfig> = {
  item: { extra: 12 },
  outcome: { extra: 60, flex: true, wrap: true },
  worker: { extra: 12 },
  pr: {},
  since: { align: "right", width: ELAPSED_WIDTH },
  eta: { align: "right", width: AHEAD_WIDTH },
}

export const inFlightColumns: ColumnDef<Features, PlanInFlight, unknown>[] = [
  textColumn<PlanInFlight>("item", "Item", (row) => row.id),
  textColumn<PlanInFlight>("outcome", "What you get", (row) => row.outcome, true),
  textColumn<PlanInFlight>("worker", "Worker", (row) => workerCell(row.worker)),
  textColumn<PlanInFlight>("pr", "PR", (row) => prCell(row.pr)),
  timeColumn<PlanInFlight>("since", "Elapsed", (row) => row.since, ELAPSED),
  timeColumn<PlanInFlight>("eta", "ETA", (row) => row.eta, LEFT),
]

export const doneColumnConfig: Record<string, ColumnConfig> = {
  pr: {},
  outcome: { extra: 60, flex: true, wrap: true },
  merged: { align: "right", extra: 12 },
}

export const doneColumns = (now: Date): ColumnDef<Features, PlanDone, unknown>[] => [
  textColumn<PlanDone>("pr", "PR", (row) => prCell(row.url, row.pr)),
  textColumn<PlanDone>("outcome", "What you get", (row) => row.outcome, true),
  textColumn<PlanDone>(
    "merged",
    "Merged",
    (row) => (row.at ? relativeTime(row.at, now) : DASH),
    true,
  ),
]
