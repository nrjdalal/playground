"use client"
"use no memo"

import type { ChangelogEntry } from "@api/hono"
import { RiGitMergeLine, RiPriceTag3Line } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { useTable } from "@tanstack/react-table"
import { cn } from "cn"
import { parseAsString, useQueryState } from "nuqs"
import * as React from "react"

import { useDashboard } from "@/components/dashboard/dashboard"
import { OwnerOnly } from "@/components/dashboard/owner-only"
import { SetupEmpty } from "@/components/dashboard/setup-empty"
import {
  applyColumnManager,
  DataTable,
  DataTableFacetedFilter,
  DataTableToolbar,
  features,
  useDataTableState,
} from "@/components/data-table"
import { SHELF_ITEM, SHELF_ROW, STICKY_HEADER } from "@/components/shelf"
import { ShelfMark } from "@/components/shelf-mark"
import { PageHeader } from "@/components/shell/page-header"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Spinner } from "@/components/ui/spinner"
import { useIsMobile } from "@/hooks/use-mobile"
import { apiClient, unwrap } from "@/lib/api/client"
import { appById } from "@/lib/apps"
import { useInAside, useUrlKey } from "@/lib/aside-url"
import { SETUP } from "@/lib/setup"
import {
  CHANGELOG_VISIBILITY,
  changelogColumnConfig,
  changelogColumns,
  KIND_OPTIONS,
  PickEntry,
  SeenAt,
} from "@/plugins/changelog/columns"
import { Detail } from "@/plugins/changelog/detail"
import {
  byVersion,
  entrySlug,
  findEntry,
  nextOpen,
  type OpenState,
  openVersions,
  versionName,
  type VersionGroup,
} from "@/plugins/changelog/groups"
import {
  CHANGELOG_QUERY_KEY,
  newestArrival,
  seenMark,
  useMarkSeen,
} from "@/plugins/changelog/unread"

// The page shows its title alone: the list says what it is.
const { title: TITLE } = appById("changelog")

const managedColumns = applyColumnManager(changelogColumns, changelogColumnConfig)

const NO_SORTING: never[] = []

async function fetchChangelog() {
  const { data, error } = await unwrap(apiClient.v1.apps.changelog.$get())
  if (error) throw new Error(error.message)
  return data
}

const changes = (n: number) => (n === 1 ? "1 change" : `${n} changes`)

function Version({
  group,
  picked,
  shown,
}: {
  group: VersionGroup
  picked: string | null
  shown: ChangelogEntry[]
}) {
  const rowSelection = React.useMemo(() => (picked ? { [picked]: true as const } : {}), [picked])
  const table = useTable({
    columns: managedColumns,
    data: shown,
    state: { columnVisibility: CHANGELOG_VISIBILITY, rowSelection },
    defaultColumn: { minSize: 0 },
    features,
    getRowId: (row) => row.id,
  })
  const name = group.release ? versionName(group.release) : "Not shipped yet"
  const Icon = group.release ? RiPriceTag3Line : RiGitMergeLine
  // one accordion row a version: its icon, name, when and count, its header an h2 under the page's h1
  return (
    <AccordionItem value={group.id} className={SHELF_ITEM}>
      <AccordionTrigger
        className={SHELF_ROW}
        header={(props) => <h2 {...props} className={cn(props.className, STICKY_HEADER)} />}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span className="text-foreground truncate">{name}</span>
          <span className="text-muted-foreground truncate">
            {group.release
              ? new Date(group.release.at).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                })
              : "merged, not on main yet"}
          </span>
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {shown.length === group.entries.length
              ? changes(shown.length)
              : `${shown.length} of ${changes(group.entries.length)}`}
          </span>
        </span>
        <ShelfMark />
      </AccordionTrigger>
      <AccordionContent>
        <div className="pt-2 pb-3">
          <DataTable aria-label={name} size="sm" table={table} />
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

