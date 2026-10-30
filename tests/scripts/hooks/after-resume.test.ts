import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check, lastEntry, rearm } from "../../../scripts/hooks/after-resume"

const input = JSON.stringify({
  hook_event_name: "SessionStart",
  session_id: "s-1",
  source: "resume",
})

const now = new Date("2026-10-25T21:58:50Z")

// A resumed transcript as measured on 2.1.309: entries out of time order, untimestamped records after the last turn, a message whose text quotes a timestamp, and a tool result carrying one of its own after now.
const transcript = () => {
  const path = join(mkdtempSync(join(tmpdir(), "after-resume-")), "s-1.jsonl")
  const lines = [
    { timestamp: "2026-10-25T21:42:12.731Z", type: "api-request" },
    { timestamp: "2026-10-25T21:42:12.676Z", type: "user" },
    {
      message: { content: '{"timestamp":"2026-10-25T21:50:00.000Z"}' },
      timestamp: "2026-10-25T21:42:13.300Z",
      type: "assistant",
    },
    { timestamp: "2026-10-25T21:42:13.304Z", type: "system" },
    {
      timestamp: "2026-10-25T21:42:13.100Z",
      toolUseResult: { timestamp: "2026-10-30T00:00:00.000Z" },
      type: "user",
    },
    { type: "last-prompt" },
    { type: "cost-state" },
  ]
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`)
  return path
}

describe("after a restart, a resumed factory session re-arms its watches and re-sends unanswered asks", () => {
  test.each(["dispatcher", "lead", "worker", "reviewer", "tester", "runner", "probe"])(
    "a %s gets the instruction as SessionStart context",
    async (role) => {
      const out = await check(input, { PLAYGROUND_ROLE: role }, now)
      expect(JSON.parse(out ?? "null")).toEqual({
        hookSpecificOutput: {
          additionalContext: rearm(undefined, now),
          hookEventName: "SessionStart",
        },
      })
    },
  )

  test("the 10 minutes end at the transcript's last entry before the restart, however long the session stayed down", async () => {
    const raw = JSON.stringify({ ...JSON.parse(input), transcript_path: transcript() })
    const out = JSON.parse((await check(raw, { PLAYGROUND_ROLE: "worker" }, now)) ?? "null")
    const text: string = out.hookSpecificOutput.additionalContext
    expect(text).toContain("resumed at 2026-10-25T21:58Z")
    expect(text).toContain(
      "10 minutes before 2026-10-25T21:42Z, your last entry before the restart",
    )
  })

  test("the last entry is the newest real timestamp, never one quoted inside a message nor one after now", async () => {
    expect(await lastEntry(transcript(), now)).toEqual(new Date("2026-10-25T21:42:13.304Z"))
  })

  test("with no transcript to read, the 10 minutes end at the resume", async () => {
    expect(await lastEntry(undefined)).toBeUndefined()
    const raw = JSON.stringify({
      ...JSON.parse(input),
      transcript_path: "/nonexistent-dir-for-test/s-1.jsonl",
    })
    const out = JSON.parse((await check(raw, { PLAYGROUND_ROLE: "worker" }, now)) ?? "null")
    expect(out.hookSpecificOutput.additionalContext).toContain(
      "10 minutes before 2026-10-25T21:58Z, the resume",
    )
  })

  test("a session outside the factory, the owner's own, gets nothing", async () => {
    expect(await check(input, {}, now)).toBeUndefined()
  })

  test("input that does not read, or a registry that cannot be read, fails open to nothing", async () => {
    expect(await check("not json", {}, now)).toBeUndefined()
    expect(
      await check(input, { CLAUDE_CONFIG_DIR: "/nonexistent-dir-for-test" }, now),
    ).toBeUndefined()
  })
})
