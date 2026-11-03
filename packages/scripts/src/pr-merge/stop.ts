// A pr:merge stopped by SIGHUP, SIGINT or SIGTERM still lets go of what it holds: once any squash it started settles, each cleanup registered here runs, newest first, so the types gate's running step is killed and waited for before the merge lock goes, since every merge checks out into the one worktree it runs in, then the process exits as the signal's default would.
import { constants } from "node:os"

export type StopSignal = "SIGHUP" | "SIGINT" | "SIGTERM"

type Cleanup = (signal: StopSignal) => Promise<void>

const SIGNALS: StopSignal[] = ["SIGHUP", "SIGINT", "SIGTERM"]
const cleanups = new Set<Cleanup>()
let settling: Promise<unknown> | null = null
let stopped: StopSignal | null = null

const exit = (signal: StopSignal) => process.exit(128 + constants.signals[signal])

// A second signal exits at once, as an escape from a cleanup that hangs: by then the lock has gone, or a squash still holds it, which leaves it held as a crash would.
const stop = async (signal: StopSignal) => {
  if (stopped) exit(signal)
  stopped = signal
  await settling?.catch(() => {})
  for (const cleanup of [...cleanups].reverse()) {
    await cleanup(signal).catch((err) =>
      console.error(`a cleanup on ${signal} failed: ${err instanceof Error ? err.message : err}`),
    )
  }
  exit(signal)
}

const listeners = SIGNALS.map((signal) => [signal, () => void stop(signal)] as const)

// The signal that has begun stopping this process, or null: a merge whose lock is already let go stops short of squashing, and a release names it.
export const stopping = (): StopSignal | null => stopped

// Runs work to the end before a signal's cleanups run, for the squash, which a spawned gh carries on after an exit: the lock must outlast it.
export function settleFirst<T>(work: () => Promise<T>): Promise<T> {
  const running = work()
  settling = running
  return running
}

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
