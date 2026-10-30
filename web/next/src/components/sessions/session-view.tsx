"use client"

import {
  RiBrainLine,
  RiChat3Line,
  RiHistoryLine,
  RiTerminalLine,
  RiToolsLine,
} from "@remixicon/react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import Link from "next/link"
import * as React from "react"

import { Checkpoint } from "@/components/checkpoint"
import { AgentLink } from "@/components/dashboard/agent-link"
import { useDashboard } from "@/components/dashboard/dashboard"
import { OwnerOnly } from "@/components/dashboard/owner-only"
import { Hint } from "@/components/hint"
import { PageHeader } from "@/components/shell/page-header"
import { TranscriptMessage } from "@/components/transcript-message"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { withoutRef, withoutSenderName } from "@/lib/agent-label"
import { useAgentsBoard } from "@/lib/agents"
import { oneLine, toolLabel } from "@/lib/dashboard"
import {
  chainLinkName,
  fetchEntries,
  fetchSession,
  firstLine,
  formatCost,
  formatCount,
  kindLabel,
  type LogEntry,
  RELATION_LABELS,
  sessionLabel,
  type SessionDetail,
  sessionsNamed,
  startLabel,
  statusLabel,
} from "@/lib/sessions"
import { fullTime, relativeTime } from "@/lib/time"

const QUIET_KINDS = new Set(["attachment", "meta", "result", "system"])

function Step({
  entry,
  label,
  name,
  now,
}: {
  entry: LogEntry
  label: string
  name: string | null
  now: Date
}) {
  const sockets = useAgentsBoard().data?.sockets
  if (entry.kind === "tool") {
    return (
      <Marker className="text-xs">
        <MarkerIcon>
          <RiToolsLine />
        </MarkerIcon>
        <MarkerContent>
          <span className="text-foreground font-medium">{toolLabel(entry.tool)}</span>{" "}
          {firstLine(entry.text)}
        </MarkerContent>
      </Marker>
    )
  }
  if (entry.kind === "thinking") {
    return (
      <Marker className="text-xs">
        <MarkerIcon>
          <RiBrainLine />
        </MarkerIcon>
        <MarkerContent className="whitespace-pre-wrap">{entry.text}</MarkerContent>
      </Marker>
    )
  }
  if (QUIET_KINDS.has(entry.kind)) {
    return (
      <Marker className="text-xs">
        <MarkerIcon>
          <RiTerminalLine />
        </MarkerIcon>
        <MarkerContent className="line-clamp-3 whitespace-pre-wrap">
          <span className="text-foreground font-medium">{entry.kind}</span>{" "}
          {entry.text || entry.type}
        </MarkerContent>
      </Marker>
    )
  }
  const mine = entry.kind === "human" || entry.kind === "prompt"
  const sender =
    entry.kind === "peer" && entry.sender
      ? (sockets?.[entry.sender] ?? withoutRef(entry.sender))
      : null
  const text = entry.clipped ? `${entry.text}…` : entry.text
  const who =
    entry.kind === "human" ? (
      "You"
    ) : entry.kind === "prompt" ? (
      "Prompt"
    ) : entry.kind === "peer" ? (
      entry.sender ? (
        <AgentLink name={entry.sender} />
      ) : (
        "session"
      )
    ) : name ? (
      <AgentLink name={name} />
    ) : (
      label
    )
  return (
    <TranscriptMessage
      at={entry.at}
      now={now}
      text={sender ? withoutSenderName(text, sender) : text}
      variant={mine ? "default" : entry.kind === "peer" ? "tinted" : "muted"}
      who={who}
    />
  )
}

const tokens = (session: SessionDetail) =>
  `${formatCount(session.inputTokens + session.cacheCreationTokens + session.cacheReadTokens)} in · ${formatCount(session.outputTokens)} out`

