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
    ["--help as a message", "git merge -s ours -m --help origin/canary"],
    ["after pull's bare -j", "git pull -j -s ours origin canary"],
    ["an alias for a plain merge with ours after it", "git -c alias.m=merge m -s ours x"],
    ["a shell alias for an ours merge", "git -c 'alias.m=!git merge -s ours' m origin/canary"],
    ["in a brace list", "git merge {-s,ours,origin/canary}"],
    ["in a brace sequence", "git merge -s our{s..s} x"],
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
    ["--help as a commit's message", "git commit -n -m 'fix: x' -m --help"],
    ["--help as a merge's message", "git merge --no-verify -m --help origin/canary"],
    ["--help as --into-name's value", "git merge --no-verify --into-name --help origin/canary"],
    ["--help after --", "git commit -n -- --help"],
    ["after pull's bare -j", "git pull -j --no-verify origin canary"],
    ["after pull's -j in a cluster", "git pull -qj --no-verify origin canary"],
    ["an unread subcommand", "git $(echo commit) --no-verify -m x"],
    ["an unread variable subcommand", "git $X --no-verify"],
    ["an alias holding -n", "git -c 'alias.ci=commit -n' ci -m x"],
    ["an alias holding -n in a cluster", "git -c 'alias.ci=commit -nm' ci x"],
    ["an alias holding an abbreviation", "git -c 'alias.ci=commit --no-veri' ci -m x"],
    [
      "an alias for a plain commit with the flag after it",
      "git -c alias.c=commit c --no-verify -m x",
    ],
    ["a shell alias for a commit with -n", "git -c 'alias.c=!git commit -n' c -m x"],
    ["an alias of an alias", "git -c alias.a=b -c 'alias.b=commit -n' a -m x"],
    ["-n in a brace list", "git commit {-n,-mx}"],
    ["--no-verify in a brace list", "git commit {--no-verify,-mx}"],
    ["--no-verify in a merge's brace list", "git merge {--no-verify,origin/canary}"],
    ["an alias whose text holds a ;", "git -c 'alias.c=commit -m x; -n' c"],
    ["an alias whose text holds a #", "git -c 'alias.c=commit -m x #' c -n"],
    ["an alias whose text holds a &&", "git -c 'alias.c=commit -m x &&' c -n"],
    ["an alias whose text holds a >", `git -c 'alias.c=commit -m "x" >' c -n`],
    ["a brace sequence in an abbreviation", "git commit --no-ver{i..i} -m x"],
    ["a brace sequence in a merge's --no-verify", "git merge --no-verif{y..y} origin/canary"],
    ["a brace sequence after a message", "git commit -m x --no-verif{y..y}"],
    ["a brace sequence as -m's value", "git commit -m -{m..n}"],
    ["a brace sequence as --message's value", "git commit --message -{m..n}"],
    ["a brace sequence as a merge's -m value", "git merge -m -{m..n} origin/canary"],
    [
      "an alias chain past the depth the hook follows",
      "git -c alias.a1=a2 -c alias.a2=a3 -c alias.a3=a4 -c alias.a4=a5 -c alias.a5=a6 -c alias.a6=a7 -c alias.a7=a8 -c alias.a8=a9 -c alias.a9=commit a1 -n -m x",
    ],
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
    ["commit -n --help", "git commit -n --help"],
    ["an alias for a plain commit", "git -c alias.c=commit c -m 'fix: x'"],
    [
      "an alias named for a git command, which git runs as the command",
      "git -c 'alias.commit=commit -n' commit -m x",
    ],
    ["an alias for a plain merge", "git -c alias.m=merge m --no-ff origin/canary"],
    ["a brace list of branches", "git merge {origin/canary,origin/main}"],
    ["an alias with a quoted message", `git -c 'alias.c=commit -m "fix: x"' c`],
    ["a brace in a commit message", "git commit -m 'fix: x {a..b} y'"],
    ["a brace in a double-quoted commit message", `git commit -m "fix: x {a,b} y"`],
    [
      "an alias chain inside the depth the hook follows",
      "git -c alias.a1=a2 -c alias.a2=a3 -c alias.a3=a4 -c alias.a4=a5 -c alias.a5=a6 -c alias.a6=a7 -c alias.a7=commit a1 -m x",
    ],
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

  test.each([
    ["-n in a cluster", "git commit -nm x {"],
    ["an abbreviation", "git commit --no-veri -m x {"],
  ])("input it cannot parse that reads as a commit with %s is refused", async (_, raw) => {
    expect(await check(raw, {})).toContain("could not parse")
  })

  test("input it cannot parse that reads as an ours merge is refused", async () => {
    expect(await check("git merge -s ours {", {})).toContain("could not parse")
  })
})
