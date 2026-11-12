// The split between a dashboard page and its aside window, as the owner last let go of it, kept in a cookie so the server paints the next load at that split.
export const SPLIT_COOKIE = "dashboard.aside.split"
// each half's floor, in percent of the split
export const SPLIT_MIN = 30
const YEAR_S = 60 * 60 * 24 * 365
// how near the middle, in percent of the width, a let-go drag of the split snaps to it
const SNAP = 5

export type Split = { aside: number; page: number }

export const snapsToMiddle = (page: number) => page !== 50 && Math.abs(page - 50) < SNAP

// The page's width a let-go keeps: the middle when it snaps there, else where it was let go.
export const letGo = (page: number): number => (snapsToMiddle(page) ? 50 : page)

// The stored split, or null when there is none or it reads as anything but the page's percent with both halves on their floor (the browser sets it, so the server trusts nothing more).
export function storedSplit(raw: string | undefined): Split | null {
  if (!raw || !/^\d{1,2}(\.\d{1,2})?$/.test(raw)) return null
  const page = Number(raw)
  if (page < SPLIT_MIN || page > 100 - SPLIT_MIN) return null
  return { aside: Math.round((100 - page) * 100) / 100, page }
}

// The cookie that keeps the page's width for a year, to two decimals, sent only with the dashboard's own requests.
export const splitCookie = (page: number): string =>
  `${SPLIT_COOKIE}=${Math.round(page * 100) / 100}; Path=/dashboard; Max-Age=${YEAR_S}; SameSite=Lax`
