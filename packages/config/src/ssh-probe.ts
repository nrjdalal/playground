// A probe spawn.sh started with --ssh runs its claude on another machine, so no registry file here proves it live; its pane here does, while the ssh that carries it runs. Ops' sweep and the Dashboard's live list both read it by this one rule, each passing in its own reads.
export type SshLaunch = { name: string; server: string; sessionId: string }

const SESSION = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
// spawn.sh resume <name> <folder> <session> …, the folder written with %q, so it may hold an escaped space
const EXEC = new RegExp(`^exec \\S+ resume (\\S+) (?:\\\\ |\\S)+ (${SESSION})(?: |$)`)

// Pure: the launch a resume record names when its exec line starts an --ssh probe, else null; its server is the record's server line, playground when it has none, as spawn.sh restore reads it.
export function sshLaunchOf(record: string): SshLaunch | null {
  const lines = record.split("\n")
  const exec = lines.find((line) => line.startsWith("exec "))
  if (!exec || !/ --ssh \S/.test(exec)) return null
  const words = exec.match(EXEC)
  if (!words?.[1] || !words[2]) return null
  const server = lines
    .find((line) => line.startsWith("# server: "))
    ?.slice(10)
    .trim()
  return { name: words[1], server: server || "playground", sessionId: words[2] }
}

// Pure: the ssh process that carries a launch in a pane, or undefined: the pane is on the launch's server, carries its name as its label and runs ssh in its foreground (its argv's first word), which it does while the link to the far machine stands, so a pane back at its shell holds none.
export function sshProcessOf<P extends { argv?: string[] | null }>(
  launch: SshLaunch,
  server: string,
  pane: { label?: string | null; processes: P[] },
): P | undefined {
  if (server !== launch.server || pane.label !== launch.name) return undefined
  return pane.processes.find((p) => /(^|\/)ssh$/.test(p.argv?.[0] ?? ""))
}
