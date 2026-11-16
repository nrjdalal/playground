import { describe, expect, test } from "bun:test"

import { check } from "../../../scripts/hooks/no-hidden-program"

const call = (command: string) =>
  JSON.stringify({
    cwd: "/tmp",
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: "Bash",
  })

describe("a program name that is not one plain name is refused, naming the fix", () => {
  test("a program held in a variable the line sets names the literal to write", async () => {
    expect(await check(call("H=~/.local/bin/x; $H list"), {})).toContain(
      "Here, write `~/.local/bin/x` in place of `$H`.",
    )
  })

  test("a glob names no rewrite, since no one literal stands for it", async () => {
    const reason = await check(call("g?t status"), {})
    expect(reason).toContain("`g?t` is a pattern")
    expect(reason).not.toContain("Here, write")
  })

  test("a call it cannot parse is refused", async () => {
    expect(await check("{", {})).toContain("no-hidden-program hook could not read this call")
  })

  test("another tool's call passes", async () => {
    expect(
      await check(JSON.stringify({ tool_input: { file_path: "/tmp/x" }, tool_name: "Read" }), {}),
    ).toBeUndefined()
  })
})
