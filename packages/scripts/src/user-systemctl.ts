import { existsSync } from "node:fs"

// A `systemctl --user` argv that finds the user's bus from a herdr pane, a cron or ssh, where XDG_RUNTIME_DIR is unset and systemctl prints "Failed to connect to bus: No medium found": with it unset and /run/user/<uid>/bus there, the call runs under env with XDG_RUNTIME_DIR set to that folder.
export const userSystemctl = (
  args: string[],
  env: Record<string, string | undefined> = process.env,
  uid: number = process.getuid!(),
  exists: (path: string) => boolean = existsSync,
): string[] => {
  const runtime = `/run/user/${uid}`
  const head = ["systemctl", "--user", ...args]
  return env.XDG_RUNTIME_DIR || !exists(`${runtime}/bus`)
    ? head
    : ["env", `XDG_RUNTIME_DIR=${runtime}`, ...head]
}
