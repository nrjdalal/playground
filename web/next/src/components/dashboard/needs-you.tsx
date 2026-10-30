"use client"

import type { Agent } from "@api/hono"
import Link from "next/link"

import { AgentLink } from "@/components/dashboard/agent-link"
import { useDashboard } from "@/components/dashboard/dashboard"
import { Hint } from "@/components/hint"
import { dispatcherOf } from "@/lib/dashboard"
import { inboxWaiting, useInbox } from "@/lib/inbox"
import { needsYouPlaces, targetNeedsYou } from "@/lib/needs-you"

// What waits on the owner, which is the dispatchers alone: each one's prompts, named as its chat names it, and what needs you in the first one's Inbox, from the same reads as its Inbox tab's count, linked to the first card (the newest Inbox item, else the oldest prompt); then the first stopped on a prompt the cards do not hold yet, linked to its view. Every other session waits on a dispatcher and shows so in the table above.
export function NeedsYou({ agents }: { agents: Agent[] }) {
  const { allowed, dispatcher: primary, workers } = useDashboard()
  const places = needsYouPlaces(inboxWaiting(useInbox(allowed).data?.items ?? []), workers, primary)
  const covered = new Set(places.map((place) => place.sessionId))
  const dispatcher = dispatcherOf(workers, primary)
  const dispatcherId = dispatcher?.sessionId ?? null
  // a Playground the usage limit alone holds waits on the reset, not on you
  const prompts = agents.filter(
    (agent) =>
      agent.state === "needs-you" &&
      agent.sessionId === dispatcherId &&
      !dispatcher?.usageLimit &&
      dispatcherId !== null &&
      !covered.has(agent.sessionId),
  )
  const total = places.reduce((sum, place) => sum + place.count, 0) + prompts.length
  return (
    <section aria-labelledby="needs-you" className="flex flex-col gap-2">
      <h2 id="needs-you" className="text-muted-foreground text-sm font-medium">
        Needs you{total > 0 && <span className="font-normal"> · {total} waiting</span>}
      </h2>
      {total === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing waits on you.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {places.map((place) => (
            <li key={place.key}>
              <Hint content={place.sessionId ? place.name : undefined}>
                <Link
                  href={place.href}
                  className="hover:underline"
                  onClick={() => targetNeedsYou(place.first)}
                >
                  {place.label}
                </Link>
              </Hint>{" "}
              <span className="text-muted-foreground">· {place.count} waiting</span>
            </li>
          ))}
          {prompts.map((agent) => (
            <li key={agent.sessionId}>
              <AgentLink name={agent.name} sessionId={agent.sessionId} /> is waiting on you
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
