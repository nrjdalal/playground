import { JOB_CHECKS, type StampCheck } from "../../../../../packages/scripts/src/pr-merge/stamp"

// Every check GitHub's gate jobs run, as a green stamp passes them: the suite gate needs them all.
export const SUITE = Object.values(JOB_CHECKS).flat()

export const suiteChecks = (source = "local"): Record<string, StampCheck> =>
  Object.fromEntries(SUITE.map((name) => [name, { source, status: "pass" as const }]))
