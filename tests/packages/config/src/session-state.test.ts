import { describe, expect, test } from "bun:test"

import {
  parseSessionState,
  type SessionState,
  sessionStateDir,
  stateNow,
} from "../../../../packages/config/src/session-state"

const at = "2026-10-18T00:43:03.784Z"
const record = (state: SessionState["state"]): SessionState => ({
  at,
  event: "PermissionRequest",
  sessionId: "s-1",
  state,
})

describe("a session-state file", () => {
  test("reads back as its record", () => {
    expect(parseSessionState(JSON.stringify(record("stuck")))).toEqual(record("stuck"))
  })

  test("reads as nothing when it is not JSON, names no session, or holds an unknown state", () => {
    expect(parseSessionState("{")).toBeNull()
    expect(parseSessionState(JSON.stringify({ ...record("idle"), sessionId: "" }))).toBeNull()
    expect(parseSessionState(JSON.stringify({ ...record("idle"), state: "busy" }))).toBeNull()
  })

  test("lives under session-state in the data folder", () => {
    expect(sessionStateDir("/d/")).toBe("/d/session-state")
  })
})

describe("what a record still says", () => {
  test.each(["stuck", "usage-limit", "failed"] as const)(
    "%s stands until the transcript holds a turn after it",
    (state) => {
      expect(stateNow(record(state), null)).toBe(state)
      expect(stateNow(record(state), "2026-10-18T00:43:03.674Z")).toBe(state)
      // An Escape on the prompt fires no hook; the transcript's interrupt line is the only sign
      expect(stateNow(record(state), "2026-10-18T00:45:34.108Z")).toBeNull()
    },
  )

  test.each(["working", "idle"] as const)("%s stands until the next hook", (state) => {
    expect(stateNow(record(state), "2026-10-18T00:45:34.108Z")).toBe(state)
  })
})
