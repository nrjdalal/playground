import type { MergeQueue } from "@/lib/dashboard/merge-queue"
import type { WorkQueue } from "@/lib/dashboard/work-queue"

// Pure: both queues as Markdown, the dashboard's own merge queue (its order, each pull's ETA, then the parked ones) and then the work queue when one is set, as `bun run queues` prints them.
export function queuesMarkdown({
  name,
  queue,
  repo,
  work,
}: {
  name: string
  queue: MergeQueue | null
  repo: string
  work: WorkQueue | null
}): string {
  const own = queue?.queue ?? []
  const parked = queue?.parked ?? []
  const lines = [`## ${name} merge queue`, ""]
  if (own.length === 0) lines.push("Nothing queued.")
  own.forEach((entry, i) => {
    const eta = entry.etaMerge ? `, merging by ${entry.etaMerge}` : ""
    lines.push(`${i + 1}. ${repo}#${entry.pr}${entry.item ? ` ${entry.item}` : ""}${eta}`)
  })
  if (parked.length > 0) {
    lines.push("", `Parked: ${parked.map((entry) => `${repo}#${entry.pr}`).join(", ")}`)
  }
  lines.push("")
  if (!work) return lines.join("\n")
  lines.push(`## ${work.label} queue`, "")
  if (work.problem) lines.push(`GitHub could not be read: ${work.problem.reason}.`)
  else if (work.pulls.length === 0) lines.push("No open pull requests.")
  work.pulls.forEach((pull, i) => {
    lines.push(
      `${i + 1}. ${pull.repo}#${pull.number} ${pull.title}, into ${pull.base}: waits on ${pull.waitsOn}, approvals ${pull.approvals}`,
    )
  })
  lines.push("")
  return lines.join("\n")
}
