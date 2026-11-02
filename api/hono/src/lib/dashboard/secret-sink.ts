import { tmpdir } from "node:os"

import { readsLive } from "@/lib/dashboard/fixture"
import type { SecretSink, SinkRun } from "@/lib/dashboard/inbox"

// A sink that waits on a prompt is stopped after this long, so a Submit never hangs.
const SINK_TIMEOUT_MS = 60_000

// The sink's whole environment: what its command needs to find itself, its login, a proxy and a custom CA, so the API's own secrets stay out of it.
const PASSED = [
  "ALL_PROXY",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_FILE",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]

// Each kind's own variables beside those: vercel's VERCEL_*; op's OP_* (its account, session and config folder) and XDG_CONFIG_HOME, where it finds its config.
const OWN: Record<SecretSink["type"], (key: string) => boolean> = {
  "1password": (key) => key.startsWith("OP_") || key === "XDG_CONFIG_HOME",
  vercel: (key) => key.startsWith("VERCEL_"),
}

export const sinkEnv = (
  kind: SecretSink["type"],
  from: Record<string, string | undefined> = process.env,
) =>
  Object.fromEntries(
    Object.entries(from).flatMap(([key, value]) =>
      value !== undefined && (PASSED.includes(key) || OWN[kind](key)) ? [[key, value]] : [],
    ),
  )

// Runs a secret ask's sink: its stdin written and closed, its output dropped unread, so nothing it prints is kept; its exit code, null once stopped by a signal (its time limit's included), 127 when it could not start. It runs from the temp folder, so no checkout's linked project is read in place of the one its argv names.
export async function spawnSink(
  argv: string[],
  value: string,
  kind: SecretSink["type"],
  timeout = SINK_TIMEOUT_MS,
): Promise<number | null> {
  let proc: Bun.Subprocess<"pipe", "ignore", "ignore">
  try {
    proc = Bun.spawn(argv, {
      cwd: tmpdir(),
      env: sinkEnv(kind),
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

// Only a stack that reads the live machine runs the sink (fixture.ts's dashboardSource), as only it opens cmux: a fixture or test stack runs nothing and reads exit 0, so no test reaches a real Vercel project or 1Password vault.
export const runSink: SinkRun = (argv, value, kind) =>
  readsLive() ? spawnSink(argv, value, kind) : Promise.resolve(0)
