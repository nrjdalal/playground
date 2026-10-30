"use client"

import { cn } from "cn"
import Link from "next/link"

import { useDashboard } from "@/components/dashboard/dashboard"
import { Hint } from "@/components/hint"
import { agentLabel, chatLabel, labelSplit, withoutRef } from "@/lib/agent-label"
import { useAgentsBoard } from "@/lib/agents"

// An agent named by its label (labelOf: AB-262#7 Worker, AB-262#7 Reviewer, Builder; a live dispatcher as its chat names it, Alpha or Bravo; a name the board does not hold keeps agentLabel's), linked to its own view while its session is live and plain text otherwise, with the raw name on hover. A peer's socket address (`uds:/tmp/cc-socks/<pid>.sock`) is first resolved to the session it belongs to, from the board's sockets, and a recipient's ` [ref]` is dropped. A caller that knows the agent's session passes sessionId (null for none); else the live session of that name is found. With truncate, a label too long for its cell cuts its text and keeps the kind that follows it (` · reviewer`) whole.
export function AgentLink({
  className,
  name,
  onClick,
  sessionId,
  truncate = false,
}: {
  className?: string
  name: string
  onClick?: React.MouseEventHandler
  sessionId?: string | null
  truncate?: boolean
}) {
  const { dispatcher, workers } = useDashboard()
  const { data } = useAgentsBoard()
  const resolved = data?.sockets[name] ?? withoutRef(name)
  const live =
    sessionId === undefined
      ? workers?.find((w) => w.name === resolved)
      : workers?.find((w) => w.sessionId === sessionId)
  const agentOf = (agent: string) => data?.agents.find((a) => a.name === agent)
  const facts = agentOf(resolved)
  const { kind, text } =
    live?.role === "dispatcher"
      ? { kind: null, text: chatLabel(live, dispatcher) }
      : facts
        ? labelSplit(facts, agentOf)
        : { kind: null, text: agentLabel(resolved) }
  const label =
    kind && truncate ? (
      <>
        <span className="min-w-0 truncate">{text}</span>
        <span className="max-w-full min-w-0 shrink-0 truncate">{`\u00a0· ${kind}`}</span>
      </>
    ) : kind ? (
      `${text} · ${kind}`
    ) : (
      text
    )
  const cut = truncate && (kind ? "flex min-w-0" : "truncate")
  if (!live) {
    return (
      <Hint content={name}>
        <span className={cn(cut, className)}>{label}</span>
      </Hint>
    )
  }
  return (
    <Hint content={name}>
      <Link
        href={`/dashboard?worker=${encodeURIComponent(live.sessionId)}`}
        className={cn("hover:underline", cut, className)}
        onClick={onClick}
      >
        {label}
      </Link>
    </Hint>
  )
}
