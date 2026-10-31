import { tmpdir } from "node:os"

import { readsLive } from "@/lib/dashboard/fixture"
import type { SinkRun } from "@/lib/dashboard/inbox"

// A sink that waits on a prompt is stopped after this long, so a Submit never hangs.
const SINK_TIMEOUT_MS = 60_000

// The sink's whole environment: what vercel needs to find itself, its login and a proxy, so the API's own secrets stay out of it.
const PASSED = ["HOME", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "PATH"]

export const sinkEnv = (from: Record<string, string | undefined> = process.env) =>
  Object.fromEntries(
    Object.entries(from).flatMap(([key, value]) =>
      value !== undefined && (PASSED.includes(key) || key.startsWith("VERCEL_"))
        ? [[key, value]]
        : [],
    ),
  )

// Runs a secret ask's sink: the value written to its stdin and closed, its output dropped unread, so nothing it prints is kept; its exit code, null once stopped by a signal (its time limit's included), 127 when it could not start. It runs from the temp folder, so no checkout's linked project is read in place of the one its argv names.
export async function spawnSink(
  argv: string[],
  value: string,
  timeout = SINK_TIMEOUT_MS,
): Promise<number | null> {
  let proc: Bun.Subprocess<"pipe", "ignore", "ignore">
  try {
    proc = Bun.spawn(argv, {
      cwd: tmpdir(),
      env: sinkEnv(),
      stderr: "ignore",
      stdin: "pipe",
      stdout: "ignore",
      timeout,
    })
  } catch {
    return 127
  }
  try {
    proc.stdin.write(value)
    await proc.stdin.end()
  } catch {
    // a sink that exits before reading closes the pipe; its own exit code says how it went
  }
  await proc.exited
  return proc.signalCode ? null : proc.exitCode
}

// Only a stack that reads the live machine runs the sink (fixture.ts's dashboardSource), as only it opens cmux: a fixture or test stack runs nothing and reads exit 0, so no test reaches a real Vercel project.
export const runSink: SinkRun = (argv, value) =>
  readsLive() ? spawnSink(argv, value) : Promise.resolve(0)
