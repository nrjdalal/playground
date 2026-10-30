"use client"

import type { Preview } from "@api/hono"
import { RiExternalLinkLine, RiImageLine, RiRefreshLine } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { parseAsArrayOf, parseAsString, useQueryState } from "nuqs"
import * as React from "react"

import { useDashboard } from "@/components/dashboard/dashboard"
import { OwnerOnly } from "@/components/dashboard/owner-only"
import { FacetedFilter } from "@/components/data-table"
import { Hint } from "@/components/hint"
import { PageHeader } from "@/components/shell/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { appById } from "@/lib/apps"
import { useUrlKey } from "@/lib/aside-url"
import { config } from "@/lib/config"
import { useNow } from "@/lib/dashboard"
import {
  fetchPreviews,
  PREVIEWS_QUERY_KEY,
  previewUrl,
  topicCounts,
  topicGroups,
} from "@/lib/previews"
import { fullTime, relativeTime } from "@/lib/time"

const { description: DESCRIPTION, title: TITLE } = appById("previews")

const topicParser = parseAsArrayOf(parseAsString).withDefault([])

// A preview drawn as itself: an image, or an HTML page live in a frame whose sandbox allows nothing, so it runs no script, has no origin of its own and cannot reach the dashboard; its CSS motion still plays. The API's CSP sandboxes the page too, lifting only its own inline script for a tab of its own, which this frame's empty sandbox still blocks.
function PreviewMedia({ preview, src }: { preview: Preview; src: string }) {
  const frame = "bg-muted aspect-video w-full border-b"
  if (preview.kind === "html") {
    return (
      <iframe
        className={frame}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox=""
        src={src}
        title={preview.caption ?? preview.name}
      />
    )
  }
  return (
    <img
      alt={preview.caption ?? preview.name}
      className={`${frame} object-contain`}
      loading="lazy"
      src={src}
    />
  )
}

function PreviewCard({ now, preview }: { now: Date; preview: Preview }) {
  const src = previewUrl(config.api.url, preview.name)
  return (
    <Card size="sm" className="gap-2 pt-0">
      <PreviewMedia preview={preview} src={src} />
      <div className="flex min-w-0 items-start justify-between gap-2 px-3">
        <div className="min-w-0 space-y-0.5">
          <Hint content={preview.name}>
            <p className="truncate text-xs font-medium">{preview.name}</p>
          </Hint>
          {preview.caption && (
            <Hint content={preview.caption}>
              <p className="text-muted-foreground text-2xs line-clamp-2">{preview.caption}</p>
            </Hint>
          )}
          <Hint content={fullTime(preview.modifiedAt)}>
            <p className="text-muted-foreground text-2xs">
              {relativeTime(preview.modifiedAt, now)}
            </p>
          </Hint>
        </div>
        <Button
          aria-label={`Open ${preview.name} in a new tab`}
          render={<a href={src} rel="noreferrer" target="_blank" />}
          size="icon-sm"
          variant="ghost"
        >
          <RiExternalLinkLine />
        </Button>
      </div>
    </Card>
  )
}

function TopicSection({ now, previews, topic }: { now: Date; previews: Preview[]; topic: string }) {
  const id = `previews-topic-${topic}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-muted-foreground text-sm font-medium">
        {topic} · {previews.length}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {previews.map((preview) => (
          <PreviewCard key={preview.name} now={now} preview={preview} />
        ))}
      </div>
    </section>
  )
}

// The subtitle: how many previews and when the newest arrived, or the app's description while there are none.
const subtitle = (previews: Preview[] | undefined, now: Date): string => {
  const newest = previews?.[0]
  if (!previews || !newest) return DESCRIPTION
  const topics = topicCounts(previews).size
  return `${previews.length} ${previews.length === 1 ? "preview" : "previews"} in ${topics} ${topics === 1 ? "topic" : "topics"} · newest ${relativeTime(newest.modifiedAt, now)}`
}

// The Previews app: every image and HTML page agents left in the previews folder for you, grouped by topic, newest first. Read-only: agents write the folder, the page only shows it.
export function PreviewsView() {
  const now = new Date(useNow())
  const { allowed } = useDashboard()
  const [picked, setPicked] = useQueryState(useUrlKey("topic"), topicParser)
  const { data, error, isPending, refetch } = useQuery({
    enabled: allowed,
    queryKey: PREVIEWS_QUERY_KEY,
    queryFn: fetchPreviews,
    refetchInterval: 30_000,
  })
  // Only a refresh asked for spins the button; the half-minute re-read stays quiet.
  const [refreshing, setRefreshing] = React.useState(false)
  const refresh = async () => {
    setRefreshing(true)
    try {
      await refetch()
    } finally {
      setRefreshing(false)
    }
  }
  const header = <PageHeader title={TITLE} description={subtitle(data?.previews, now)} />
  if (!allowed) {
    return (
      <>
        {header}
        <OwnerOnly />
      </>
    )
  }
  const counts = data ? topicCounts(data.previews) : new Map<string, number>()
  const groups = data ? topicGroups(data.previews, picked) : []
  return (
    <>
      {header}
      <div className="flex flex-col gap-6">
        {isPending ? (
          <Spinner />
        ) : error ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>The previews could not be read</EmptyTitle>
              <EmptyDescription>{error.message}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={() => void refetch()}>
                Retry
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <FacetedFilter
                counts={counts}
                onClear={() => void setPicked(null)}
                onToggle={(topic) =>
                  void setPicked(
                    picked.includes(topic) ? picked.filter((t) => t !== topic) : [...picked, topic],
                  )
                }
                options={[...counts.keys()].map((topic) => ({ label: topic, value: topic }))}
                selected={picked}
                size="sm"
                title="Topic"
              />
              <Button
                variant="outline"
                className="text-xs"
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                {refreshing ? <Spinner /> : <RiRefreshLine />}
                Refresh
              </Button>
            </div>
            {data.problems.length > 0 && (
              <Alert>
                <AlertTitle>Some files are not shown</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {data.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {groups.length > 0 ? (
              groups.map((group) => (
                <TopicSection
                  key={group.topic}
                  now={now}
                  previews={group.previews}
                  topic={group.topic}
                />
              ))
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <RiImageLine />
                  </EmptyMedia>
                  <EmptyTitle>
                    {picked.length ? "No previews in that topic" : "No previews yet"}
                  </EmptyTitle>
                  <EmptyDescription>
                    Agents put PNG, GIF, WebP and HTML previews in the previews folder, each with a
                    caption in a .txt of the same name.
                  </EmptyDescription>
                </EmptyHeader>
                {picked.length > 0 && (
                  <EmptyContent>
                    <Button variant="outline" onClick={() => void setPicked(null)}>
                      Show every topic
                    </Button>
                  </EmptyContent>
                )}
              </Empty>
            )}
          </>
        )}
      </div>
    </>
  )
}
