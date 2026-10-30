"use client"

import { markerOf } from "@packages/config/threads"
import { RiChatThreadLine } from "@remixicon/react"
import { cn } from "cn"
import Link from "next/link"
import type { ReactNode } from "react"

import { Hint } from "@/components/hint"
import { TranscriptMarkdown, type TranscriptSurface } from "@/components/transcript-markdown"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"
import { threadHref } from "@/lib/threads"
import { fullTime, messageTime } from "@/lib/time"

export type TranscriptVariant = Exclude<TranscriptSurface, "none">

export const leadsWithImage = (text: string): boolean => /^(!\[|<img\b)/i.test(text.trimStart())

// A message's words at text-sm, its code too (Streamdown's own size). Only his are a bubble, on the right in the stock muted bubble's own grey; a session's own words and a peer's read as full-width text.
export function TranscriptBubble({
  className,
  text,
  variant,
}: {
  className?: string
  text: string
  variant: TranscriptVariant
}) {
  const mine = variant === "default"
  const marker = markerOf(text)
  return (
    <Bubble
      align={mine ? "end" : "start"}
      variant={mine ? "muted" : "ghost"}
      className={cn(!mine && "w-full", className)}
    >
      <BubbleContent className={cn("text-sm", !mine && "w-full")}>
        {/* a leading [thread:<id>] marker reads as a chip that opens its thread */}
        {marker.id ? (
          <Badge
            variant="outline"
            className="mb-1.5 font-mono"
            render={<Link href={threadHref({ id: marker.id })} />}
          >
            <RiChatThreadLine data-icon="inline-start" />
            {marker.id}
          </Badge>
        ) : null}
        <TranscriptMarkdown on={mine ? "muted" : "none"}>{marker.text}</TranscriptMarkdown>
      </BubbleContent>
    </Bubble>
  )
}

// One message from a session's transcript, or on its way to one, as a session's stream and the sessions log both show it, at the sidebar's sizes: an agent's or a peer's words start with its name, its label ("Playground", who) on the same line, full width with no header above, and his sit in a bubble with no name shown; the stored time shows on hover, then children (its files, a footer, or a session's turn: its thinking, more words and its tool calls, in order). at is the stored time, never the time it rendered.
export function TranscriptMessage({
  at,
  bubbleClassName,
  children,
  now,
  opensWithText,
  text,
  variant,
  who,
}: {
  at: string | null
  bubbleClassName?: string
  children?: ReactNode
  now: Date
  // Whether the message opens with words its name can lead (a session's turn passes it from its first part); else whether its own text does.
  opensWithText?: boolean
  text: string
  variant: TranscriptVariant
  who: ReactNode
}) {
  const mine = variant === "default"
  // The stored time, shown on hover (or while focus is inside) as 12px muted text, the whole moment in its title.
  const time = at ? (
    <Hint content={fullTime(at)}>
      <time
        dateTime={at}
        className="text-muted-foreground shrink-0 text-xs opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100"
      >
        {messageTime(at, now)}
      </time>
    </Hint>
  ) : null
  // a message of files alone has no words to show
  const words = text.trim() ? (
    <TranscriptBubble className={bubbleClassName} text={text} variant={variant} />
  ) : null
  // A turn that opens with a tool row, a thinking row or an image puts the name on its own line, since floating it beside those would sit it inside them.
  const inline = (opensWithText ?? Boolean(words)) && !leadsWithImage(text)
  if (mine) {
    return (
      <Message align="end" className="text-xs">
        {/* gap-0.5: his status footer sits snug under what is above it; mt-1 on the file group keeps its card 10px under the bubble as it was */}
        <MessageContent className="gap-0.5 [&>[data-slot=attachment-group]]:mt-1">
          <span className="sr-only">{who}</span>
          {/* his time sits beside his bubble, so showing it on hover adds no line */}
          {time || words ? (
            <div className="flex w-full min-w-0 items-end justify-end gap-2">
              {time}
              {words}
            </div>
          ) : null}
          {children}
        </MessageContent>
      </Message>
    )
  }
  return (
    <Message className="text-xs">
      <MessageContent>
        {/* the name is part of the message: floated, it opens the first line and the words run on after it, while wrapped lines, tool rows and later paragraphs start at the left edge under the name; its bubbles flow as blocks so the words can wrap around it */}
        <div className="-mt-2.5 min-w-0 [&_[data-slot=bubble-content]]:overflow-visible [&_[data-slot=bubble]]:block [&>:not([data-float])]:mt-2.5 [&>[data-float]]:mt-2.5">
          {time ? (
            <span data-float className="float-right ml-2 leading-5">
              {time}
            </span>
          ) : null}
          {inline ? (
            <span data-float className="float-left mr-1.5 text-sm leading-5 font-medium">
              {who}
            </span>
          ) : (
            <span className="block text-sm leading-5 font-medium">{who}</span>
          )}
          {words}
          {children}
        </div>
      </MessageContent>
    </Message>
  )
}
