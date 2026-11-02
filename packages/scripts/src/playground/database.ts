export type Docker = (args: string[]) => Promise<{ code: number; out: string }>

export const STOPPED_LINE = "The Dashboard's database was stopped; starting it"
export const POLICY_LINE = "The Dashboard's database now starts again with Docker after a restart"

// The live dashboard's database by name, as isLiveDatabase in api/hono/src/lib/dev/live-dashboard.ts reads it: live.container, or the one pglaunch started under it with a dash and 4 letters or digits.
const isLive = (name: string, live: string): boolean =>
  name === live ||
  (name.startsWith(`${live}-`) && /^[0-9a-zA-Z]{4}$/.test(name.slice(live.length + 1)))

// The Dashboard's database container, set to restart with Docker and started when it has stopped: the lines it printed, and why a step failed. Docker that does not answer, or no single container of that name, leaves it to the supervisor, whose refusal the wait shows.
export const ensureDatabase = async (
  live: string,
  docker: Docker,
): Promise<{ failed?: string; lines: string[] }> => {
  const listed = await docker(["ps", "-a", "--format", "{{.Names}}\t{{.State}}"])
  if (listed.code !== 0) return { lines: [] }
  const found = listed.out
    .split("\n")
    .map((row) => row.split("\t").map((part) => part.trim()))
    .filter(([name]) => name && isLive(name, live))
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
  if (state !== "running") {
    lines.push(STOPPED_LINE)
    const started = await docker(["start", name])
    if (started.code !== 0) failed.push(`docker start ${name} failed: ${started.out}`)
  }
  return failed.length ? { failed: failed.join("; "), lines } : { lines }
}
