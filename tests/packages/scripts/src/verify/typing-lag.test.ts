import { describe, expect, test } from "bun:test"

import { typingLagResult } from "../../../../../packages/scripts/src/verify/typing-lag"

const run = (pages: number[], wholes = pages, keys = 20) =>
  typingLagResult("t", { keys, pages, wholes }, 20)

describe("typingLagResult", () => {
  test("passes keys whose own work stays within 50ms at the 95th percentile", () => {
    const fast = run(Array(20).fill(20))
    expect(fast.ok).toBe(true)
    expect(fast.detail).toContain("median 20ms, p95 20ms (limit 50ms")
  })

  // the page's own work on a key, not the wait for the frame, decides
  test("fails when the page's own work on the slowest keys passes the limit", () => {
    const slow = run([...Array(18).fill(20), 120, 300])
    expect(slow.ok).toBe(false)
    expect(slow.detail).toContain("p95 120ms")
  })

  test("reports a slow keydown to paint without failing on it", () => {
    const waited = run(Array(20).fill(10), Array(20).fill(400))
    expect(waited.ok).toBe(true)
    expect(waited.detail).toContain("keydown to paint median 400ms, p95 400ms (not judged)")
  })

  test("counts a key Event Timing left out at its 16ms floor", () => {
    expect(run([]).detail).toContain("median 16ms, p95 16ms")
  })

  test("fails a run where the keys never reached the box", () => {
    const missed = run([], [], 5)
    expect(missed.ok).toBe(false)
    expect(missed.detail).toBe("only 5 of 20 keys reached the box")
  })
})
