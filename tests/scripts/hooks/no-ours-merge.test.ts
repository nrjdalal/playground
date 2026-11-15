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
    ["git in capitals", "GIT merge -s ours origin/canary"],
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
    ["git -C with a subcommand for its value", "git -C log merge -s ours origin/canary"],
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

describe("a merge, pull or commit that skips its hooks is refused", () => {
  test.each([
    ["merge --no-verify", "git merge --no-verify origin/canary"],
    ["merge --no-edit --no-verify", "git merge origin/canary --no-edit --no-verify"],
    ["a quoted --no-verify", "git merge '--no-verify' origin/canary"],
    ["--no-verify after --verify", "git merge --verify --no-verify origin/canary"],
    ["git -C <dir>", "git -C /tmp/other merge --no-edit --no-verify origin/canary"],
    ["git -c <key>=<value>", "git -c core.editor=true merge --no-verify origin/canary"],
    ["through bash -c", "bash -c 'git merge --no-verify origin/canary'"],
    ["through run-slot", "~/.playground/ops/run-slot.sh w -- git merge --no-verify origin/canary"],
    ["git pull", "git pull --no-verify origin canary"],
    ["an alias for a merge", "git -c 'alias.m=merge --no-verify' m origin/canary"],
    ["commit --no-verify", "git commit --no-verify -m 'fix: x'"],
    ["commit -n", "git commit -n -m 'fix: x'"],
    ["commit -n finishing a merge", "git commit -n --no-edit"],
    ["commit -n in a cluster", "git commit -nm 'fix: x'"],
    ["commit -n inside a cluster", "git commit -anm 'fix: x'"],
    ["an abbreviated commit --no-verify", "git commit --no-veri -m 'fix: x'"],
    ["commit -n after --verify", "git commit --verify -n -m 'fix: x'"],
    ["an alias for a commit", "git -c 'alias.c=commit --no-verify' c -m 'fix: x'"],
  ])("%s", async (_, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-ours-merge hook refuses")
    expect(reason).toContain("without --no-verify")
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
    ["merge --no-ff", "git merge --no-ff origin/canary"],
    ["a branch named no-verify", "git merge no-verify"],
    ["merge -n, which is --no-stat", "git merge -n origin/canary"],
    ["pull -n, which is --no-stat", "git pull -n origin canary"],
    ["--verify after --no-verify", "git merge --no-verify --verify origin/canary"],
    ["merge --no-verify --help", "git merge --no-verify --help"],
    ["a commit", "git commit -m 'fix: x'"],
    ["--no-verify in a commit message", "git commit -m 'refuse --no-verify'"],
    ["n as a commit's message", "git commit -mn"],
    ["n as a commit's signing key", "git commit -Sn -m 'fix: x'"],
    ["commit --verify after -n", "git commit -n --verify -m 'fix: x'"],
    ["echo of a merge", "echo git merge --no-verify"],
    ["a push", "git push --no-verify origin HEAD:x"],
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

  test("a factory session's merge --no-verify is refused with exit 2", () => {
    const proc = runHook("git merge --no-edit --no-verify origin/canary", "worker")
    expect(proc.exitCode).toBe(2)
    expect(proc.stderr.toString()).toContain("without --no-verify")
  })

  test("input it cannot parse that reads as an ours merge is refused", async () => {
    expect(await check("git merge -s ours {", {})).toContain("could not parse")
  })
})
