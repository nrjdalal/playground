"use client"

import type { Worker } from "@api/hono"

import { useDashboard } from "@/components/dashboard/dashboard"
import { StatusIcon } from "@/components/dashboard/worker-light"
import { PulseDot } from "@/components/ui/spinner"
import { LIGHT_LABELS, waitLabel } from "@/lib/dashboard"
import { elapsedLabel, tokensLabel } from "@/lib/live-activity"
import { statusIcon } from "@/lib/status-icons"

// Under the newest row of a chat, live: while the session works, its spinner line's verb, time and tokens from the socket, then the step it is on from its stream; while it waits on the owner, that. The stream shows it only while it says something, below the newest row, so its coming and going moves nothing above it.
export function ActivityLine({ step, worker }: { step: string | null; worker: Worker }) {
  const activity = useDashboard().streams.get(worker.sessionId)?.activity ?? null
  const working = worker.light === "working"
  const numbers = [
    activity?.elapsed != null ? elapsedLabel(activity.elapsed) : null,
    activity?.tokens != null ? tokensLabel(activity.tokens) : null,
  ].filter((part) => part !== null)
  return (
    <div data-slot="activity-line" className="flex h-4 min-w-0 shrink-0 items-center gap-2 text-xs">
      {working ? (
        <>
          <PulseDot aria-label={`${activity?.verb ?? LIGHT_LABELS.working}…`} />
          <span className="text-muted-foreground shrink-0">
            {activity?.verb ?? LIGHT_LABELS.working}…
          </span>
          {numbers.length > 0 ? (
            <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
              {numbers.join(" · ")}
            </span>
          ) : null}
          {step ? <span className="min-w-0 truncate">{step}</span> : null}
        </>
      ) : worker.usageLimit ? (
        <>
          <StatusIcon state="usage-limit" />
          <span className="text-muted-foreground">{statusIcon("usage-limit").label}</span>
        </>
      ) : worker.light === "needs-you" ? (
        <>
          <StatusIcon state="stuck" />
          <span className="text-muted-foreground">{waitLabel(worker.role === "dispatcher")}</span>
        </>
      ) : null}
    </div>
  )
}