function Facts({ session }: { session: SessionDetail }) {
  const now = new Date()
  const rows: [string, React.ReactNode][] = [
    ["Kind", kindLabel(session.kind)],
    ["Status", statusLabel(session)],
    ["Started", session.startedAt ? relativeTime(session.startedAt, now) : "-"],
    ["Began as", startLabel(session.start)],
    ["Last active", session.lastActiveAt ? relativeTime(session.lastActiveAt, now) : "-"],
    ["Model", session.model ?? "-"],
    [
      "Directory",
      <Hint key="cwd" content={session.cwd ?? undefined}>
        <span>{session.cwd ?? "-"}</span>
      </Hint>,
    ],
    ["Branch", session.gitBranch ?? "-"],
    ["Tokens", tokens(session)],
    ["Cost", formatCost(session.costUsd)],
  ]
  if (session.parent) {
    rows.push([
      "Started by",
      <Hint key="parent" content={session.parent.name ?? undefined}>
        <Link
          href={`/dashboard/sessions/${encodeURIComponent(session.parent.id)}`}
          className="hover:underline"
        >
          {sessionLabel(session.parent)}
        </Link>
      </Hint>,
    ])
  }
  if (session.prUrls.length > 0) {
    rows.push([
      "Pull requests",
      <span key="prs" className="flex flex-wrap gap-x-2">
        {session.prUrls.map((url) => (
          <a key={url} href={url} rel="noreferrer" target="_blank" className="hover:underline">
            #{url.split("/").at(-1)}
          </a>
        ))}
      </span>,
    ])
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([term, detail]) => (
        <React.Fragment key={term}>
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 truncate">{detail}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

function Children({ session }: { session: SessionDetail }) {
  if (session.children.length === 0) return null
  return (
    <section aria-labelledby="started-heading" className="min-w-0 space-y-2">
      <h2 id="started-heading" className="text-sm font-medium">
        Sessions it started ({session.childCount})
      </h2>
      <ul className="grid gap-1 text-sm">
        {session.children.map((child) => (
          <li key={child.id} className="flex min-w-0 gap-2">
            <Hint content={child.name ?? undefined}>
              <Link
                href={`/dashboard/sessions/${encodeURIComponent(child.id)}`}
                className="shrink-0 font-medium hover:underline"
              >
                {sessionLabel(child)}
              </Link>
            </Hint>
            <span className="text-muted-foreground truncate">
              {kindLabel(child.kind)}
              {child.task ? ` · ${child.task}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {session.childCount > session.children.length && (
        <p className="text-muted-foreground text-sm">
          The first {session.children.length} of {session.childCount} are listed.
        </p>
      )}
    </section>
  )
}

// The other sessions of this one's name, in the order they started, each saying where it sits beside this one and how it began; the nearest few on each side, with the rest a link away.
function Chain({ label, session }: { label: string; session: SessionDetail }) {
  const chain = session.chain
  if (!chain || !session.name || chain.total === 0) return null
  const now = new Date()
  return (
    <section aria-labelledby="chain-heading" className="min-w-0 space-y-2">
      <h2 id="chain-heading" className="text-sm font-medium">
        Other sessions named {label} ({chain.total})
      </h2>
      <ul className="grid gap-1 text-sm">
        {chain.sessions.map((other) => (
          <li key={other.id} className="flex min-w-0 gap-2">
            <Hint content={other.startedAt ? fullTime(other.startedAt) : null}>
              <Link
                aria-label={chainLinkName(other.relation, other.startedAt)}
                href={`/dashboard/sessions/${encodeURIComponent(other.id)}`}
                className="shrink-0 font-medium hover:underline"
              >
                {RELATION_LABELS[other.relation]}
              </Link>
            </Hint>
            <span className="text-muted-foreground truncate">
              {startLabel(other.start)} · {statusLabel(other)}
              {other.startedAt ? ` · started ${relativeTime(other.startedAt, now)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {chain.total > chain.sessions.length && (
        <p className="text-muted-foreground text-sm">
          The nearest {chain.sessions.length} of {chain.total} are listed.{" "}
          <Link href={sessionsNamed(session.name)} className="text-foreground hover:underline">
            See all
          </Link>
        </p>
      )}
    </section>
  )
}

// The edge of the loaded log, on the stream's own Checkpoint, so the two views of a session's history look alike: one button in every state, Load older while older entries remain, then the start, focusable even while disabled so keyboard focus is never dropped
export function OlderLog({
  loading,
  more,
  onLoad,
}: {
  loading: boolean
  more: boolean
  onLoad: () => void
}) {
  return (
    <Checkpoint icon={RiHistoryLine}>
      <Button
        variant="ghost"
        size="xs"
        disabled={loading || !more}
        focusableWhenDisabled
        className="data-disabled:opacity-50"
        onClick={onLoad}
      >
        {loading ? <Spinner /> : null}
        {more ? "Load older" : "The start of the session"}
      </Button>
    </Checkpoint>
  )
}

// The log, newest page last: each page is one request for the lines before the oldest one shown, so reading back through a long session costs only what is read.
function Log({ label, session }: { label: string; session: SessionDetail }) {
  const [everything, setEverything] = React.useState(false)
  const now = new Date()
  // queryFn leads so the page type is inferred before getNextPageParam reads it.
  const log = useInfiniteQuery({
    queryFn: ({ pageParam }: { pageParam: number | null }) =>
      fetchEntries(session.id, pageParam, everything),
    queryKey: ["session-entries", session.id, everything],
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.before,
  })

  const entries = React.useMemo(
    () => (log.data ? [...log.data.pages].reverse().flatMap((page) => page.entries) : []),
    [log.data],
  )
  return (
    <section aria-labelledby="log-heading" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 id="log-heading" className="text-sm font-medium">
          Log
        </h2>
        <div className="flex items-center gap-2">
          <Switch id="every-line" checked={everything} onCheckedChange={setEverything} />
          <Label htmlFor="every-line">Every line</Label>
        </div>
      </div>
      {entries.length > 0 && (
        <OlderLog
          loading={log.isFetchingNextPage}
          more={log.hasNextPage}
          onLoad={() => void log.fetchNextPage()}
        />
      )}
      {log.isPending ? (
        <Spinner />
      ) : log.isError ? (
        <Alert variant="destructive">
          <AlertTitle>The log did not load</AlertTitle>
          <AlertDescription>{log.error.message}</AlertDescription>
        </Alert>
      ) : entries.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RiChat3Line />
            </EmptyMedia>
            <EmptyTitle>No lines</EmptyTitle>
            <EmptyDescription>
              {everything
                ? "Nothing has been read from this session yet."
                : "Nothing was asked or said here; Every line shows the rest."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol aria-label={`${label}'s log`} className="grid gap-4">
          {entries.map((entry) => (
            <li key={`${entry.seq}:${entry.uuid}`} className="min-w-0">
              <Step entry={entry} label={label} name={session.name} now={now} />
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Session({ id }: { id: string }) {
  const session = useQuery({ queryFn: () => fetchSession(id), queryKey: ["session", id] })
  if (session.isPending) return <Spinner />
  if (session.isError) {
    return (
      <>
        <PageHeader title="Session" />
        <Alert variant="destructive">
          <AlertTitle>This session did not load</AlertTitle>
          <AlertDescription>{session.error.message}</AlertDescription>
        </Alert>
      </>
    )
  }
  const label = sessionLabel(session.data)
  return (
    <>
      <PageHeader
        title={
          <Hint content={session.data.name ?? undefined}>
            <span>{label}</span>
          </Hint>
        }
        description={session.data.task ? oneLine(session.data.task) : undefined}
      />
      <div className="grid min-w-0 gap-6">
        <Facts session={session.data} />
        <Chain label={label} session={session.data} />
        <Children session={session.data} />
        <Log label={label} session={session.data} />
      </div>
    </>
  )
}

// One session from the dashboard's database: what it was, where and on what it ran, what it cost, the sessions it started, and its whole log.
export function SessionView({ id }: { id: string }) {
  const { allowed } = useDashboard()
  if (!allowed) {
    return (
      <>
        <PageHeader title="Session" />
        <OwnerOnly title="Sessions are for the owner" why="They hold every session's log" />
      </>
    )
  }
  return <Session id={id} />
}
