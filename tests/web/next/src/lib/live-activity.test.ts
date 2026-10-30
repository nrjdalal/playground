import { describe, expect, test } from "bun:test"

import type { ActivityFrame as ApiActivityFrame } from "../../../../../api/hono/src/lib/dashboard/activity"
import type { Entry } from "../../../../../api/hono/src/lib/dashboard/transcript"
import { toUIMessages } from "../../../../../web/next/src/lib/chat"
import {
  createWatch,
  elapsedLabel,
  stepOf,
  stepSummary,
  tokensLabel,
  type ActivityFrame,
} from "../../../../../web/next/src/lib/live-activity"

const step = (fields: Partial<Entry> & Pick<Entry, "id" | "kind">): Entry => ({
  at: "2026-10-07T10:00:00.000Z",
  from: null,
  text: "",
  tool: null,
  ...fields,
})

const call = (id: string, tool: string, input: Record<string, unknown>, text: string): Entry =>
  step({ id, input: JSON.stringify(input, null, 2), kind: "tool", text, tool, toolUseId: id })

const summaryOf = (entry: Entry): string => {
  const part = toUIMessages([entry])[0]?.parts[0]
  if (part?.type !== "dynamic-tool") throw new Error("not a tool part")
  return stepSummary(part as Parameters<typeof stepSummary>[0])
}

describe("stepSummary", () => {
  test("a Read names the file by its folder and name", () => {
    const read = call(
      "r",
      "Read",
      { file_path: "/Users/me/dispatcher/web/next/src/components/dashboard/app-sidebar.tsx" },
      "/Users/me/dispatcher/web/next/src/components/dashboard/app-sidebar.tsx",
    )
    expect(summaryOf(read)).toBe("Reading dashboard/app-sidebar.tsx")
  })

  test("an Edit names the file it edits", () => {
    const edit = call("e", "Edit", { file_path: "/repo/web/next/src/lib/outbox.ts" }, "x")
    expect(summaryOf(edit)).toBe("Editing lib/outbox.ts")
  })

  test("a Bash names its command's first words, not its description", () => {
    const bash = call(
      "b",
      "Bash",
      { command: "bun run test --filter web\necho done", description: "Run the tests" },
      "Run the tests",
    )
    expect(summaryOf(bash)).toBe("Running bun run test --filter")
  })

  test("a SendMessage names its recipient by label, without its ref", () => {
    const send = call(
      "s",
      "SendMessage",
      { message: "plan", to: "builder [3fa9c1]" },
      "to builder [3fa9c1]: plan",
    )
    expect(summaryOf(send)).toBe("Messaging Builder")
  })

  test("an unknown tool reads as its label and its summary", () => {
    const mcp = call("m", "mcp__linear__get_issue", { id: "CEDAR-1" }, "")
    expect(summaryOf(mcp)).toBe("linear · get_issue")
    const other = call("o", "Frobnicate", { query: "x" }, "the widgets")
    expect(summaryOf(other)).toBe("Frobnicate the widgets")
  })

  test("a clipped input that does not parse falls back to the summary", () => {
    const bash = step({
      id: "c",
      input: '{\n  "command": "bun run',
      kind: "tool",
      text: "bun run dev --filter api",
      tool: "Bash",
      toolUseId: "c",
    })
    expect(summaryOf(bash)).toBe("Running bun run dev --filter")
  })

  test("a long target is clipped to one short line", () => {
    const grep = call("g", "Grep", { pattern: "x".repeat(200) }, "x".repeat(200))
    const summary = summaryOf(grep)
    expect(summary.startsWith("Searching ")).toBe(true)
    expect(summary.length).toBeLessThanOrEqual(60)
    expect(summary.endsWith("…")).toBe(true)
  })
})

describe("stepOf", () => {
  const read = call("r", "Read", { file_path: "/a/b/c.ts" }, "/a/b/c.ts")
  const bash = call("b", "Bash", { command: "bun run test" }, "bun run test")
  const done = (id: string) => step({ id: `${id}-done`, kind: "result", text: "ok", toolUseId: id })

  test("the newest call in the current turn that has no result yet", () => {
    expect(stepOf(toUIMessages([read, bash]))).toBe("Running bun run test")
    expect(stepOf(toUIMessages([read, bash, done("b")]))).toBe("Reading b/c.ts")
  })

  test("nothing once every call has its result", () => {
    expect(stepOf(toUIMessages([read, done("r")]))).toBeNull()
  })

  test("nothing from a turn a newer message closed", () => {
    const human = step({ id: "h", kind: "human", text: "stop" })
    expect(stepOf(toUIMessages([bash, human]))).toBeNull()
    expect(stepOf([])).toBeNull()
  })
})

describe("labels", () => {
  test("elapsed reads as Claude Code writes it", () => {
    expect(elapsedLabel(4)).toBe("4s")
    expect(elapsedLabel(71)).toBe("1m 11s")
    expect(elapsedLabel(3720)).toBe("1h 2m")
  })

  test("tokens read in thousands past a thousand", () => {
    expect(tokensLabel(950)).toBe("950 tokens")
    expect(tokensLabel(2100)).toBe("2.1k tokens")
    expect(tokensLabel(1)).toBe("1 token")
    expect(tokensLabel(1_500_000)).toBe("1.5m tokens")
    expect(tokensLabel(999_949)).toBe("999.9k tokens")
    expect(tokensLabel(999_950)).toBe("1m tokens")
  })
})

describe("createWatch", () => {
  const sent = () => {
    const out: unknown[] = []
    return { out, send: (data: string) => void out.push(JSON.parse(data)) }
  }

  test("opening a chat sends its watch once connected, and once only", () => {
    const watch = createWatch()
    const socket = sent()
    watch.set("s-1")
    expect(socket.out).toEqual([])
    watch.connected(socket.send)
    watch.set("s-1")
    expect(socket.out).toEqual([{ sessionId: "s-1", type: "watch" }])
  })

  test("switching sends the new chat, and closing sends null", () => {
    const watch = createWatch()
    const socket = sent()
    watch.connected(socket.send)
    watch.set("s-1")
    watch.set("s-2")
    watch.set(null)
    expect(socket.out).toEqual([
      { sessionId: "s-1", type: "watch" },
      { sessionId: "s-2", type: "watch" },
      { sessionId: null, type: "watch" },
    ])
  })

  test("a reconnect sends the open chat again, and nothing while none is open", () => {
    const watch = createWatch()
    const first = sent()
    watch.connected(first.send)
    watch.set("s-1")
    watch.disconnected(first.send)
    watch.set("s-2")
    const second = sent()
    watch.connected(second.send)
    expect(first.out).toEqual([{ sessionId: "s-1", type: "watch" }])
    expect(second.out).toEqual([{ sessionId: "s-2", type: "watch" }])
    watch.set(null)
    watch.disconnected(second.send)
    const third = sent()
    watch.connected(third.send)
    expect(third.out).toEqual([])
  })

  test("an older socket closing after the new one connected leaves the new one watching", () => {
    const watch = createWatch()
    const old = sent()
    const fresh = sent()
    watch.connected(old.send)
    watch.connected(fresh.send)
    watch.disconnected(old.send)
    watch.set("s-1")
    expect(old.out).toEqual([])
    expect(fresh.out).toEqual([{ sessionId: "s-1", type: "watch" }])
  })
})

// The web reads the API's activity frame by its own copy of the type, so a change on either side fails check-types here.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const sameFrame: Same<ActivityFrame, ApiActivityFrame> = true
void sameFrame
