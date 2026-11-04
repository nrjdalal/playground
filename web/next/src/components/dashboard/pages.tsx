"use client"

import type { Preview } from "@api/hono"
import { RiArrowDownSLine, RiDeleteBinLine, RiDownloadLine, RiPagesLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
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
import { toast } from "@/components/ui/toast"
import { agentLabel } from "@/lib/agent-label"
import { config } from "@/lib/config"
import { useNow } from "@/lib/dashboard"
import {
  deletePage,
  fetchPages,
  PREVIEWS_QUERY_KEY,
  previewDownloadUrl,
  previewUrl,
} from "@/lib/previews"
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

// A page's Download, saving its file under its title as the API names it: a link, or with a PDF beside the page a menu offering the page and the PDF.
function PageDownload({ apiUrl, page }: { apiUrl: string; page: Preview }) {
  const label = `Download ${pageTitle(page)}`
  if (!page.pdf)
    return (
      <Hint content="Download" description={null}>
        <Button
          aria-label={label}
          render={<a href={previewDownloadUrl(apiUrl, page.name)} />}
          size="icon-sm"
          variant="ghost"
        >
          <RiDownloadLine />
        </Button>
      </Hint>
    )
  return (
    <DropdownMenu>
      <Hint content="Download" description={null}>
        <DropdownMenuTrigger render={<Button aria-label={label} size="icon-sm" variant="ghost" />}>
          <RiDownloadLine />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Download</DropdownMenuLabel>
          <DropdownMenuItem render={<a href={previewDownloadUrl(apiUrl, page.name)} />}>
            Page (HTML)
          </DropdownMenuItem>
          <DropdownMenuItem render={<a href={previewDownloadUrl(apiUrl, page.pdf)} />}>
            PDF
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Pure: what the delete confirm says: the newest version's file and caption go, its PDF too when one stands beside it, and a row's older versions stay, so the row still showing reads as the next version, not a failed delete.
export const deleteDescription = (name: string, older: number, pdf = false): string => {
  const gone = `${name} and its caption${pdf ? " and PDF" : ""} leave the previews folder for good.`
  if (!older) return gone
  return older === 1
    ? `${gone} Its older version stays and takes its row.`
    : `${gone} Its ${older} older versions stay, and the newest of them takes its row.`
}

// The row a delete asks about: its newest version, and how many older versions stay.
type Deleting = { older: number; preview: Preview }

// Each page as a row that opens its newest version in a new tab through the Previews route: its title, who made it, for whom, and when it was kept; the older versions sit in the row's dropdown, its Download saves the newest version, and its delete button asks to delete it.
export function PageList({
  apiUrl,
  now,
  onDelete,
  pages,
}: {
  apiUrl: string
  now: number
  onDelete?: (deleting: Deleting) => void
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
            <ItemActions className="relative z-10">
              {older.length ? (
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
              ) : null}
              <PageDownload apiUrl={apiUrl} page={latest} />
              {onDelete && (
                <Hint content="Delete page">
                  <Button
                    aria-label={`Delete ${pageTitle(latest)}`}
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onDelete({ older: older.length, preview: latest })}
                  >
                    <RiDeleteBinLine />
                  </Button>
                </Hint>
              )}
            </ItemActions>
          </Item>
        )
      })}
    </ItemGroup>
  )
}

// An agent's Pages tab: the pages it made with playground page or that were made for it, newest first, every page on the dispatcher's view, so a page stays after its Inbox card is answered; a row's delete asks first, then deletes its newest version.
export function Pages({ all, session }: { all: boolean; session: string }) {
  const now = useNow()
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery({
    queryFn: () => fetchPages(session),
    queryKey: [...PREVIEWS_QUERY_KEY, "pages", session],
    refetchInterval: 30_000,
  })
  const [deleting, setDeleting] = React.useState<Deleting | null>(null)
  // the dialog keeps its title through its close animation
  const shown = React.useRef<Deleting | null>(null)
  if (deleting) shown.current = deleting
  const remove = useMutation({
    mutationFn: deletePage,
    onError: (error) => toast.add({ title: error.message, type: "error" }),
    onSuccess: () => {
      setDeleting(null)
      toast.add({ title: "Page deleted", type: "success" })
      queryClient.invalidateQueries({ queryKey: PREVIEWS_QUERY_KEY })
    },
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
        <PageList apiUrl={config.api.url} now={now} onDelete={setDeleting} pages={data.previews} />
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
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Delete ${shown.current ? pageTitle(shown.current.preview) : "page"}?`}
        description={deleteDescription(
          shown.current?.preview.name ?? "Its file",
          shown.current?.older ?? 0,
          Boolean(shown.current?.preview.pdf),
        )}
        action="Delete"
        variant="destructive"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.preview.name)
        }}
      />
    </section>
  )
}
