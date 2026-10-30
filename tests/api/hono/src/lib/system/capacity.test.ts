import { describe, expect, test } from "bun:test"

import {
  idleLineOf,
  PER_WORKER,
  roomOf,
  type CapacityInput,
} from "../../../../../../api/hono/src/lib/system/capacity"

const GB = 1024 ** 3

// dispatcher's snapshot for the brief: 24 GB and 15 cores, 48% free, load 11.7/10.6/9.1.
const snapshot: CapacityInput = {
  cores: 15,
  freePercent: 48,
  load5: 10.6,
  pressure: "normal",
  totalBytes: 24 * GB,
}

describe("roomOf", () => {
  test("the smaller of memory room and CPU room, in workers", () => {
    // memory: (0.48 - 0.15) x 24 GB = 7.9 GB, 6 workers; CPU: 15 - 10.6 = 4.4 cores, 4 workers
    expect(roomOf(snapshot)).toEqual({
      limitedBy: "cpu",
      line: "Room for ~4 more workers, by CPU load",
      workers: 4,
    })
    expect(roomOf({ ...snapshot, load5: 2 })).toEqual({
      limitedBy: "memory",
      line: "Room for ~6 more workers, by memory",
      workers: 6,
    })
    expect(roomOf({ ...snapshot, load5: 13.5 }).line).toBe("Room for ~1 more worker, by CPU load")
  })

  test("no room while macOS reports memory pressure, whatever else is free", () => {
    expect(roomOf({ ...snapshot, load5: 1, pressure: "warn" })).toEqual({
      limitedBy: "pressure",
      line: "No room: memory pressure is warn",
      workers: 0,
    })
    expect(roomOf({ ...snapshot, load5: 1, pressure: "critical" }).workers).toBe(0)
    expect(roomOf({ ...snapshot, pressure: null }).workers).toBe(4)
  })

  test("no room when either runs out, saying which", () => {
    expect(roomOf({ ...snapshot, load5: 14.5 })).toEqual({
      limitedBy: "cpu",
      line: "No room: the 5-minute load 14.5 leaves under a core of 15",
      workers: 0,
    })
    expect(roomOf({ ...snapshot, freePercent: 19, load5: 1 })).toEqual({
      limitedBy: "memory",
      line: "No room: 1.0 GB free past the reserve, under the 1.3 GB a worker takes",
      workers: 0,
    })
    expect(roomOf({ ...snapshot, freePercent: 5, load5: 1 }).line).toContain("0.0 GB free")
  })

  test("free memory that could not be read is no room, never a guess", () => {
    expect(roomOf({ ...snapshot, freePercent: null })).toEqual({
      limitedBy: "memory",
      line: "No room: free memory could not be read",
      workers: 0,
    })
  })

  test("a worker is costed at 1.3 GB and a core", () => {
    expect(PER_WORKER).toEqual({ bytes: 1.3 * GB, cores: 1 })
  })
})

describe("idleLineOf", () => {
  const stack = (gb: number) => ({
    bytes: gb * GB,
    checkout: "/r/wt/a",
    idleSince: "2026-10-06T08:00:00.000Z",
    name: "worker-a",
  })

  test("what stopping the idle stacks frees, or nothing when none idles", () => {
    expect(idleLineOf([])).toBeNull()
    expect(idleLineOf([stack(0.8)])).toBe("Stop the idle dev stack to free 0.8 GB")
    expect(idleLineOf([stack(0.8), stack(0.5)])).toBe("Stop 2 idle dev stacks to free 1.3 GB")
  })
})
