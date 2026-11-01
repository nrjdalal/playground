// A stamp for "now" may run this far ahead of the clock before a reader refuses it, room for a slow write, never for a time typed ahead.
export const CLOCK_SLACK_MS = 2 * 60 * 1000

// Pure: true when an ISO time is past now by more than the slack; one that does not parse is never ahead.
export const isAhead = (iso: string, now: Date): boolean => {
  const at = Date.parse(iso)
  return !Number.isNaN(at) && at - now.getTime() > CLOCK_SLACK_MS
}
