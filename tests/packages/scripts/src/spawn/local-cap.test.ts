import { describe, expect, test } from "bun:test"

import { capOf, LOCAL_SESSION_CAP } from "../../../../../packages/scripts/src/spawn/local-cap"

// The model switch's state as it writes it: each machine's servers by model folder (the keys local-model/state.ts writes).
const state = (servers: Record<string, object>) => ({ machines: { "spark-x": { servers } } })
const K = {
  busyAt: null,
  container: "local-vllm",
  maxSessions: 4,
  port: 8000,
  share: 1,
  startedAt: "2026-11-17T06:00:00Z",
}

describe("capOf, the local sessions a machine's model server takes at once", () => {
  test("reads maxSessions of the server on the port, on this machine", () => {
    expect(capOf(state({ k: K }), "spark-x", 8000)).toEqual({ cap: 4, from: "models/state.json" })
  })

  test("picks the server by its port among two side by side", () => {
    const m = { ...K, maxSessions: 1, port: 8001 }
    expect(capOf(state({ k: K, m }), "spark-x", 8001).cap).toBe(1)
  })

  test.each([
    ["no state", {}],
    ["another machine", state({ k: K })],
    ["no server on the port", state({ k: { ...K, port: 9000 } })],
    ["a cap that is not a whole number over 0", state({ k: { ...K, maxSessions: 0 } })],
    ["a cap held as text", state({ k: { ...K, maxSessions: "4" } })],
  ])("%s falls back to K's limit of 6", (_, given) => {
    const machine = _ === "another machine" ? "spark-y" : "spark-x"
    expect(capOf(given, machine, 8000).cap).toBe(LOCAL_SESSION_CAP)
    expect(LOCAL_SESSION_CAP).toBe(6)
  })
})