function Changelog({ entries, seenAt }: { entries: ChangelogEntry[]; seenAt: string | null }) {
  // the aside is too narrow for the page's halves, so it lists the changes and opens one in the drawer, as a phone does
  const inAside = useInAside()
  const mobile = useIsMobile() || inAside
  const [pickedId, setPickedId] = useQueryState(useUrlKey("entry"), parseAsString)
  const {
    columnFilters,
    globalFilter,
    initialColumnFilters,
    onColumnFiltersChange,
    onGlobalFilterChange,
  } = useDataTableState(["kind"], NO_SORTING)
  const changesOnly = React.useMemo(
    () => entries.filter((entry) => entry.kind !== "release"),
    [entries],
  )
  const table = useTable({
    columns: managedColumns,
    data: changesOnly,
    state: { columnFilters, columnVisibility: CHANGELOG_VISIBILITY, globalFilter },
    initialState: { columnFilters: initialColumnFilters },
    defaultColumn: { minSize: 0 },
    features,
    getRowId: (row) => row.id,
    onColumnFiltersChange,
    onGlobalFilterChange,
  })
  const shownIds = new Set(table.getRowModel().rows.map((row) => row.id))
  const groups = byVersion(entries)
  // Each kind's count beside it in the facet, as the console's facets show theirs; a kind with none is not offered.
  const kindCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of changesOnly) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1)
    return counts
  }, [changesOnly])
  const kindOptions = KIND_OPTIONS.filter((option) => kindCounts.get(option.value))
  const clearFilters = () => {
    table.resetColumnFilters(true)
    table.setGlobalFilter(undefined)
  }
  // The latest change is open until another is picked; a link's ?entry= (pr-253, v0.0.9, or an old link's id) opens that one, a version included.
  const latest = groups.flatMap((group) => group.entries).find((entry) => shownIds.has(entry.id))
  const linked = findEntry(entries, pickedId)
  const picked = linked ?? latest ?? null
  // The drawer keeps the change it opened on while it slides shut, rather than the newest one the aside falls back to.
  const [drawn, setDrawn] = React.useState(linked)
  if (linked && linked !== drawn) setDrawn(linked)
  const pick = (entry: ChangelogEntry) => void setPickedId(entrySlug(entry))
  // Opening the page reads every change it shows, except on verify's own visit; the dots stay until the next visit, since seenAt is the mark from before this one.
  const { mutate: markSeen } = useMarkSeen()
  const newest = newestArrival(entries)
  React.useEffect(() => {
    const mark = seenMark(newest, seenAt)
    if (mark) markSeen(mark)
  }, [markSeen, newest, seenAt])
  // A version the search or a filter leaves empty goes whole, header and all; when none is left, one empty state says so.
  const shownGroups = groups
    .map((group) => ({ group, shown: group.entries.filter((entry) => shownIds.has(entry.id)) }))
    .filter(({ shown }) => shown.length)
  const filterKey = JSON.stringify([globalFilter ?? "", columnFilters])
  const filtering = Boolean(globalFilter) || columnFilters.length > 0
  const shownVersions = shownGroups.map(({ group }) => group)
  const linkedId = linked?.id ?? null
  const [openState, setOpenState] = React.useState<OpenState>({
    ids: null,
    key: filterKey,
    link: linkedId,
  })
  const state = nextOpen(openState, {
    filtering,
    key: filterKey,
    linked: linkedId,
    shown: shownVersions,
  })
  if (state !== openState) setOpenState(state)
  const open = openVersions({
    filtering,
    linked: state.link,
    opened: state.ids,
    shown: shownVersions,
  })
  const list = !groups.length ? (
    <SetupEmpty setup={SETUP.changelog} />
  ) : shownGroups.length ? (
    <Accordion
      multiple
      onValueChange={(ids) => setOpenState({ ...state, ids: ids as string[] })}
      value={open}
    >
      {shownGroups.map(({ group, shown }) => (
        <Version key={group.id} group={group} picked={picked?.id ?? null} shown={shown} />
      ))}
    </Accordion>
  ) : (
    // at the top of the list, as the console tables' No results sits under their header, not mid-column
    <Empty className="flex-none">
      <EmptyHeader>
        <EmptyTitle>No changes match</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      </EmptyContent>
    </Empty>
  )
  return (
    <SeenAt.Provider value={seenAt}>
      <PickEntry.Provider value={pick}>
        <DataTableToolbar table={table} searchPlaceholder="Search changes..." size="sm">
          <DataTableFacetedFilter
            column={table.getColumn("kind")}
            counts={kindCounts}
            options={kindOptions}
            size="sm"
            title="Kind"
          />
        </DataTableToolbar>
        {mobile ? (
          <div className="mt-4 flex flex-col gap-6">
            {list}
            <Drawer
              open={linked !== undefined}
              onOpenChange={(open) => {
                if (!open) void setPickedId(null)
              }}
            >
              <DrawerContent className="max-h-[85svh]">
                <DrawerTitle className="sr-only">Change</DrawerTitle>
                <div className="overflow-y-auto p-4">{drawn && <Detail entry={drawn} />}</div>
              </DrawerContent>
            </Drawer>
          </div>
        ) : (
          <ResizablePanelGroup orientation="horizontal" className="mt-4 min-h-0 flex-1">
            <ResizablePanel defaultSize="50%" minSize="30%">
              <div className="flex h-full flex-col gap-6 overflow-y-auto pr-4">{list}</div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="50%" minSize="30%">
              <aside className="h-full overflow-y-auto pl-6" aria-label="The change picked">
                {picked ? (
                  <Detail entry={picked} />
                ) : (
                  <p className="text-muted-foreground text-sm">Pick a change to read it in full.</p>
                )}
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </PickEntry.Provider>
    </SeenAt.Provider>
  )
}

export function ChangelogView() {
  const { allowed } = useDashboard()
  const { data, error, isPending } = useQuery({
    enabled: allowed,
    queryFn: fetchChangelog,
    queryKey: CHANGELOG_QUERY_KEY,
  })
  if (!allowed) return <OwnerOnly />
  return (
    <>
      <PageHeader title={TITLE} />
      {isPending ? (
        <Spinner />
      ) : error ? (
        <p className="text-destructive text-sm">{error.message}</p>
      ) : (
        <Changelog entries={data.entries} seenAt={data.seenAt} />
      )}
    </>
  )
}
