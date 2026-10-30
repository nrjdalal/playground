"use client"
"use no memo"

import type { Agent } from "@api/hono"
import { useTable, type ColumnDef, type FilterFn } from "@tanstack/react-table"
import { cn } from "cn"
import * as React from "react"

import { AgentLink } from "@/components/dashboard/agent-link"
import { AgentStatus } from "@/components/dashboard/agent-status"
import { useDashboard } from "@/components/dashboard/dashboard"
import { StatusIcon } from "@/components/dashboard/worker-light"
import {
  applyColumnManager,
  DataTable,
  DataTableCellText,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTableToolbar,
  features,
  useDataTableState,
  type ColumnConfig,
  type Features,
} from "@/components/data-table"
import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { chatLabel, labelOf } from "@/lib/agent-label"
import {
  checksOpen,
  doingOf,
  type InboxWait,
  type LiveFacts,
  runnerWhen,
  statusOf,
  statusParts,
} from "@/lib/agents"
import {
  checkerOf,
  agentGroup,
  GROUP_ORDER,
  keepsOther,
  liveState,
  longIdle,
  nestCheckers,
  nestState,
  otherRows,
  useNow,
  type GroupLabel,
} from "@/lib/dashboard"
import { inboxWaitOf, useInbox } from "@/lib/inbox"
import { PR_TONES, prTone } from "@/lib/status-icons"

// One row: the agent, its group, whether it sits under its worker as a reviewer or tester, and for a worker whether one of those is at work.
type StatusRow = {
  agent: Agent
  checkers: boolean
  dispatcher: boolean
  group: GroupLabel
  // what people read for it (labelOf, a dispatcher's Alpha or Bravo as its cell shows it), which the search matches beside its name
  label: string
  member: boolean
}

// The Role facet offers the groups an agent's row can sit in: Scripts holds the ops jobs, never an agent.
export const ROLE_OPTIONS = GROUP_ORDER.filter((label) => label !== "Scripts").map((label) => ({
  label,
  value: label,
}))

const inRoles: FilterFn<Features, StatusRow> = (row, _columnId, value) =>
  !Array.isArray(value) || value.length === 0 || value.includes(row.original.group)

// Agent and Role hold their content (Role its longest group, Orchestrators), Doing takes the slack, and Status fits its longest phrase (Waiting on the merge queue, or Waiting on approvals).
const statusColumnConfig: Record<string, ColumnConfig> = {
  agent: { extra: 36 },
  role: { extra: 18 },
  doing: { extra: 48, flex: true },
  status: { extra: 48 },
}

// Where an agent's row leads: its session's own view while it is live; a down agent has none.
const sessionOf = (agent: Agent): string | null =>
  agent.sessionId && agent.state !== "down" ? agent.sessionId : null

// searching: a search may leave a reviewer or tester without its worker, so none is indented then; liveOf gives what the board knows of a row's live session; still stops the spinners while the live feed is lost
const columnsFor = (
  now: number,
  searching: boolean,
  waitOf: (agent: Agent) => InboxWait = () => null,
  liveOf: (row: StatusRow) => LiveFacts = () => ({}),
  still = false,
): ColumnDef<Features, StatusRow, unknown>[] => [
  {
    accessorFn: (row) => `${row.label} ${row.agent.name}`,
    id: "agent",
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ row }) => (
      <span
        data-root-checker={
          !row.original.member && checkerOf(row.original.agent.name, row.original.agent.kind)
            ? row.original.agent.name
            : undefined
        }
        className={cn(
          "flex min-w-0 items-center gap-2",
          row.original.member && !searching && "pl-4",
        )}
      >
        <StatusIcon
          state={
            statusParts(
              row.original.agent,
              now,
              waitOf(row.original.agent),
              row.original.dispatcher,
              liveOf(row.original),
            ).state
          }
          still={still}
        />
        <AgentLink
          name={row.original.agent.name}
          sessionId={sessionOf(row.original.agent)}
          truncate
        />
      </span>
    ),
    enableHiding: false,
    enableSorting: false,
    meta: { label: "Agent" },
  },
  {
    accessorFn: (row) => row.group,
    id: "role",
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => (
      <DataTableCellText column={column} className="text-muted-foreground">
        {row.original.group}
      </DataTableCellText>
    ),
    filterFn: inRoles,
    enableGlobalFilter: false,
    enableSorting: false,
    meta: { label: "Role" },
  },
  {
    accessorFn: (row) => doingOf(row.agent, row.dispatcher),
    id: "doing",
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => {
      const { agent, dispatcher } = row.original
      // the pull request's number takes its colour, its state said in words on hover and to screen readers
      const tone = prTone(agent)
      const shown = tone ? PR_TONES[tone] : null
      return (
        <DataTableCellText column={column}>
          {doingOf(agent, dispatcher)}
          {agent.pr && (
            <>
              {" · "}
              <Hint content={shown?.words}>
                <a
                  href={agent.pr.url}
                  rel="noreferrer"
                  target="_blank"
                  className={cn("hover:underline", shown?.className)}
                >
                  #{agent.pr.number}
                </a>
              </Hint>
              {shown && <span className="sr-only"> ({shown.words})</span>}
            </>
          )}
        </DataTableCellText>
      )
    },
    enableSorting: false,
    meta: { label: "Doing" },
  },
  {
    accessorFn: (row) =>
      [
        statusOf(row.agent, now, waitOf(row.agent), row.dispatcher, liveOf(row)).text,
        runnerWhen(row.agent),
      ]
        .filter(Boolean)
        .join(" · "),
    id: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => (
      <DataTableCellText column={column}>
        <AgentStatus
          agent={row.original.agent}
          dispatcher={row.original.dispatcher}
          live={liveOf(row.original)}
          now={now}
          waitsOn={waitOf(row.original.agent)}
        />
        {/* an AI runner's row ends with when it runs, as its sidebar row's tooltip does */}
        {runnerWhen(row.original.agent) && ` · ${runnerWhen(row.original.agent)}`}
      </DataTableCellText>
    ),
    enableSorting: false,
    meta: { label: "Status" },
  },
]

