"use client"
"use no memo"

import type { ColumnDef } from "@tanstack/react-table"
import Link from "next/link"

import {
  DataTableCellText,
  DataTableColumnHeader,
  type ColumnConfig,
} from "@/components/data-table"
import { Hint } from "@/components/hint"
import type { Features } from "@/lib/data-table-features"
import {
  formatCost,
  formatCount,
  kindLabel,
  sessionLabel,
  statusLabel,
  type SessionSummary,
} from "@/lib/sessions"
import { relativeTime } from "@/lib/time"

export const sessionsColumnConfig: Record<string, ColumnConfig> = {
  session: { extra: 30 },
  task: { extra: 40, flex: true },
  kind: { extra: 20 },
  status: {},
  lastActive: { extra: 12, numeric: true },
  entries: { numeric: true },
  cost: { numeric: true },
}

const DASH = "-"

export const sessionsColumns: ColumnDef<Features, SessionSummary, unknown>[] = [
  {
    id: "session",
    // Its name, so the Name filter a chain links to can filter on it; the column itself stays shown.
    accessorFn: (row) => row.name ?? "",
    enableHiding: false,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => (
      <DataTableCellText column={column}>
        <Hint content={row.original.name ?? undefined}>
          <Link
            href={`/dashboard/sessions/${encodeURIComponent(row.original.id)}`}
            className="font-medium hover:underline"
          >
            {sessionLabel(row.original)}
          </Link>
        </Hint>
      </DataTableCellText>
    ),
    enableSorting: false,
    meta: { label: "Session" },
  },
  {
    id: "task",
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    // While searching, the line of the log that matched says why the row is here; otherwise what the session was asked.
    cell: ({ column, row }) => (
      <DataTableCellText column={column} className="text-muted-foreground">
        {row.original.match || row.original.task || DASH}
      </DataTableCellText>
    ),
    enableSorting: false,
    meta: { label: "Task" },
  },
  {
    id: "kind",
    accessorFn: (row) => row.kind ?? "",
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => (
      <DataTableCellText column={column}>{kindLabel(row.original.kind)}</DataTableCellText>
    ),
    enableSorting: false,
    meta: { label: "Kind" },
  },
  {
    id: "status",
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => (
      <DataTableCellText
        column={column}
        className={row.original.live ? "text-success" : "text-muted-foreground"}
      >
        {statusLabel(row.original)}
      </DataTableCellText>
    ),
    enableSorting: false,
    meta: { label: "Status" },
  },
  {
    id: "lastActive",
    accessorFn: (row) => row.lastActiveAt ?? "",
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    // Rows only ever render on the client, so the reader's own clock is safe to read here.
    cell: ({ column, row }) => (
      <DataTableCellText column={column} className="text-muted-foreground">
        {row.original.lastActiveAt ? relativeTime(row.original.lastActiveAt, new Date()) : DASH}
      </DataTableCellText>
    ),
    meta: { label: "Last active" },
  },
  {
    id: "entries",
    accessorFn: (row) => row.entryCount,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => (
      <DataTableCellText column={column}>
        {formatCount(row.original.entryCount ?? 0)}
      </DataTableCellText>
    ),
    meta: { label: "Lines" },
  },
  {
    id: "cost",
    accessorFn: (row) => row.costUsd ?? -1,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => (
      <DataTableCellText column={column}>{formatCost(row.original.costUsd)}</DataTableCellText>
    ),
    meta: { label: "Cost" },
  },
]
