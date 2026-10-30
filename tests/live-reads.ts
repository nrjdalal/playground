import { afterAll } from "bun:test"

// A test run reads a fixture on any branch (api/hono/src/lib/dashboard/fixture.ts's rule 3), as factory stacks do. A test file that drives the live paths against its own scratch files (a CLAUDE_CONFIG_DIR, a fake cmux) opts in as a live-reads stack does, from its load to its end, so the files after it still read the fixture.
export function liveReads(env: Record<string, string> = {}): void {
  const set = { PLAYGROUND_LIVE_READS: "1", ...env }
  const before = Object.keys(set).map((key) => [key, process.env[key]] as const)
  Object.assign(process.env, set)
  afterAll(() => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

// The same opt-in for a child process a test spawns: its environment, with live reads on.
export const liveReadsEnv = (
  env: Record<string, string | undefined>,
): Record<string, string | undefined> => ({ ...env, PLAYGROUND_LIVE_READS: "1" })