// Pure: the table's rows in the sidebar's order (GROUP_ORDER, each reviewer and tester under its worker, one the roster ended with no live session left out since its check is done), with Other agents idle for over three hours left out unless showIdle, and how many were left out.
export function statusRows(
  agents: Agent[],
  view: {
    activeAt: (agent: Agent) => string | null
    // every live session holding the dispatcher role, the second's included (#i520), with the label its chat names it by (chatLabel)
    dispatchers: ReadonlyMap<string, string>
    isWaiting: (agent: Agent) => boolean
    // the usage limit alone holds its session, so it ranks below the working rows as the sidebar's does
    isPaused?: (agent: Agent) => boolean
    // an agent's held light, as the sidebar's rows read it
    light?: (agent: Agent) => Agent["state"]
    now: number
    showIdle: boolean
  },
): { idle: number; rows: StatusRow[] } {
  const kept = agents.filter(
    (agent) =>
      !(checkerOf(agent.name, agent.kind) && agent.status === "ended" && agent.state === "down"),
  )
  const lightOf = view.light ?? ((agent: Agent) => agent.state)
  const rowOf = (agent: Agent, group: GroupLabel, member = false, checkers = false): StatusRow => {
    const chat = agent.sessionId === null ? undefined : view.dispatchers.get(agent.sessionId)
    return {
      agent,
      checkers,
      dispatcher: chat !== undefined,
      group,
      label: chat ?? labelOf(agent, (name) => agents.find((a) => a.name === name)),
      member,
    }
  }
  let idle = 0
  // one nest over Orchestrators and Subagents, so a checker nests under its lead wherever it sits (a train tester under its lead, a reviewer under a roster worker whose session is gone); each row renders in its lead's group
  const placed = nestCheckers(
    GROUP_ORDER.flatMap((group) =>
      group === "Orchestrators" || group === "Subagents"
        ? kept.filter((agent) => agentGroup(agent) === group)
        : [],
    ),
    {
      group: (agent) => (agentGroup(agent) === "Orchestrators" ? 0 : 1),
      kind: (agent) => agent.kind,
      name: (agent) => agent.name,
      pr: (agent) => agent.pr?.number ?? null,
      state: (agent) =>
        nestState(agent.state, view.isPaused?.(agent) ?? false, view.isWaiting(agent)),
      worker: (agent) => agent.worker,
    },
  )
  const rows = GROUP_ORDER.flatMap((group) => {
    const members = kept.filter((agent) => agentGroup(agent) === group)
    if (group === "Orchestrators" || group === "Subagents")
      return placed
        .filter(({ lead }) => agentGroup(lead) === group)
        .flatMap(({ lead, members: checkers }) => [
          rowOf(lead, group, false, checksOpen(checkers.map(lightOf))),
          ...checkers.map((agent) => rowOf(agent, group, true)),
        ])
    if (group === "Other") {
      const shown = otherRows(members, {
        idle: (agent) => longIdle(agent.state, view.activeAt(agent), view.now),
        keep: (agent) => keepsOther(agent.state, view.isWaiting(agent), false),
        open: true,
        showIdle: view.showIdle,
      })
      idle = shown.idle
      return shown.rows.map((agent) => rowOf(agent, group))
    }
    return members.map((agent) => rowOf(agent, group))
  })
  return { idle, rows }
}

