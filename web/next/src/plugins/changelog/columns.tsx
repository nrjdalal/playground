"use client"
"use no memo"

import type { ChangelogEntry, ChangelogKind } from "@api/hono"
import {
  RiBugLine,
  RiCircleFill,
  RiPriceTag3Line,
  RiScales3Line,
  RiSettings3Line,
  RiSparklingLine,
  RiToolsLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import type { ColumnDef, FilterFn } from "@tanstack/react-table"
import * as React from "react"

import {
  DataTableCellText,
  DataTableColumnHeader,
  type ColumnConfig,
} from "@/components/data-table"
import type { Features } from "@/lib/data-table-features"
import { isUnread } from "@/plugins/changelog/unread"

export const KIND_LABELS: Record<ChangelogKind, string> = {
  feature: "Feature",
  fix: "Fix",
  ops: "Ops",
  release: "Release",
  rule: "Rule",
  setting: "Setting",
}

// Each kind's small mark, at the start of its line so the list fits half the page; its name is in the label and the aside.
export const KIND_ICONS: Record<ChangelogKind, RemixiconComponentType> = {
  feature: RiSparklingLine,
  fix: RiBugLine,
  ops: RiToolsLine,
  release: RiPriceTag3Line,
  rule: RiScales3Line,
  setting: RiSettings3Line,
}

// Versions head their groups rather than sit among the rows, so Release is not a kind to pick.
export const KIND_OPTIONS = (Object.keys(KIND_LABELS) as ChangelogKind[])
  .filter((kind) => kind !== "release")
  .map((value) => ({
    icon: KIND_ICONS[value],
    label: KIND_LABELS[value],
    value,
  }))

// Picks one entry; the page provides it and keeps the pick in the URL.
export const PickEntry = React.createContext<(entry: ChangelogEntry) => void>(() => {})

// This viewer's last look before this visit, so a change that arrived since shows a dot; undefined until the page has read it, which marks nothing.
export const SeenAt = React.createContext<string | null | undefined>(undefined)

// The line with its kind's mark first, inline as a sidebar row's icon sits, so the kind takes no column of its own.
function TextCell({ entry }: { entry: ChangelogEntry }) {
  const pick = React.useContext(PickEntry)
  const seenAt = React.useContext(SeenAt)
  const unread = seenAt !== undefined && isUnread(entry, seenAt)
  const Icon = KIND_ICONS[entry.kind] ?? RiToolsLine
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 text-left"
      onClick={() => pick(entry)}
    >
      <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <span className="sr-only">{KIND_LABELS[entry.kind] ?? entry.kind}:</span>
      <span className="truncate">{entry.text}</span>
      {unread && (
        <>
          <RiCircleFill aria-hidden className="text-primary size-1.5 shrink-0" />
          <span className="sr-only">(new)</span>
        </>
      )}
    </button>
  )
}

const anyOf: FilterFn<Features, ChangelogEntry> = (row, columnId, value) =>
  !Array.isArray(value) || value.length === 0 || value.includes(row.getValue(columnId))

// A PR's number or a version's tag, the shortest name its link has.
export function linkLabel(link: string): string {
  const pr = link.match(/\/pull\/(\d+)$/)?.[1]
  if (pr) return `#${pr}`
  return link.match(/\/releases\/tag\/([^/]+)$/)?.[1] ?? "Link"
}

export const shortWhen = (at: string) =>
  new Date(at).toLocaleString(undefined, { day: "numeric", month: "short" })

// The kind column is hidden (CHANGELOG_VISIBILITY): it is there for the Kind facet to filter by, its mark drawn in the line instead. When is as wide as "Oct 12" needs.
export const changelogColumnConfig: Record<string, ColumnConfig> = {
  kind: {},
  text: { extra: 4, flex: true },
  time: { numeric: true, width: 16 },
}

export const CHANGELOG_VISIBILITY = { kind: false }

export const changelogColumns: ColumnDef<Features, ChangelogEntry, unknown>[] = [
  {
    id: "kind",
    accessorFn: (row) => row.kind,
    header: () => <span className="sr-only">Kind</span>,
    cell: ({ row }) => KIND_LABELS[row.original.kind] ?? row.original.kind,
    filterFn: anyOf,
    enableGlobalFilter: false,
    enableHiding: false,
    enableSorting: false,
    meta: { label: "Kind" },
  },
  {
    id: "text",
    accessorFn: (row) => row.text,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => (
      <DataTableCellText column={column}>
        <TextCell entry={row.original} />
      </DataTableCellText>
    ),
    enableHiding: false,
    enableSorting: false,
    meta: { label: "What changed" },
  },
  {
    id: "time",
    accessorFn: (row) => row.at,
    header: ({ column }) => <DataTableColumnHeader column={column} />,
    cell: ({ column, row }) => (
      <DataTableCellText column={column} className="text-muted-foreground">
        {shortWhen(row.original.at)}
      </DataTableCellText>
    ),
    enableGlobalFilter: false,
    enableHiding: false,
    enableSorting: false,
    meta: { label: "When" },
  },
]
