// The global verify's browser sets before every page's own script (packages/scripts/src/verify/checks.ts), so a page can tell verify's visit from a person's: the dashboard has one user, which verify signs in as, so a visit that writes state would write the owner's.
export const VERIFY_VISIT = "__verifyVisit"

export const isVerifyVisit = (): boolean =>
  typeof window !== "undefined" &&
  (window as unknown as Record<string, unknown>)[VERIFY_VISIT] === true
