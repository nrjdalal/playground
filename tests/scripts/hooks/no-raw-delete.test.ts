import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-raw-delete"
import { NEVER_MADE } from "./fixtures/refused-forms"

// Every form here is data passed to check(); none runs. Refused rows live in fixtures/refused-forms/, one file a source.
const SESSION = "0a1b2c3d-4e5f-6789-abcd-ef0123456789"
const SCRATCH = `/private/tmp/claude-501/-Users-x-playground/${SESSION}/scratchpad`
const WORKTREE = join(homedir(), "x", ".claude", "worktrees", "y")

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
    'docker rm -fv "$CID"',
    "bun rm left-pad",
    "git rm --cached notes.txt",
    "rm *.log",
    "git clean --dry-run -dx",
    "rsync -a src/ dst/",
    "~/.playground/ops/run-slot.sh me -- rm notes.txt",
    "~/.playground/ops/run-slot.sh me -- bun run test",
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
    "while gh pr checks 1 >/dev/null 2>&1; [ $? -eq 8 ]; do sleep 120; done",
    '[ -n "$R" ] && [ -f $R/x ] && echo ok',
    "$T git clone -q $S/mirror.git $S/home",
    "$R/scripts/spawn.sh column reviewer $W --pr 1",
    "gh pr checks $N -R owner/repo",
    "'/bin/r?' -rf sub",
    'rmdir "${S:?}/${m:?}"',
    "mv web/next/.next .turbo /tmp/claude-501/p/s/scratchpad/cold-1/",
    "playground rm sub/old",
    "playground rm --worktree .claude/worktrees/old",
    "fd . src --exec=echo",
    "rsync -a --delay-updates src/ dst/",
    "npx -y @scope/tool@1 build",
    "shred notes.txt",
    "tar -czf out.tgz src",
    "fd -tx . bin",
    "fd -Hx echo",
    "fd -te -x echo",
    "at -l",
    "echo 'ls' | at now",
    'c="ls -la"; $c',
    'c="rm -rf x"; "$c"',
    "git diff | delta",
    "redis-cli del lock",
    "docker exec playground-x-redis redis-cli del k",
    "bun run del",
    "bun add -d del-cli",
    "sudo -s <<< 'ls'",
    "su <<< 'echo hi'",
    "sudo su <<'EOF'\nls -la\nEOF",
    'sudo -s <<< "ls $NO_SUCH_VAR_1146"',
    'su <<< "echo $(curl -s example.com)"',
    'sudo -s < "$NO_SUCH_VAR_1146"',
    "{ bash; } <<< 'ls -la'",
    "bash 3<<< 'ls' <&3",
    'bash <<< "$(echo ls)"',
    'S=ls; bash <<< "$S"',
    "pkexec <<< 'ls'",
    "echo ls | pkexec su",
    "{ echo ls | bash; } <<< 'rm -rf x'",
  ])("%s", async (command) => {
    expect(await check(input(command))).toBeUndefined()
  })
})

describe("a delete the hook refuses, naming playground rm", () => {
  test.each<[string, string, string]>([
    [`a recursive rm in the session's own scratchpad`, `rm -rf ${SCRATCH}/clone`, WORKTREE],
    [
      `a plain rm in another session's scratchpad`,
      `rm ${SCRATCH.replace(SESSION, "other")}/x`,
      WORKTREE,
    ],
    [`a plain rm through .. out of the worktree`, "rm ../../../../.zshrc", WORKTREE],
    [`a plain rm of the worktree from outside it`, `rm ${WORKTREE}/x`, homedir()],
    [`a plain rm with a word it cannot read`, 'rm "$F"', WORKTREE],
  ])("%s", async (_, command, cwd) => {
    const reason = await check(input(command, {}, cwd))
    expect(reason).toContain("no-raw-delete hook ")
    expect(reason).toContain("playground rm")
  })

  test("a forced worktree removal is pointed at playground rm --worktree", async () => {
    expect(await check(input(`git worktree remove --force ${WORKTREE}`))).toContain(
      "Remove a worktree with playground rm --worktree <path>",
    )
  })

  test("a tree over the trash's limit is pointed at the cleanup and a reinstall", async () => {
    const reason = await check(input("rm -rf node_modules"))
    expect(reason).toContain("leave a bigger tree or a scratch folder in place")
    expect(reason).toContain("bun install rebuild a node_modules in place")
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

describe("agent-browser eval's script is JavaScript, never a shell command line (PG-1695)", () => {
  const INBOX = `agent-browser eval 'document.querySelector("section[aria-busy][aria-label=Inbox]")?.outerHTML.slice(0,1500) ?? "no busy inbox"'`

  test("the cause: a spaced word read as a shell line holds a glob program word and a ?? that may expand to -r", async () => {
    expect(await check(input("a?.b ?? 1"))).toContain(
      "a program the hook cannot read (a?.b) given -r",
    )
    expect(await check(input("some-tool 'a?.b ?? 1'"))).toContain(
      "a program the hook cannot read (a?.b) given -r",
    )
  })

  test.each([
    "agent-browser eval 'a?.b ?? 1'",
    `agent-browser eval 'f("x")?.outerHTML ?? "none"'`,
    INBOX,
    "agent-browser open http://x.localhost && agent-browser eval 'a?.b ?? 1'",
  ])("%s runs", async (command) => {
    expect(await check(input(command))).toBeUndefined()
  })

  test.each([
    "$RM -r x",
    "r? -rf x",
    "agent-browser eval 'a?.b ?? 1' && r? -rf x",
    `agent-browser eval "$(rm -rf ${NEVER_MADE})"`,
    `agent-browser rm -rf ${NEVER_MADE}`,
  ])("%s is still refused", async (command) => {
    expect(await check(input(command))).toContain("no-raw-delete hook ")
  })
})
