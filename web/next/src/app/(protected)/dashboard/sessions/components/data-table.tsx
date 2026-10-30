"use client"
"use no memo"

import type { InferRequestType } from "hono/client"

import {
  sessionsColumnConfig,
  sessionsColumns,
} from "@/app/(protected)/dashboard/sessions/components/data-columns"
import { useDashboard } from "@/components/dashboard/dashboard"
import { OwnerOnly } from "@/components/dashboard/owner-only"
import { SetupEmpty } from "@/components/dashboard/setup-empty"
import {
  DataTable,
  DataTableFacetedFilter,
  DataTableToolbar,
  useDataTable,
  type DataTablePage,
  type DataTablePageInput,
} from "@/components/data-table"
import { agentLabel } from "@/lib/agent-label"
import { apiClient, unwrap } from "@/lib/api/client"
import { acceptedFacet, resolveSort } from "@/lib/data-table-layout"
import { KIND_LABELS, SESSION_KINDS, type SessionSummary } from "@/lib/sessions"
import { SETUP } from "@/lib/setup"

const DEFAULT_SORT = { desc: true, id: "lastActive" }
const DEFAULT_SORTING = [DEFAULT_SORT]

// Column ids mapped to the endpoint's sort whitelist; satisfies makes a server-side rename a compile error here.
type SessionSort = NonNullable<InferRequestType<typeof apiClient.v1.sessions.$get>["query"]["sort"]>
const SORT_FIELDS = {
  cost: "cost",
  entries: "entries",
  lastActive: "lastActive",
} as const satisfies Record<string, SessionSort>
const KIND_OPTIONS = SESSION_KINDS.map((value) => ({ label: KIND_LABELS[value], value }))
// Mirrors the endpoint's q cap so a hand-written URL cannot 400 the table.
const Q_MAX = 254

async function fetchSessions({
  filters,
  page,
  perPage,
  search,
  sorting,
}: DataTablePageInput): Promise<DataTablePage<SessionSummary>> {
  const kinds = acceptedFacet(filters.kind, SESSION_KINDS)
  const names = filters.session ?? []
  const sort = sorting.length ? sorting[0] : DEFAULT_SORT
  const { data, error } = await unwrap(
    apiClient.v1.sessions.$get({
      query: {
        dir: sort.desc ? "desc" : "asc",
        kind: kinds.length ? kinds.join(",") : undefined,
        name: names.length ? names.join(",") : undefined,
        page: `${page}`,
        perPage: `${perPage}`,
        q: search ? search.slice(0, Q_MAX) : undefined,
        sort: resolveSort(SORT_FIELDS, sort.id, "lastActive"),
      },
    }),
  )
  if (error) throw new Error(error.message)
  return { rows: data.sessions, hasNextPage: data.hasNextPage, page: data.page, total: data.total }
}

// Every session the importer has read, newest activity first: searching matches a name, task, title or id, or any word a session's log holds.
function SessionsTable() {
  const { table, tableProps } = useDataTable({
    batchSize: 50,
    columnConfig: sessionsColumnConfig,
    columns: sessionsColumns,
    defaultSorting: DEFAULT_SORTING,
    fetchPage: fetchSessions,
    filterIds: ["kind", "session"],
    getRowId: (row) => row.id,
    queryKey: "sessions",
  })
  // A session's chain links here with its name (?session=<name>); the facet shows that name so it can be cleared, and offers none otherwise.
  const named = table.getColumn("session")?.getFilterValue()
  const nameOptions = Array.isArray(named)
    ? (named as string[]).map((value) => ({ label: agentLabel(value), value }))
    : []

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <DataTableToolbar
        table={table}
        searchMaxLength={Q_MAX}
        searchPlaceholder="Search sessions and their logs..."
        size="sm"
      >
        <DataTableFacetedFilter
          column={table.getColumn("kind")}
          options={KIND_OPTIONS}
          size="sm"
          title="Kind"
        />
        {nameOptions.length > 0 && (
          <DataTableFacetedFilter
            column={table.getColumn("session")}
            options={nameOptions}
            size="sm"
            title="Name"
          />
        )}
      </DataTableToolbar>
      <DataTable
        {...tableProps}
        aria-label="Sessions"
        size="sm"
        empty={<SetupEmpty setup={SETUP.sessionsLog} />}
      />
    </div>
  )
}

export function SessionsDataTable() {
  const { allowed } = useDashboard()
  if (!allowed) {
    return <OwnerOnly title="Sessions are for the owner" why="They hold every session's log" />
  }
  return <SessionsTable />
}
