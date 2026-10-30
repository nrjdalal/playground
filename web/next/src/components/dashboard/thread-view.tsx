"use client"

import type { Entry } from "@api/hono"
import { RiArrowLeftSLine, RiArrowRightSLine, RiChatThreadLine } from "@remixicon/react"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useState } from "react"

import { AgentLink } from "@/components/dashboard/agent-link"
import { AttachmentChips, chipsFromEntry } from "@/components/dashboard/attachments"
import { Composer } from "@/components/dashboard/composer"
import { useDashboard } from "@/components/dashboard/dashboard"
import { OwnerOnly } from "@/components/dashboard/owner-only"
import { PageHeader } from "@/components/shell/page-header"
import { TranscriptMessage } from "@/components/transcript-message"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { withoutRef, withoutSenderName } from "@/lib/agent-label"
import type { OutboxMessage } from "@/lib/outbox"
import {
  patchThread,
  pendingIn,
  THREADS_QUERY_KEY,
  threadSections,
  useThreadMessages,
} from "@/lib/threads"

const back = (
  <Button variant="outline" size="sm" render={<Link href="/dashboard" />}>
    <RiArrowLeftSLine data-icon="inline-start" />
    Back to chat
  </Button>
)

// the session's own replies are the dispatcher's, the session a thread's messages are routed from
function Message({
  dispatcher,
  entry,
  now,
}: {
  dispatcher: string | null
  entry: Entry
  now: Date
}) {
  const sender = entry.kind === "peer" && entry.from ? withoutRef(entry.from) : null
  const name = entry.kind === "peer" ? entry.from : dispatcher
  const who = entry.kind === "human" ? "You" : name ? <AgentLink name={name} /> : "session"
  return (
    <TranscriptMessage
      at={entry.at}
      now={now}
      text={sender ? withoutSenderName(entry.text, sender) : entry.text}
      variant={entry.kind === "human" ? "default" : entry.kind === "peer" ? "tinted" : "muted"}
      who={who}
    >
      {entry.attachments?.length ? (
        <AttachmentChips className="max-w-full" items={chipsFromEntry(entry.attachments)} />
      ) : null}
    </TranscriptMessage>
  )
}

function Pending({ message, now }: { message: OutboxMessage; now: Date }) {
  return (
    <TranscriptMessage at={message.at} now={now} text={message.text} variant="default" who="You">
      <p className="text-muted-foreground text-xs">
        {message.state === "failed"
          ? "Not sent: retry or edit it from the full chat"
          : "On its way to this thread"}
      </p>
    </TranscriptMessage>
  )
}

type Messages = { dispatcher: string | null; entries: Entry[]; label: string; now: Date }

function MessageList({ dispatcher, entries, label, now }: Messages) {
  return (
    <ol aria-label={label} className="grid gap-4">
      {entries.map((entry) => (
        <li key={entry.id} className="min-w-0">
          <Message dispatcher={dispatcher} entry={entry} now={now} />
        </li>
      ))}
    </ol>
  )
}

function Section(props: Messages) {
  return (
    <section aria-label={props.label} className="grid gap-4">
      <h2 className="text-muted-foreground text-xs font-medium">{props.label}</h2>
      <MessageList {...props} />
    </section>
  )
}

function Thread({ id }: { id: string }) {
  const { dispatcher, outbox, workers } = useDashboard()
  const read = useThreadMessages(id)
  const queryClient = useQueryClient()
  // when the view opened and when it was last read then, so what was unread stays under Unread while it is open and what lands after shows at the foot
  const [opened, setOpened] = useState<{ at: number; since: string | null } | undefined>(undefined)
  if (read.data && opened === undefined)
    setOpened({ at: Date.now(), since: read.data.thread.lastReadAt })
  const unread = read.data?.thread.unread ?? 0
  useEffect(() => {
    if (unread === 0) return
    void patchThread(id, { read: true })
      .catch(() => undefined)
      .then(() => queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY }))
  }, [id, queryClient, unread])

  if (read.isPending) {
    return (
      <>
        <PageHeader title="Thread" actions={back} />
        <Spinner />
      </>
    )
  }
  if (read.isError) {
    return (
      <>
        <PageHeader title="Thread" actions={back} />
        <Alert variant="destructive">
          <AlertTitle>This thread did not load</AlertTitle>
          <AlertDescription>{read.error.message}</AlertDescription>
        </Alert>
      </>
    )
  }
  const now = new Date(read.dataUpdatedAt)
  const { entries, thread } = read.data
  const sections = threadSections(entries, opened?.since ?? null, opened?.at)
  const pending = pendingIn(entries, outbox.messages, id, Date.now())
  const host = workers?.find((worker) => worker.name === dispatcher) ?? null
  const count = entries.length === 1 ? "1 message" : `${entries.length} messages`
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <PageHeader title={thread.title} description={`Thread · ${count}`} actions={back} />
      <div className="grid min-w-0 flex-1 content-start gap-6">
        {sections.asked && (
          <Section dispatcher={dispatcher} entries={[sections.asked]} label="You asked" now={now} />
        )}
        {entries.length === 0 && pending.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RiChatThreadLine />
              </EmptyMedia>
              <EmptyTitle>No messages yet</EmptyTitle>
              <EmptyDescription>A message routed to this thread shows here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {sections.unread.length > 0 && (
          <Section
            dispatcher={dispatcher}
            entries={sections.unread}
            label={`Unread (${sections.unread.length})`}
            now={now}
          />
        )}
        {sections.history.length > 0 && (
          <Collapsible className="grid gap-4">
            <CollapsibleTrigger
              render={<Button variant="ghost" size="sm" className="group/history w-fit" />}
            >
              <RiArrowRightSLine
                data-icon="inline-start"
                className="transition-transform group-data-[panel-open]/history:rotate-90"
              />
              Full history · {sections.history.length}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <MessageList
                dispatcher={dispatcher}
                entries={sections.history}
                label="Full history"
                now={now}
              />
            </CollapsibleContent>
          </Collapsible>
        )}
        {sections.latest.length > 0 && (
          <MessageList
            dispatcher={dispatcher}
            entries={sections.latest}
            label="Since you opened it"
            now={now}
          />
        )}
        {pending.length > 0 && (
          <ol aria-label="On its way" className="grid gap-4">
            {pending.map((message) => (
              <li key={message.id} className="min-w-0">
                <Pending message={message} now={now} />
              </li>
            ))}
          </ol>
        )}
      </div>
      {/* the reply box stays at the foot of the view while a long thread scrolls behind it */}
      <div className="bg-background sticky bottom-0 pt-2">
        {host ? (
          <Composer key={`${host.name}#${id}`} threadId={id} worker={host} />
        ) : (
          <p className="text-muted-foreground mb-2 text-xs">
            The reply box shows here while the dispatcher runs.
          </p>
        )}
      </div>
    </div>
  )
}

// One thread on its own: what was asked first, the messages unread when it opened, then the rest folded under Full history, then what lands while it is open, with a reply box that files what is sent under the thread, and a way back to the full chat.
export function ThreadView({ id }: { id: string }) {
  const { allowed } = useDashboard()
  if (!allowed) {
    return (
      <>
        <PageHeader title="Thread" actions={back} />
        <OwnerOnly title="Threads are for the owner" why="They hold your messages to agents" />
      </>
    )
  }
  return <Thread id={id} />
}
