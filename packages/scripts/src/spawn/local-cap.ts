import { dataDir } from "../../../env/src/data-dir"
import { type ModelServer, modelServers, statePath, thisMachine } from "../local-model/state"

// K's measured limit, 6 sessions at once (the 2026-11-17 test's row K with MTP), for a machine the model switch has not sized.
export const LOCAL_SESSION_CAP = 6

// Pure: the most local sessions the server on <port> takes at once, from this machine's servers in the model switch's state, and where that figure came from; no such server falls back to K's limit.
export const capOf = (
  servers: Record<string, ModelServer>,
  port: number,
): { cap: number; from: string } => {
  const cap = Object.values(servers).find((server) => server?.port === port)?.maxSessions
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
  const data = dataDir()
  let servers: Record<string, ModelServer>
  try {
    servers = await modelServers(data, thisMachine())
  } catch {
    console.error(
      `it cannot read ${statePath(data)} (does not read), so it cannot tell how many sessions the local model serves`,
    )
    process.exit(1)
  }
  const { cap, from } = capOf(servers, port)
  console.log(`${cap}\t${from}`)
}
