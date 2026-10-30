import { describe, expect, test } from "bun:test"

import { check, REREAD } from "../../../scripts/hooks/after-compact"

const input = JSON.stringify({
  hook_event_name: "SessionStart",
  session_id: "s-1",
  source: "compact",
})

describe("after a compaction, a factory session gets what to reread", () => {
  test.each(["dispatcher", "lead", "worker", "reviewer", "tester", "runner", "probe"])(
    "a %s gets the instruction as SessionStart context",
    async (role) => {
      const out = await check(input, { PLAYGROUND_ROLE: role })
      expect(JSON.parse(out ?? "null")).toEqual({
        hookSpecificOutput: { additionalContext: REREAD, hookEventName: "SessionStart" },
      })
    },
  )

  test("the instruction names everything the context rule rereads", () => {
    expect(REREAD).toContain("playbook skill again with the Skill tool")
    expect(REREAD).toContain("roster entry")
    expect(REREAD).toContain("Inbox")
    expect(REREAD).toContain("PRs")
    expect(REREAD).toContain(".agents/decisions.md")
  })

  test("a session outside the factory, Merritt's own, gets nothing", async () => {
    expect(await check(input, {})).toBeUndefined()
  })

  test("input that does not read, or a registry that cannot be read, fails open to nothing", async () => {
    expect(await check("not json", {})).toBeUndefined()
    expect(await check(input, { CLAUDE_CONFIG_DIR: "/nonexistent-dir-for-test" })).toBeUndefined()
  })
})
