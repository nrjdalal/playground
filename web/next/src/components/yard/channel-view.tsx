"use client"

import { MAX_TEXT, MESSAGE_KINDS, RETENTION_DAYS } from "@packages/message"
import { RiArrowUpLine } from "@remixicon/react"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useState } from "react"

import { sendsOnEnter } from "@/components/dashboard/composer"
import { Hint } from "@/components/hint"
import { TranscriptMessage } from "@/components/transcript-message"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { toast } from "@/components/ui/toast"
import { config } from "@/lib/config"
import {
  approveHref,
  canPost,
  channelTitle,
  messagesKey,
  upsertMessage,
  type YardChannel,
  type YardMessage,
} from "@/lib/yard"
import { CHANNELS_KEY, useYardChannels, useYardMessages, yardApi } from "@/lib/yard-api"

type Kind = (typeof MESSAGE_KINDS)[number]

// A channel or DM in the chat pane: every message is untrusted data, shown through the transcript renderer (links shown, opened only on a click, images from elsewhere left unloaded) behind its from line and kind tag.
export function ChannelView({ id, role }: { id: string; role: string | null | undefined }) {
  const channel = useYardChannels().data?.find((row) => row.id === id)
  const { data: messages } = useYardMessages(id)
  const client = useQueryClient()
  const count = messages?.length
  // Marks the channel read once its messages show, and again as more arrive; a failed mark leaves the badge, read again next time.
  useEffect(() => {
    if (count === undefined) return
    yardApi
      .read(id)
      .then(() => client.invalidateQueries({ queryKey: CHANNELS_KEY }))
      .catch(() => {})
  }, [client, id, count])
  if (!channel) return null
  const now = new Date()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b px-4 py-3">
        <h1 className="text-sm font-medium">{channelTitle(channel)}</h1>
        {channel.topic && <p className="text-muted-foreground text-xs">{channel.topic}</p>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {messages?.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No messages yet</EmptyTitle>
              <EmptyDescription>Messages stay for {RETENTION_DAYS} days.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {messages?.map((message) => (
          <TranscriptMessage
            key={message.id}
            at={message.at}
            now={now}
            plain
            text={message.text}
            variant="muted"
            who={<FromLine message={message} />}
          >
            <Status message={message} />
          </TranscriptMessage>
        ))}
      </div>
      <div className="px-4 pb-4">
        {canPost(channel, role) ? (
          <YardComposer channel={channel} />
        ) : (
          <p className="text-muted-foreground text-xs">
            Only the owner posts in {channelTitle(channel)}.
          </p>
        )}
      </div>
    </div>
  )
}

// Who sent it, from which device, and what kind of message it is.
export function FromLine({ message }: { message: YardMessage }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {message.from.login}
      <span className="text-muted-foreground font-normal">{message.from.device}</span>
      {message.kind !== "text" && (
        <span className="text-muted-foreground font-normal">{message.kind}</span>
      )}
    </span>
  )
}

// A tier-two post waits, seen by its sender alone, until that sender's signed-in web session approves it; a denied one stays with them, marked.
function Status({ message }: { message: YardMessage }) {
  if (message.status === "pending") {
    const href = approveHref(message, config.hosted)
    return (
      <p className="text-muted-foreground mt-1 text-xs">
        {href ? (
          <>
            Waiting for your approval ·{" "}
            <Link className="underline" href={href}>
              Review
            </Link>
          </>
        ) : (
          "Waiting for your approval on Yard's web"
        )}
      </p>
    )
  }
  if (message.status === "denied")
    return <p className="text-muted-foreground mt-1 text-xs">Denied: only you can see it</p>
  return null
}

// Playground's composer box, at its sizes, with the message's kind in place of the session's mode.
function YardComposer({ channel }: { channel: YardChannel }) {
  const [text, setText] = useState("")
  const [kind, setKind] = useState<Kind>("text")
  const client = useQueryClient()
  const label = channelTitle(channel)
  const send = async () => {
    const words = text.trim()
    if (!words) return
    try {
      const { message } = await yardApi.post(channel.id, { kind, text: words })
      client.setQueryData<YardMessage[]>(messagesKey(channel.id), (list) =>
        upsertMessage(list ?? [], message),
      )
      setText("")
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <InputGroup className="border-border">
        <InputGroupTextarea
          aria-label={`Message ${label}`}
          className="field-sizing-content max-h-[40vh] min-h-0 overflow-y-auto px-3 pt-2 pb-1"
          maxLength={MAX_TEXT}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            const { ctrlKey, key, metaKey, nativeEvent, shiftKey } = event
            const { isComposing, keyCode } = nativeEvent
            if (!sendsOnEnter({ ctrlKey, isComposing, key, keyCode, metaKey, shiftKey })) return
            event.preventDefault()
            void send()
          }}
          placeholder={`Message ${label}`}
          rows={1}
          value={text}
        />
        <InputGroupAddon
          align="block-end"
          className="px-2 pt-1 pb-2 [&_button[data-size=icon-sm]]:size-7 [&_svg]:size-3.5!"
        >
          <NativeSelect
            aria-label="Kind"
            size="sm"
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
          >
            {MESSAGE_KINDS.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {option}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            {text.length > MAX_TEXT * 0.9 ? `${text.length} / ${MAX_TEXT}` : null}
          </span>
          <Hint content="Enter to send, Shift+Enter for a new line" description={null}>
            <InputGroupButton
              aria-label={`Send to ${label}`}
              className="rounded-full"
              size="icon-sm"
              type="submit"
              variant="default"
            >
              <RiArrowUpLine />
            </InputGroupButton>
          </Hint>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
