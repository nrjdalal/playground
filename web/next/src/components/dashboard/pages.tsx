"use client"

import type { Preview } from "@api/hono"
import { RiArrowDownSLine, RiPagesLine } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"

import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { CenterSpinner } from "@/components/ui/spinner"
import { agentLabel } from "@/lib/agent-label"
import { config } from "@/lib/config"
import { useNow } from "@/lib/dashboard"
import { fetchPages, PREVIEWS_QUERY_KEY, previewUrl } from "@/lib/previews"
import { fullTime, relativeTime } from "@/lib/time"

const keptAt = (preview: Preview) => preview.page?.at ?? preview.modifiedAt

// Pure: the name a page's versions share, its file name less the extension and a trailing one- or two-digit -<n> (fix-2668-5.html and fix-2668-8.html are both fix-2668).
export function versionKey(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/-\d{1,2}$/, "")
}

// Pure: the pages grouped by versionKey, each group newest first, the groups ordered by their newest version.
export function groupVersions(pages: Preview[]): [Preview, ...Preview[]][] {
  const groups = new Map<string, [Preview, ...Preview[]]>()
  for (const preview of pages) {
    const key = versionKey(preview.name)
    const group = groups.get(key)
    groups.set(key, group ? [...group, preview] : [preview])
  }
  const newestFirst = (a: Preview, b: Preview) => keptAt(b).localeCompare(keptAt(a))
  return [...groups.values()]
    .map((group) => [...group].sort(newestFirst) as [Preview, ...Preview[]])
    .sort((a, b) => newestFirst(a[0], b[0]))
}

function PageTime({ at, now }: { at: string; now: number }) {
  return (
    <Hint content={fullTime(at)}>
      <time dateTime={at}>{relativeTime(at, new Date(now))}</time>
    </Hint>
  )
}

const pageTitle = (preview: Preview) => preview.page?.title ?? preview.caption ?? preview.name

// Each page as a row that opens its newest version in a new tab through the Previews route: its title, who made it, for whom, and when it was kept; the older versions sit in the row's dropdown.
export function PageList({
  apiUrl,
  now,
  pages,
}: {
  apiUrl: string
  now: number
  pages: Preview[]
}) {
  return (
    <ItemGroup className="gap-2">
      {groupVersions(pages).map(([latest, ...older]) => {
        const page = latest.page
        return (
          <Item
            key={latest.name}
            className="hover:bg-muted has-[a:focus-visible]:border-ring has-[a:focus-visible]:ring-ring/50 relative has-[a:focus-visible]:ring-[3px]"
            size="sm"
            variant="outline"
          >
            <ItemMedia variant="icon">
              <RiPagesLine />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                <a
                  className="after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none"
                  href={previewUrl(apiUrl, latest.name)}
                  rel="noreferrer"
                  target="_blank"
                >
                  {pageTitle(latest)}
                </a>
              </ItemTitle>
              <ItemDescription>
                {page && `By ${agentLabel(page.by)}`}
                {page?.for && ` for ${agentLabel(page.for)}`}
                {page && " · "}
                <span className="relative z-10">
                  <PageTime at={keptAt(latest)} now={now} />
                </span>
              </ItemDescription>
            </ItemContent>
            {older.length ? (
              <ItemActions className="relative z-10">
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
                    {older.length + 1} versions
                    <RiArrowDownSLine />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto min-w-56">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Older versions</DropdownMenuLabel>
                      {older.map((preview) => (
                        <DropdownMenuItem
                          key={preview.name}
                          className="justify-between gap-4"
                          render={
                            <a
                              href={previewUrl(apiUrl, preview.name)}
                              rel="noreferrer"
                              target="_blank"
                            />
                          }
                        >
                          <span className="truncate">{preview.name}</span>
                          <span className="text-muted-foreground text-xs">
                            <PageTime at={keptAt(preview)} now={now} />
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            ) : null}
          </Item>
        )
      })}
    </ItemGroup>
  )
}

// An agent's Pages tab: the pages it made with playground page or that were made for it, newest first, every page on the dispatcher's view, so a page stays after its Inbox card is answered.
export function Pages({ all, session }: { all: boolean; session: string }) {
  const now = useNow()
  const { data, error, isPending } = useQuery({
    queryFn: () => fetchPages(session),
    queryKey: [...PREVIEWS_QUERY_KEY, "pages", session],
    refetchInterval: 30_000,
  })
  return (
    <section aria-labelledby="pages" className="flex flex-col gap-3">
      {/* on a phone the Pages tab below already says it */}
      <h2 id="pages" className="text-sm font-medium max-md:sr-only">
        Pages
      </h2>
      {isPending ? (
        <CenterSpinner />
      ) : error ? (
        <p className="text-destructive text-sm">{error.message}</p>
      ) : data.previews.length ? (
        <PageList apiUrl={config.api.url} now={now} pages={data.previews} />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RiPagesLine />
            </EmptyMedia>
            <EmptyTitle>No pages</EmptyTitle>
            <EmptyDescription>
              {all
                ? "Every page an agent keeps for you shows here."
                : "Pages this agent keeps, or that are kept for it, show here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  )
}
