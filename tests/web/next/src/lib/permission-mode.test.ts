import { describe, expect, test } from "bun:test"

import { MODE_LABELS, modePicker, shownMode } from "../../../../../web/next/src/lib/permission-mode"

// Worker's type comes through the lib, as dashboard.test.ts takes it: the API's workers module resolves its own @/ paths, which the web's config cannot.
type Worker = Parameters<typeof modePicker>[0]

const worker = (overrides: Partial<Worker> = {}): Worker => ({
  cwd: "/tmp",
  effort: null,
  eta: null,
  failed: false,
  feed: [],
  lastActiveAt: null,
  lifecycle: "idle",
  light: "idle",
  model: null,
  name: "probe-sdk",
  questions: [],
  role: "other",
  sessionId: "s-sdk",
  startedAt: null,
  task: null,
  tasks: [],
  title: null,
  updatedAt: null,
  workspace: null,
  ...overrides,
})

const hosted = worker({ hosted: true, permissionMode: "plan" })

describe("modePicker", () => {
  test("only a session the dashboard hosts has one, read-only while approvals are off", () => {
    expect(modePicker(worker(), true)).toBeNull()
    expect(modePicker(worker({ name: "dispatcher", role: "dispatcher" }), true)).toBeNull()
    expect(modePicker(hosted, true)).toEqual({ mode: "plan", readOnly: false })
    expect(modePicker(hosted, false)).toEqual({ mode: "plan", readOnly: true })
  })

  test("it offers the four modes in Shift+Tab's order", () => {
    expect(Object.keys(MODE_LABELS)).toEqual([
      "default",
      "acceptEdits",
      "plan",
      "bypassPermissions",
    ])
  })
})

describe("shownMode", () => {
  test("with no pick it shows the row's mode", () => {
    expect(shownMode(null, "default")).toBe("default")
  })

  test("a pick shows while the row still reports the mode it was picked over, after the request has answered too", () => {
    expect(shownMode({ from: "default", to: "plan" }, "default")).toBe("plan")
  })

  test("once the row moves, the row wins: the pick landing, or a change the session made itself", () => {
    expect(shownMode({ from: "default", to: "plan" }, "plan")).toBe("plan")
    expect(shownMode({ from: "default", to: "plan" }, "acceptEdits")).toBe("acceptEdits")
  })
})
