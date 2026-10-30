// First run: while the API has no database it serves its setup routes alone (api/hono/src/lib/setup/app.ts), and /dashboard's layout shows the first-run pane in place of the dashboard.

// Pure: what GET /api/setup's status says of the stack. 200 is setup mode; 404 is the normal app, which never goes back to setup without a restart; anything else, a failed read included, is not known yet, so the page shows as it would.
export type Gate = "normal" | "setup" | "unknown"
export const gateOf = (status: number | undefined): Gate =>
  status === 200 ? "setup" : status === 404 ? "normal" : "unknown"

// GET /api/setup's status, undefined when the API does not answer within 2s.
export const readSetup = async (api: string): Promise<number | undefined> => {
  try {
    const response = await fetch(`${api}/api/setup`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    })
    return response.status
  } catch {
    return undefined
  }
}

export type FirstRunView = "checks" | "frame" | "steps"

// Pure: what /dashboard's pane shows on a first run: the neutral frame while any fact on the way is unread (the gate, the silent sign-in, the done mark), so nothing flashes; the checks with no database yet, while signed out once the sign-in finds no owner, and signed in until the done mark is written; then the steps, which Alpha's chat replaces once it runs.
export const firstRunView = ({
  done,
  gate,
  signedIn,
}: {
  done?: boolean
  gate?: Gate
  signedIn?: boolean
}): FirstRunView => {
  if (gate === "setup") return done === undefined ? "frame" : "checks"
  if (gate !== "normal" || signedIn === undefined || done === undefined) return "frame"
  return signedIn && done ? "steps" : "checks"
}

// When this tab last signed the owner in by itself, kept until a signed-in page loads: a signed-out load within 30s of it tries no second time, so a cookie that does not stick shows its reason rather than a loop.
const TRIED_KEY = "first-run-sign-in"
const TRIED_MS = 30_000
type Tab = Pick<Storage, "getItem" | "removeItem" | "setItem">

export const markTried = (tab: Tab, now: number) => tab.setItem(TRIED_KEY, String(now))

// Whether this signed-out load follows the tab's own sign-in within 30s; it reads the mark once.
export const triedJustNow = (tab: Tab, now: number): boolean => {
  const at = tab.getItem(TRIED_KEY)
  tab.removeItem(TRIED_KEY)
  return at !== null && now - Number(at) < TRIED_MS
}

// A signed-in page clears the mark, since the cookie stuck.
export const keptSignIn = (tab: Tab) => tab.removeItem(TRIED_KEY)
