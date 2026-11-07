import { describe, expect, test } from "bun:test"

import {
  sessionsKeyOf,
  sessionsOf,
} from "../../../../../../web/next/src/components/dashboard/dashboard"

type Worker = NonNullable<Parameters<typeof sessionsOf>[0]>[number]
const worker = (name: string, sessionId: string, rest: Partial<Worker> = {}): Worker =>
  ({
    effort: null,
    lifecycle: "working",
    model: null,
    role: "worker",
    ...rest,
    name,
    sessionId,
  }) as Worker

const board = [worker("dispatcher", "s-1", { role: "dispatcher" }), worker("pg-1244-worker", "s-2")]

describe("sessionsOf", () => {
  test("an @Name reaches its session's view by its raw name or its label, in any case", () => {
    const { mentions } = sessionsOf(board, "dispatcher")
    expect(mentions?.("pg-1244-worker")).toBe("/dashboard?worker=s-2")
    expect(mentions?.("PG-1244-Worker")).toBe("/dashboard?worker=s-2")
    expect(mentions?.("Dispatcher")).toBe("/dashboard?worker=s-1")
    expect(mentions?.("nobody")).toBeNull()
  })

  test("before the socket's first board there are no sessions and no mentions", () => {
    expect(sessionsOf(null, null)).toEqual({ dispatcher: null, mentions: null, sessions: null })
  })

  test("keeps of each session what a name link reads, and nothing that moves with its work", () => {
    const { sessions } = sessionsOf(
      [worker("builder", "s-3", { effort: "high", model: "opus" })],
      null,
    )
    expect(sessions).toEqual([
      { effort: "high", model: "opus", name: "builder", role: "worker", sessionId: "s-3" },
    ])
  })
})

describe("sessionsKeyOf", () => {
  test("holds while the same sessions are live under the same names, roles and models, in any order or state", () => {
    const key = sessionsKeyOf(board, "dispatcher")
    expect(sessionsKeyOf([...board].reverse(), "dispatcher")).toBe(key)
    expect(
      sessionsKeyOf(
        board.map((w) => ({ ...w, lifecycle: "idle" })),
        "dispatcher",
      ),
    ).toBe(key)
  })

  test("changes when a session starts, ends, is renamed, changes role or model, or the dispatcher's name lands", () => {
    const key = sessionsKeyOf(board, "dispatcher")
    expect(sessionsKeyOf(board, null)).not.toBe(key)
    expect(sessionsKeyOf(board.slice(1), "dispatcher")).not.toBe(key)
    expect(sessionsKeyOf([...board, worker("probe", "s-9")], "dispatcher")).not.toBe(key)
    expect(sessionsKeyOf([board[0]!, worker("renamed", "s-2")], "dispatcher")).not.toBe(key)
    expect(
      sessionsKeyOf([board[0]!, worker("pg-1244-worker", "s-2", { model: "opus" })], "dispatcher"),
    ).not.toBe(key)
    expect(sessionsKeyOf(null, "dispatcher")).toBe("")
  })
})