// Every agent on one row, Agent | Role | Doing | Status, on the console's table: search and a Role facet in one toolbar row, in statusRows' order, so nothing sorts it. Other agents idle for over three hours wait behind Show N idle, as the sidebar keeps them. A row's name opens that agent's own view. onRows hears how many rows it shows, for the System page's next load.
export function StatusTable({
  actions,
  agents,
  onRows,
  readingRows,
}: {
  actions?: React.ReactNode
  agents: Agent[]
  onRows?: (rows: number) => void
  // while the board loads: the real toolbar, disabled, and the real header over this many empty rows at the real row's height, the first reading "Reading agents…", so nothing shimmers and nothing moves when the rows land
  readingRows?: number
}) {
  const { allowed, connected, dispatcher, feedProblem, held, other, waiting, workers } =
    useDashboard()
  const still = liveState(connected, workers, feedProblem) === "Lost"
  const items = useInbox(allowed).data?.items
  const now = useNow()
  const { idle, rows } = statusRows(agents, {
    // A session's last activity as the sidebar reads it, none counting as recent there too, so both hide the same sessions as idle.
    activeAt: (agent) =>
      workers?.find((w) => w.sessionId === agent.sessionId)?.lastActiveAt ?? null,
    dispatchers: new Map(
      (workers ?? [])
        .filter((w) => w.role === "dispatcher")
        .map((w) => [w.sessionId, chatLabel(w, dispatcher)]),
    ),
    isPaused: (agent) => Boolean(workers?.find((w) => w.sessionId === agent.sessionId)?.usageLimit),
    isWaiting: (agent) => agent.sessionId !== null && waiting.has(agent.sessionId),
    light: (agent) =>
      agent.state === "down" || !agent.sessionId
        ? agent.state
        : (held.get(agent.sessionId) ?? agent.state),
    now,
    showIdle: other.showIdle,
  })

  const { columnFilters, globalFilter, onColumnFiltersChange, onGlobalFilterChange } =
    useDataTableState(["role"])
  const searching = Boolean(globalFilter)
  const columns = React.useMemo(
    () =>
      applyColumnManager(
        columnsFor(
          now,
          searching,
          (agent) => inboxWaitOf(items ?? [], agent.name),
          (row) => {
            const worker = workers?.find((w) => w.sessionId === row.agent.sessionId) ?? null
            return {
              checkers: row.checkers,
              light: worker ? (held.get(worker.sessionId) ?? worker.light) : undefined,
              worker,
            }
          },
          still,
        ),
        statusColumnConfig,
      ),
    [held, items, now, searching, still, workers],
  )
  const table = useTable({
    columns,
    data: rows,
    state: { columnFilters, globalFilter },
    defaultColumn: { minSize: 0 },
    features,
    getRowId: (row) => row.agent.sessionId ?? row.agent.name,
    onColumnFiltersChange,
    onGlobalFilterChange,
  })

  const shown = table.getRowModel().rows.length
  React.useEffect(() => {
    onRows?.(shown)
  }, [onRows, shown])

  // Show N idle counts the Other group's agents alone, so it offers itself only where they can show
  const roles = columnFilters.find((filter) => filter.id === "role")?.value
  const showsOther = !Array.isArray(roles) || roles.length === 0 || roles.includes("Other")

  const reading = readingRows !== undefined
  return (
    <div aria-busy={reading || undefined} className="flex flex-col gap-2">
      {/* a disabled fieldset disables every control in the toolbar while the board loads, drawn where it will stay */}
      <fieldset disabled={reading} className="contents">
        <DataTableToolbar
          table={table}
          actions={actions}
          searchPlaceholder="Search agents..."
          size="sm"
        >
          <DataTableFacetedFilter
            column={table.getColumn("role")}
            options={ROLE_OPTIONS}
            size="sm"
            title="Role"
          />
          {showsOther && (idle > 0 || other.showIdle) && (
            <Button
              variant="ghost"
              className="text-xs"
              onClick={() => other.setShowIdle(!other.showIdle)}
            >
              {other.showIdle ? "Hide idle" : `Show ${idle} idle`}
            </Button>
          )}
        </DataTableToolbar>
      </fieldset>
      <DataTable
        aria-label="Every agent"
        pending={reading ? <ReadingRows rows={readingRows} /> : undefined}
        size="sm"
        table={table}
      />
    </div>
  )
}

// The rows the table holds while the board loads, each empty at the real one-line row's height (a cell's padding around the agent's 16px light), the first saying what it waits on in plain muted text.
export function ReadingRows({ rows }: { rows: number }) {
  return (
    <Table className="grid text-xs">
      <TableBody className="grid">
        {Array.from({ length: rows }, (_, i) => (
          <TableRow key={i} data-reading-row="" className="flex w-full">
            <TableCell className="text-muted-foreground flex w-full items-center">
              <span className="flex h-4 items-center">{i === 0 ? "Reading agents…" : null}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
