// How many rows the System page's Agents table last showed in this browser, kept in a cookie so the server paints the next load's empty rows at that count.
export const AGENT_ROWS_COOKIE = "dashboard.system.agentRows"
// Its name before the rename, read until the page next writes the new one.
export const OLD_AGENT_ROWS_COOKIE = "desk.system.agentRows"
const MAX_ROWS = 50
const YEAR_S = 60 * 60 * 24 * 365

// The stored count, a whole number from 1 to 50, or null when there is none, it reads as anything else (the browser sets it, so the server trusts nothing more) or reading it throws.
export function storedRows(read: () => string | null | undefined): number | null {
  try {
    const raw = read()
    if (!raw || !/^\d+$/.test(raw)) return null
    const rows = Number(raw)
    return rows > 0 && rows <= MAX_ROWS ? rows : null
  } catch {
    return null
  }
}

// The cookie that keeps a count for the next load for a year, sent only with the System page's own requests.
export const rowsCookie = (rows: number): string =>
  `${AGENT_ROWS_COOKIE}=${rows}; Path=/dashboard/system; Max-Age=${YEAR_S}; SameSite=Lax`

// The longest the sections below stay hidden under a read table for the inbox and the live sessions, so a slow read never blanks them for longer.
export const HOLD_MS = 3000

// What the page draws while it loads: the Agents table's real toolbar and header over empty rows at the stored count, else a spinner, and the sections below it laid out but hidden until the board, the inbox and the live sessions are read (Next up comes from the board, Needs you grows with its agents, the inbox and the sessions' Feed prompts), so they show at their place and nothing on the page moves down as they fill in. The board always holds them, since the table above is still loading too; the hold spent with only the inbox or the sessions out shows them, and a failed read shows them at once.
export function systemLoading({
  agentsPending,
  inboxPending,
  failed,
  held,
  sessionsPending,
  stored,
}: {
  agentsPending: boolean
  inboxPending: boolean
  failed: boolean
  held: boolean
  sessionsPending: boolean
  stored: number | null
}): { agents: "reading" | "spinner" | "table"; below: boolean } {
  if (failed) return { agents: "table", below: true }
  const agents = !agentsPending ? "table" : stored ? "reading" : "spinner"
  return {
    agents,
    below: !agentsPending && (!held || (!inboxPending && !sessionsPending)),
  }
}
