// A pr:merge stopped by SIGHUP, SIGINT or SIGTERM still lets go of what it holds: each cleanup registered here runs, oldest first, so the merge lock goes before the slower types worktree, then the process exits as the signal's default would.
import { constants } from "node:os"

export type StopSignal = "SIGHUP" | "SIGINT" | "SIGTERM"

type Cleanup = (signal: StopSignal) => Promise<void>

const SIGNALS: StopSignal[] = ["SIGHUP", "SIGINT", "SIGTERM"]
const cleanups = new Set<Cleanup>()
let stopped = false

const stop = async (signal: StopSignal) => {
  if (stopped) return
  stopped = true
  for (const cleanup of [...cleanups]) {
    await cleanup(signal).catch((err) =>
      console.error(`a cleanup on ${signal} failed: ${err instanceof Error ? err.message : err}`),
    )
  }
  process.exit(128 + constants.signals[signal])
}

const listeners = SIGNALS.map((signal) => [signal, () => void stop(signal)] as const)

// Whether a signal has begun stopping this process, so a merge whose lock is already let go stops short of squashing.
export const stopping = (): boolean => stopped

// Runs cleanup if a signal stops the process before the returned function is called; the signals are listened for only while a cleanup is registered.
export function onStop(cleanup: Cleanup): () => void {
  if (cleanups.size === 0) for (const [signal, listener] of listeners) process.on(signal, listener)
  cleanups.add(cleanup)
  return () => {
    cleanups.delete(cleanup)
    if (cleanups.size === 0)
      for (const [signal, listener] of listeners) process.off(signal, listener)
  }
}
