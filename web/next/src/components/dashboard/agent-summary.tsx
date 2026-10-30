import type { Agent } from "@api/hono"

import { AgentStatus } from "@/components/dashboard/agent-status"
import { Hint } from "@/components/hint"
import { oneLine } from "@/lib/dashboard"
import { relativeTime } from "@/lib/time"

// One agent's standing as its view's subtitle, one line under its name: what it is doing (cut by `oneLine`, since a first ask can be a whole brief), its status, when it was last active, its branch and pull request, cut at the edge, with what it is doing in full and its last report on hover. Unused since the view lost its header, kept for the stats place still to be picked.
export function AgentSummary({ agent, doing, now }: { agent: Agent; doing: string; now: Date }) {
  const { branch, lastActivityAt, pr, report } = agent
  const hover = report
    ? `${doing}\n\nLast report${report.at ? `, ${relativeTime(report.at, now)}` : ""}: ${report.text}`
    : doing
  return (
    <Hint content={hover}>
      <span className="block truncate">
        {oneLine(doing)}
        {" · "}
        <AgentStatus agent={agent} now={now.getTime()} />
        {lastActivityAt && ` · Active ${relativeTime(lastActivityAt, now)}`}
        {branch && ` · ${branch}`}
        {pr && (
          <>
            {" · "}
            <a href={pr.url} rel="noreferrer" target="_blank" className="hover:underline">
              #{pr.number}
            </a>
            {pr.state === "open" && pr.draft && " draft"}
          </>
        )}
      </span>
    </Hint>
  )
}
