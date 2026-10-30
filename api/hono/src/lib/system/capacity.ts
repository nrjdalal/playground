import type { Pressure } from "@/lib/system/parse"

// What one more worker costs once it runs a dev stack: its claude (about 0.5 GB), next dev, the API, turbo and its Postgres, and about a core while it builds and tests.
export const PER_WORKER = { bytes: 1.3 * 1024 ** 3, cores: 1 }

// The share of RAM left to macOS and the apps the owner uses, never counted as room.
export const RESERVE_SHARE = 0.15

export type Limit = "cpu" | "memory" | "pressure"

// Swap is shown but never judged: macOS adds swap files as it needs them, so the share in use rises and falls with no change in strain, and the pressure level is macOS's own word for when swapping hurts.
export type CapacityInput = {
  cores: number
  freePercent: number | null
  load5: number
  pressure: Pressure | null
  totalBytes: number
}

export type Room = { limitedBy: Limit | null; line: string; workers: number }

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`

// Pure: how many more workers fit, by whichever of memory and CPU runs out first, and none at all while macOS reports memory pressure. Memory room is what macOS counts as free (the share memory_pressure prints) less the reserve; CPU room is the cores less the 5-minute load. Unknown free memory counts as no room, since a guess here spawns sessions.
export function roomOf(input: CapacityInput): Room {
  const { cores, freePercent, load5, pressure, totalBytes } = input
  if (pressure === "warn" || pressure === "critical") {
    return { limitedBy: "pressure", line: `No room: memory pressure is ${pressure}`, workers: 0 }
  }
  if (freePercent === null) {
    return { limitedBy: "memory", line: "No room: free memory could not be read", workers: 0 }
  }
  const memoryRoom = (freePercent / 100 - RESERVE_SHARE) * totalBytes
  const cpuRoom = cores - load5
  const byMemory = Math.max(0, Math.floor(memoryRoom / PER_WORKER.bytes))
  const byCpu = Math.max(0, Math.floor(cpuRoom / PER_WORKER.cores))
  const limitedBy: Limit = byCpu < byMemory ? "cpu" : "memory"
  const workers = Math.min(byMemory, byCpu)
  if (workers === 0) {
    return {
      limitedBy,
      line:
        limitedBy === "cpu"
          ? `No room: the 5-minute load ${load5.toFixed(1)} leaves under a core of ${cores}`
          : `No room: ${gb(Math.max(0, memoryRoom))} free past the reserve, under the ${gb(PER_WORKER.bytes)} a worker takes`,
      workers,
    }
  }
  return {
    limitedBy,
    line: `Room for ~${workers} more worker${workers === 1 ? "" : "s"}, by ${limitedBy === "cpu" ? "CPU load" : "memory"}`,
    workers,
  }
}

export type IdleStack = { bytes: number; checkout: string; idleSince: string; name: string | null }

// Pure: the line that says how much stopping idle stacks would free, or null when none is idle.
export function idleLineOf(stacks: IdleStack[]): string | null {
  if (stacks.length === 0) return null
  const bytes = stacks.reduce((sum, stack) => sum + stack.bytes, 0)
  const count = stacks.length === 1 ? "the idle dev stack" : `${stacks.length} idle dev stacks`
  return `Stop ${count} to free ${gb(bytes)}`
}
