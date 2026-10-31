import { REQUIRED_CHECKS, type Check } from "../../../../../packages/scripts/src/pr-merge/gates"

// GitHub's required jobs, each one finished green on the head: the ci gate needs them all.
export const greenChecks = (): Check[] =>
  REQUIRED_CHECKS.map((name) => ({
    conclusion: "SUCCESS",
    name,
    startedAt: "2026-10-30T00:00:00Z",
    status: "COMPLETED",
    workflowName: name,
  }))
