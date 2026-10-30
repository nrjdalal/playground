import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-ours-merge"

const root = join(import.meta.dir, "..", "..", "..")
const script = join(root, "scripts", "hooks", "no-ours-merge.ts")

const input = (command: string) =>
  JSON.stringify({
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: "Bash",
  })
const bash = (command: string) => check(input(command), {})

describe("a merge or pull with ours is refused", () => {
  test.each([
    ["-s ours", "git merge -s ours origin/canary"],
    ["-sours", "git merge -sours origin/canary"],
    ["--strategy=ours", "git merge --strategy=ours origin/canary"],
    ["--strategy ours", "git merge --strategy ours origin/canary"],
    ["-X ours", "git merge -X ours origin/canary"],
    ["-Xours", "git merge -Xours origin/canary"],
    ["--strategy-option=ours", "git merge --strategy-option=ours origin/canary"],
    ["--strategy-option ours", "git merge --strategy-option ours origin/canary"],
    ["an abbreviated --strategy-option", "git merge --strategy-o=ours origin/canary"],
    ["-s in a cluster of short options", "git merge -qs ours origin/canary"],
    ["-X after another strategy", "git merge -s ort -X ours origin/canary"],
    ["a quoted value", "git merge -s 'ours' origin/canary"],
    ["git pull", "git pull -X ours origin canary"],
    ["git -C <dir>", "git -C /tmp/other merge -s ours origin/canary"],
    ["after cd &&", "cd /tmp && git merge -s ours origin/canary"],
    ["through bash -c", "bash -c 'git merge -X ours origin/canary'"],
    ["through run-slot", "~/.playground/ops/run-slot.sh w -- git merge -s ours origin/canary"],
    ["through env", "env GIT_EDITOR=true git merge -s ours origin/canary"],
    ["a value set before it", "S=ours; git merge -s $S origin/canary"],
    ["an alias for an ours merge", "git -c 'alias.m=merge -s ours' m origin/canary"],
  ])("%s", async (_, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-ours-merge hook refuses")
    expect(reason).toContain("git merge origin/canary")
  })

  test("a strategy it cannot read beside ours is refused", async () => {
    expect(await bash("git merge -s $(echo ours) origin/canary")).toContain("cannot read")
  })
})

describe("every other call runs", () => {
  test.each([
    ["a plain merge", "git merge origin/canary"],
    ["a plain merge with no edit", "git merge --no-edit origin/canary"],
    ["-X theirs", "git merge -X theirs origin/canary"],
    ["another strategy", "git merge -s ort origin/canary"],
    ["ours in the message", "git merge -m 'take ours later' origin/canary"],
    ["ours in an attached message", "git merge -m'ours' origin/canary"],
    ["a branch named ours", "git merge ours"],
    ["ours after --", "git merge -- ours"],
    ["help", "git merge -s ours --help"],
    ["a checkout of ours", "git checkout --ours file.ts"],
    ["echo", "echo git merge -s ours"],
    ["a commit message", "git commit -m 'refuse -s ours merges'"],
  ])("%s", async (_, command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test("a call that is not Bash runs", async () => {
    const raw = JSON.stringify({ tool_input: { file_path: "/x" }, tool_name: "Read" })
    expect(await check(raw, {})).toBeUndefined()
  })
})

describe("the hook as Claude Code runs it", () => {
  const runHook = (command: string, role?: string) =>
    Bun.spawnSync(["bun", "--no-env-file", script], {
      env: { ...process.env, PLAYGROUND_ROLE: role ?? "" },
      stdin: Buffer.from(input(command)),
    })

  test("a factory session is refused with exit 2", () => {
    const proc = runHook("git merge -s ours origin/canary", "worker")
    expect(proc.exitCode).toBe(2)
    expect(proc.stderr.toString()).toContain("no-ours-merge hook refuses")
  })

  test("input it cannot parse that reads as an ours merge is refused", async () => {
    expect(await check("git merge -s ours {", {})).toContain("could not parse")
  })
})
