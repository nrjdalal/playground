import { isLiveDatabase, type LiveDashboard } from "../../../../api/hono/src/lib/dev/live-dashboard"

export type Docker = (args: string[]) => Promise<{ code: number; out: string }>

export const STOPPED_LINE = "The Dashboard's database was stopped; starting it"
export const POLICY_LINE = "The Dashboard's database now starts again with Docker after a restart"

// The Dashboard's database container, set to restart with Docker and started when it has stopped: the lines it printed, and why a step failed. Docker that does not answer, or no single container of that name, leaves it to the supervisor, whose refusal the wait shows.
export const ensureDatabase = async (
  live: LiveDashboard,
  docker: Docker,
): Promise<{ failed?: string; lines: string[] }> => {
  const listed = await docker(["ps", "-a", "--format", "{{.Names}}\t{{.State}}"])
  if (listed.code !== 0) return { lines: [] }
  const found = listed.out
    .split("\n")
    .map((row) => row.split("\t").map((part) => part.trim()))
    .filter(([name]) => name && isLiveDatabase(name, live))
  if (found.length !== 1) return { lines: [] }
  const [name = "", state] = found[0]!
  const lines: string[] = []
  const failed: string[] = []
  const policy = await docker(["inspect", "-f", "{{.HostConfig.RestartPolicy.Name}}", name])
  if (policy.code === 0 && !["always", "unless-stopped"].includes(policy.out)) {
    const set = await docker(["update", "--restart", "unless-stopped", name])
    if (set.code === 0) lines.push(POLICY_LINE)
    else failed.push(`docker update --restart unless-stopped ${name} failed: ${set.out}`)
  }
  // a paused or restarting container is Docker's to bring back, and docker start would refuse it
  if (state === "exited" || state === "created") {
    lines.push(STOPPED_LINE)
    const started = await docker(["start", name])
    if (started.code !== 0) failed.push(`docker start ${name} failed: ${started.out}`)
  }
  return failed.length ? { failed: failed.join("; "), lines } : { lines }
}
