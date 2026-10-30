import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import type { RosterKind } from "@packages/config/kinds"
import { dataDirOf } from "@packages/env/data-dir"

// Every name a session holds or held: the roster's entries, ended ones included, each live session's registry file, and the backend pins, one file per session, whose names a respawn would reuse; the roster and the pins are read from the data folder.
export const usedNames = async (
  config: string,
  data = dataDirOf(process.env),
): Promise<string[]> => {
  const names: string[] = []
  try {
    const roster = JSON.parse(await Bun.file(join(data, "roster.json")).text()) as {
      agents?: unknown[]
    }
    // an entry that is not an object is skipped, so it hides none after it
    for (const agent of roster.agents ?? []) {
      if (typeof agent !== "object" || agent === null) continue
      const { name } = agent as { name?: unknown }
      if (typeof name === "string") names.push(name)
    }
  } catch {}
  try {
    const backends = join(data, "backends")
    if (existsSync(backends)) names.push(...readdirSync(backends))
  } catch {}
  try {
    const sessions = join(config, "sessions")
    if (existsSync(sessions)) {
      for (const file of readdirSync(sessions)) {
        if (!file.endsWith(".json")) continue
        try {
          const entry = JSON.parse(await Bun.file(join(sessions, file)).text()) as {
            name?: unknown
          }
          if (typeof entry.name === "string") names.push(entry.name)
        } catch {}
      }
    }
  } catch {}
  return names
}

// Pure: `<id>-<kind>` from the first of a few new ids that no used name starts with, whatever kind followed it, or null when each was held.
export const freshName = (kind: RosterKind, used: string[], newId: () => string): string | null => {
  for (let tries = 0; tries < 5; tries++) {
    const id = newId()
    if (!used.some((name) => name.startsWith(`${id}-`))) return `${id}-${kind}`
  }
  return null
}
