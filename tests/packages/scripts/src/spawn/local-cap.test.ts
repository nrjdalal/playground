import { describe, expect, test } from "bun:test"

import type { ModelServer } from "../../../../../packages/scripts/src/local-model/state"
import { capOf, LOCAL_SESSION_CAP } from "../../../../../packages/scripts/src/spawn/local-cap"

// One machine's servers as the model switch writes them (local-model/state.ts), by model folder.
const K: ModelServer = {
  busyAt: "2026-11-17T06:00:00Z",
  container: "local-vllm-k",
  maxSessions: 4,
  port: 8000,
  share: 0.7,
  startedAt: "2026-11-17T06:00:00Z",
}

describe("capOf, the local sessions a machine's model server takes at once", () => {
  test("reads maxSessions of the server on the port", () => {
    expect(capOf({ k: K }, 8000)).toEqual({ cap: 4, from: "models/state.json" })
  })

  test("picks the server by its port among two side by side", () => {
    const m = { ...K, maxSessions: 1, port: 8001 }
    expect(capOf({ k: K, m }, 8001).cap).toBe(1)
  })

  test.each([
    ["no servers", {}],
    ["no server on the port", { k: { ...K, port: 9000 } }],
    ["a cap that is not a whole number over 0", { k: { ...K, maxSessions: 0 } }],
    ["a cap held as text", { k: { ...K, maxSessions: "4" as unknown as number } }],
  ])("%s falls back to K's limit of 6", (_, servers) => {
    expect(capOf(servers, 8000)).toEqual({
      cap: LOCAL_SESSION_CAP,
      from: "K's limit, as models/state.json sizes no server on 8000 here",
    })
    expect(LOCAL_SESSION_CAP).toBe(6)
  })
})
