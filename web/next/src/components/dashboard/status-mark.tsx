"use client"

import {
  RiCheckDoubleLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiLoader4Line,
  type RemixiconComponentType,
} from "@remixicon/react"
import { cn } from "cn"
import { useEffect, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { MessageFooter } from "@/components/ui/message"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { oneLine } from "@/lib/dashboard"
import type { StatusMarkKind } from "@/lib/outbox"

const MARKS: Record<StatusMarkKind, { Icon: RemixiconComponentType; className?: string }> = {
  delivered: { Icon: RiCheckDoubleLine },
  failed: { Icon: RiErrorWarningLine, className: "text-destructive" },
  sending: { Icon: RiLoader4Line, className: "motion-safe:animate-spin" },
  sent: { Icon: RiCheckLine },
}

type MarkProps = { hover?: string; label: string; mark: StatusMarkKind }

// His message's footer: whatever it holds first, then the state's action (Unsend, Dismiss, Undo) in its slot, then Copy, then its state mark, always last, so Copy and the mark never move and the buttons before them end at the same x in every state.
export function StatusFooter({
  action,
  children,
  className,
  copy,
  ...mark
}: MarkProps & { action?: ReactNode; children?: ReactNode; className?: string; copy: string }) {
  return (
    <MessageFooter className={className}>
      {children}
      <ActionSlot>{action}</ActionSlot>
      <CopyMessage text={copy} />
      <StatusMark {...mark} />
    </MessageFooter>
  )
}

// One fixed-width slot before Copy holds the state's action, so Copy and the mark never move when it comes or goes.
export function ActionSlot({ children }: { children?: ReactNode }) {
  return <span className="inline-flex w-6 justify-end">{children}</span>
}

// His message's state as one icon in a slot of fixed width; its words are the hover, opened by focus too since the keyboard reaches it, what a screen reader hears, and stay in the text the stream reads.
export function StatusMark({ hover, label, mark }: MarkProps) {
  const { Icon, className } = MARKS[mark]
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span role="status" tabIndex={0} className="inline-flex w-4 shrink-0 justify-center" />
        }
      >
        <Icon aria-hidden className={cn("size-3.5", className)} />
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{hover ? `${label} · ${hover}` : label}</TooltipContent>
    </Tooltip>
  )
}

// One footer action as an icon-only button: its name is its hover (opened by focus too) and what a screen reader hears, kept in the text the stream reads.
export function FooterAction({
  Icon,
  label,
  onClick,
}: {
  Icon: RemixiconComponentType
  label: string
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        <Icon aria-hidden className="size-3.5" />
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// How long the Copy icon stays a check after it copies.
const COPY_MS = 1500

// A message's Copy: writes its markdown text (its words alone, never its tool rows or Attached lines), turns to a check for a moment with its name kept (the icon is the signal), and offers nothing on a message without words (files alone).
export function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPY_MS)
    return () => clearTimeout(timer)
  }, [copied])
  if (!text.trim()) return null
  const label = `Copy "${oneLine(text, 40)}"`
  return (
    <FooterAction
      Icon={copied ? RiCheckLine : RiFileCopyLine}
      label={label}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => {},
        )
      }}
    />
  )
}
