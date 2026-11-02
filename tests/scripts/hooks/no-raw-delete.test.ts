import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-raw-delete"

// Every form here is data passed to check(); none runs. Refused rows live in fixtures/refused-forms.ts.
const SESSION = "0a1b2c3d-4e5f-6789-abcd-ef0123456789"
const SCRATCH = `/private/tmp/claude-501/-Users-x-playground/${SESSION}/scratchpad`
const WORKTREE = join(homedir(), "x", ".claude", "worktrees", "y")
const NEVER_MADE = "~/.playground/extensions/.no-such-folder"

const input = (command: string, extra: Record<string, unknown> = {}, cwd = WORKTREE) =>
  JSON.stringify({
    cwd,
    hook_event_name: "PreToolUse",
    session_id: SESSION,
    tool_input: { command },
    tool_name: "Bash",
    ...extra,
  })

describe("a delete the hook lets run", () => {
  test.each([
    "rm notes.txt",
    "rm -f a.log b.log",
    `rm ${WORKTREE}/web/next/.env.local`,
    `rm ${SCRATCH}/probe.ts`,
    `rm -f ${SCRATCH.replace("/private", "")}/out.json`,
    "rm -- -odd-name",
    "rmdir empty",
    "docker rm -fv playground-y-db",
    "git clean -f",
    "git clean -n -d",
    "git clean -ndx",
    `git worktree remove ${WORKTREE}`,
    "chmod -R u+w web",
    "chmod -w notes.txt",
    "echo 'rm -rf x'",
    "grep -n 'rm -rf' scripts/hooks/README.md",
    `git grep -n -E "rm -r[f]?|rm -fr|worktree remove" -- '*.md'`,
    `git commit -m "docs: name rm -rf in words"`,
    "git -c alias.st=status st",
    "sed -i '' 's|rm -rf a|rm -rf b|' notes.txt",
    `bun scripts/roster.ts report ops "shipped; rm incident contained"`,
    `python3 -c "print('rm -rf x')"`,
    "ls -la",
    "rm --help",
  ])("%s", async (command) => {
    expect(await check(input(command))).toBeUndefined()
  })
})

describe("a delete the hook refuses, naming playground rm", () => {
  test.each([
    [`a recursive rm in the session's own scratchpad`, `rm -rf ${SCRATCH}/clone`],
    [`a plain rm in another session's scratchpad`, `rm ${SCRATCH.replace(SESSION, "other")}/x`],
    [`a plain rm through .. out of the worktree`, "rm ../../../../.zshrc"],
    [`a plain rm of the worktree from outside it`, `rm ${WORKTREE}/x`, homedir()],
    [`a plain rm with a word it cannot read`, 'rm "$F"'],
  ])("%s", async (_, command, cwd = WORKTREE) => {
    const reason = await check(input(command, {}, cwd))
    expect(reason).toContain("no-raw-delete hook ")
    expect(reason).toContain("playground rm")
  })

  test("a forced worktree removal is pointed at playground rm --worktree", async () => {
    expect(await check(input(`git worktree remove --force ${WORKTREE}`))).toContain(
      "Remove a worktree with playground rm --worktree <path>",
    )
  })

  test("a word it cannot read is named by its variable", async () => {
    expect(await check(input('rm "$F"'))).toContain("a word the hook cannot read ($F)")
  })

  test("a sub-agent's call, marked by agent_id and agent_type, is refused as the main session's is", async () => {
    const command = `screen -dm sh -c 'rm -rf ${NEVER_MADE}'`
    const main = await check(input(command))
    const sub = await check(input(command, { agent_id: "a1b2c3", agent_type: "general-purpose" }))
    expect(main).toContain("no-raw-delete hook ")
    expect(sub).toBe(main)
  })

  test("an input it cannot parse that reads as a delete is refused", async () => {
    expect(await check(`{"tool_name":"Bash","tool_input":{"command":"rm -rf x"`)).toContain(
      "no-raw-delete hook ",
    )
    expect(await check("not json")).toBeUndefined()
  })
})
