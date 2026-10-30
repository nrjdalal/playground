import type { Agent } from "@api/hono"
import { cn } from "cn"
import Link from "next/link"

import { Hint } from "@/components/hint"
import { type InboxWait, type LiveFacts, statusParts, type StatusTone } from "@/lib/agents"
import { itemTag } from "@/lib/inbox"
import { needsYouAnchor } from "@/lib/needs-you"
import { PR_TONES, prTone } from "@/lib/status-icons"

// Words take no state colour, the row's icon carrying it: only a quiet phrase is muted.
const TONES: Record<StatusTone, string> = {
  muted: "text-muted-foreground",
  normal: "",
}

// An agent's state in words (Waiting on you for Playground's own picker, dispatcher, Stuck for any other, Ready, Working), muted when quiet, what its state adds and its pull request's state in words on hover. No ETA rides it. Waiting on an inbox item it posted, it links to that item in your chat.
export function AgentStatus({
  agent,
  className,
  dispatcher = false,
  live = {},
  now,
  waitsOn = null,
}: {
  agent: Agent
  className?: string
  dispatcher?: boolean
  live?: LiveFacts
  now: number
  waitsOn?: InboxWait
}) {
  const { detail, text, tone } = statusParts(agent, now, waitsOn, dispatcher, live)
  const pr = prTone(agent)
  const title = [text, detail, waitsOn ? itemTag(waitsOn) : null, pr ? PR_TONES[pr].words : null]
    .filter(Boolean)
    .join(" · ")
  const classes = cn(TONES[tone], className)
  return waitsOn && agent.state !== "down" ? (
    <Hint content={title}>
      <Link
        href={`/dashboard#${needsYouAnchor(waitsOn.id)}`}
        className={cn(classes, "hover:underline")}
      >
        {text}
      </Link>
    </Hint>
  ) : (
    <Hint content={title}>
      <span className={classes}>{text}</span>
    </Hint>
  )
}
