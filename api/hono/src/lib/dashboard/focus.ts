import { join } from "node:path"

// Relative, not @/: the web's tests type-check this file under web/next's own @/ paths.
import { dataDir } from "../sessions/paths"

// The focus `playground focus on` keeps in the data folder (packages/scripts/src/playground/focus.ts): while it stands, what the Inbox takes in stays quiet.
export type StandingFocus = { session: string; since: string; until: string }

// The focus standing at now, or null when none was turned on, it has ended or its file cannot be read; the fixture's own data folder on a stack that reads no machine.
export async function standingFocus(
  data = dataDir(),
  now = new Date(),
): Promise<StandingFocus | null> {
  try {
    const { session, since, until } = (await Bun.file(join(data, "focus.json")).json()) as Record<
      string,
      unknown
    >
    if (typeof session !== "string" || typeof since !== "string" || typeof until !== "string")
      return null
    return now.getTime() < Date.parse(until) ? { session, since, until } : null
  } catch {
    return null
  }
}
