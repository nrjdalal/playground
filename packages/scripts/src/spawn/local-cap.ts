import { existsSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"

import { dataDir } from "../../../env/src/data-dir"

// K's measured limit, 6 sessions at once (the 2026-11-17 test's row K with MTP), for a machine the model switch has not sized.
export const LOCAL_SESSION_CAP = 6

type Server = { maxSessions?: unknown; port?: unknown }

// Pure: the most local sessions the server on <port> takes at once, from the model switch's state for <machine>, and where that figure came from; a state that names no such server falls back to K's limit.
export const capOf = (
  state: unknown,
  machine: string,
  port: number,
): { cap: number; from: string } => {
  const machines = (state as { machines?: Record<string, { servers?: Record<string, Server> }> })
    ?.machines
  const servers = Object.values(machines?.[machine]?.servers ?? {})
  const cap = servers.find((server) => server?.port === port)?.maxSessions
  return typeof cap === "number" && Number.isInteger(cap) && cap > 0
    ? { cap, from: "models/state.json" }
    : {
        cap: LOCAL_SESSION_CAP,
        from: `K's limit, as models/state.json sizes no server on ${port} here`,
      }
}

// spawn.sh's local gate: `bun local-cap.ts <port>` prints the cap, a tab and its source, or exits 1 naming a state file that does not read.
if (import.meta.main) {
  const port = Number(process.argv[2])
  if (!Number.isInteger(port)) {
    console.error("usage: local-cap.ts <port>")
    process.exit(2)
  }
  const path = join(dataDir(), "models", "state.json")
  let state: unknown = {}
  if (existsSync(path)) {
    try {
      state = await Bun.file(path).json()
    } catch {
      console.error(
        `it cannot read ${path} (does not read), so it cannot tell how many sessions the local model serves`,
      )
      process.exit(1)
    }
  }
  const { cap, from } = capOf(state, hostname().split(".")[0] ?? "", port)
  console.log(`${cap}\t${from}`)
}
