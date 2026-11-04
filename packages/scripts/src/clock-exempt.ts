// Files the clock-ahead pass (CLOCK_AHEAD_DAYS, test-sandbox.ts) leaves out, each for a clock its preload cannot move: a child process keeps the real clock while the test's own fixtures take the moved one, and a file's mtime comes from the OS's clock, so each reads red on the shift alone
export const CLOCK_EXEMPT: [pattern: string, reason: string][] = [
  ["tests/api/hono/src/bin/dashboard-ask.test.ts", "runs bun run ask as a child"],
  ["tests/api/hono/src/lib/dashboard/attachments.test.ts", "sweeps by a file's mtime"],
  ["tests/api/hono/src/lib/dashboard/inbox-attachments.test.ts", "sweeps by a file's mtime"],
  ["tests/packages/scripts/src/dm/send.test.ts", "takes a lock by its file's mtime"],
  ["tests/packages/scripts/src/hook-differential.test.ts", "reads transcripts by their mtime"],
  ["tests/packages/scripts/src/pr-merge/freeze-cli.test.ts", "runs ship:freeze as a child"],
  ["tests/scripts/ops/run-slot*.test.ts", "runs run-slot.sh as a child"],
  ["tests/scripts/ops/unstick/run.test.ts", "runs ops-unstick's Python as a child"],
  ["tests/scripts/ops/usage/week-marks.test.ts", "runs the usage job's Python as a child"],
  ["tests/scripts/roster.test.ts", "runs roster.ts as a child"],
  ["tests/scripts/spawn*.test.ts", "runs spawn.sh as a child"],
]

// Pure: whether the clock-ahead pass leaves this test file out, by its path from the repo root with or without a leading ./
export const clockExempt = (path: string): boolean =>
  CLOCK_EXEMPT.some(([pattern]) => new Bun.Glob(pattern).match(path.replace(/^(\.\/)+/, "")))
