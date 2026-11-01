import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check, mainCheckout } from "../../../scripts/hooks/no-main-checkout"

const root = join(import.meta.dir, "..", "..", "..")
const script = join(root, "scripts", "hooks", "no-main-checkout.ts")
// real directories, since the reader follows a cd only into one that exists
const MAIN = mkdtempSync(join(tmpdir(), "no-main-checkout-main-"))
const WORKTREE = `${MAIN}/.claude/worktrees/a`
mkdirSync(join(WORKTREE, "api", "hono"), { recursive: true })
afterAll(() => rmSync(MAIN, { force: true, recursive: true }))
// the settings the main checkout's packages build needs, as the release skill's step 5 types them
const OFF = "env NODE_ENV=production SKIP_ENV_VALIDATION=true"

const bash = (command: string, cwd = MAIN) =>
  check(
    JSON.stringify({
      cwd,
      hook_event_name: "PreToolUse",
      tool_input: { command },
      tool_name: "Bash",
    }),
    { HOME: "/u" },
    MAIN,
  )

describe("a build, a test run, lefthook, turbo or a file write in the main checkout is refused, with the fix", () => {
  test.each([
    ["the reviewer's pre-commit run", "lefthook run pre-commit"],
    ["lefthook through bunx", "bunx lefthook run pre-commit"],
    ["lefthook by its path", "node_modules/.bin/lefthook run pre-commit"],
    ["a commit, which runs pre-commit", "git commit -m 'chore: x'"],
    ["bun run build", "bun run build"],
    ["bun run test", "bun run test"],
    ["bun run check-types", "bun run check-types"],
    ["bun test", "bun test tests/scripts/hooks"],
    ["bun run test:file", "bun run test:file tests/scripts/hooks"],
    ["bun run test:file naming no file", "bun run test:file"],
    ["bun run test:file past --cwd", "bun run --cwd . test:file tests/a.test.ts"],
    ["turbo", "turbo run build"],
    ["turbo through bun x", "bun x turbo run build"],
    ["turbo past the packages", "turbo run build --filter=@web/next"],
    [
      "the packages build with another filter",
      "turbo run build --filter=./packages/* --filter=@web/next",
    ],
    ["the packages build forced", "turbo run build --filter=./packages/* --force"],
    ["the packages' dev", "turbo run dev --filter=./packages/*"],
    ["the packages' type check", "turbo run check-types --filter=./packages/*"],
    ["another build through bunx", "bunx turbo run build"],
    ["another build through npx", "npx turbo run build --filter=@web/next"],
    [
      "the packages build then a test run",
      `${OFF} turbo run build --filter=./packages/* && bun run test`,
    ],
    ["a redirect", "echo hi > notes.txt"],
    ["an appending redirect", "date >> log.txt"],
    ["a curl cookie jar", "curl -sS -c cookies.txt -X POST https://api.example"],
    ["a curl output file", "curl -o out.json https://example.com"],
    ["a curl output file, attached", "curl --output=out.json https://example.com"],
    ["cp into it", "cp /tmp/a b.txt"],
    ["mv into it", "mv /tmp/a b.txt"],
    ["touch", "touch stray"],
    ["tee", "echo hi | tee stray"],
    ["sed -i, BSD's, as #299's stray edit ran", "sed -i '' 's/a/b/' scripts/ops/run-slot.sh"],
    ["sed -i, GNU's", "sed -i 's/a/b/' notes.txt"],
    ["sed -i with a suffix", "sed -i.bak 's/a/b/' notes.txt"],
    ["sed --in-place past -e", "sed --in-place -e 's/a/b/' notes.txt"],
    ["sed with -i among its flags", "sed -Ei 's/a/b/' notes.txt"],
    ["perl -pi -e", "perl -pi -e 's/a/b/' notes.txt"],
    ["perl -i past its other flags", "perl -0777 -i -pe 's/a/b/' notes.txt"],
    ["sed -i past a flag group ending in E", "sed -nE -i 's/a/b/' notes.txt"],
    ["sed -i with its script attached to -e, quoted", "sed -i -e's/a/b/' notes.txt"],
    ["sed -i with its script attached to -e", "sed -i -es/a/b/ notes.txt"],
    ["sed --in-place with --expression=", "sed --in-place --expression=s/a/b/ notes.txt"],
    ["sed --in-place with --file=", "sed --in-place --file=edit.sed notes.txt"],
    ["perl -i after -0 in one flag group", "perl -0pi -e 's/a/b/' notes.txt"],
    ["perl -i after -0's digits in one flag group", "perl -0777pi -e 's/a/b/' notes.txt"],
    ["BSD sed -I with a suffix word", "sed -I .bak 's/a/b/' notes.txt"],
    ["BSD sed -I with an empty suffix", "sed -I '' 's/a/b/' notes.txt"],
    ["git add, which moves the index", "git add -A"],
    [
      "a commit through run-slot, as #299's ran",
      "~/.playground/ops/run-slot.sh w -- env NODE_ENV=production SKIP_ENV_VALIDATION=true git commit -q -F /tmp/m.txt",
    ],
    ["a build through run-slot", "~/.playground/ops/run-slot.sh w -- bun run build"],
    ["a write through run-slot", "~/.playground/ops/run-slot.sh w -- sed -i 's/a/b/' notes.txt"],
    ["inside a shell it starts", "bash -c 'lefthook run pre-commit'"],
    [
      "lefthook started by bun, as lefthook.yml spells it",
      "bun node_modules/.bin/lefthook run pre-commit",
    ],
    ["lefthook as a bun script", "bun run lefthook run pre-commit"],
    ["turbo as a bun script", "bun run turbo run build"],
    ["a script past bun's --filter", "bun run --filter @packages/env build"],
    [
      "a --cwd after the script, which bun hands the script",
      "bun run build --cwd .claude/worktrees/a",
    ],
    ["a --cwd after --, which bun hands the script", "bun run test -- --cwd .claude/worktrees/a"],
    ["check-types by its bare name", "bun check-types"],
    ["a bare build under --filter, which is the script", "bun --filter '*' build"],
    ["a bare build under --filter=", "bun --filter='*' build"],
    ["a bare build under -F", "bun -F @packages/env build"],
    ["after other commands", "git status && bun run build"],
    ["turbo through bunx past an option", "bunx --bun turbo run build"],
    [
      "bun's --cwd before x, which bun x ignores",
      "bun --cwd=.claude/worktrees/a x turbo run build",
    ],
    ["bun's --cwd after x, which bun x ignores", "bun x --cwd=.claude/worktrees/a turbo run build"],
    ["bunx's --cwd, which it ignores", "bunx --cwd=.claude/worktrees/a turbo run build"],
    [
      "lefthook through bunx past its ignored --cwd",
      "bunx --cwd=.claude/worktrees/a lefthook run pre-commit",
    ],
  ])("%s", async (_name, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-main-checkout hook refuses")
    expect(reason).toContain(".claude/worktrees/")
  })

  test.each([
    ["the packages build with no settings", "turbo run build --filter='./packages/*'"],
    ["the packages build through bunx", "bunx turbo run build --filter='./packages/*'"],
    [
      "the packages build as the release skill types it, its settings left out",
      `${MAIN}/node_modules/.bin/turbo run build --filter='./packages/*' --cwd ${MAIN}`,
    ],
    [
      "the packages build with only one setting",
      "env SKIP_ENV_VALIDATION=true turbo run build --filter='./packages/*'",
    ],
    [
      "the packages build with validation left on",
      "env NODE_ENV=production SKIP_ENV_VALIDATION=false turbo run build --filter='./packages/*'",
    ],
  ])("%s, since the main checkout has no .env", async (_name, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-main-checkout hook refuses")
    expect(reason).toContain(OFF)
  })

  test.each([
    ["a cd into it", `cd ${MAIN} && bun run build`],
    ["bun's --cwd", `bun run --cwd ${MAIN} build`],
    ["bun's --cwd=", `bun --cwd=${MAIN} test`],
    ["turbo's --cwd", `turbo run build --cwd ${MAIN}`],
    ["turbo's --cwd through bun x", `bun x turbo run build --cwd=${MAIN}`],
    ["bun test's own --cwd after test", `bun test --cwd ${MAIN} tests/x.test.ts`],
    ["git -C", `git -C ${MAIN} commit -m x`],
    ["a redirect into it by its path", `echo x > ${MAIN}/stray.txt`],
    ["cp into it by its path", `cp a ${MAIN}/b`],
    ["sed -i on a file in it by its path", `sed -i 's/a/b/' ${MAIN}/scripts/ops/run-slot.sh`],
    ["a commit through run-slot by git -C", `run-slot.sh w -- git -C ${MAIN} commit -m x`],
    ["a cd into it by a path that climbs", `cd ${WORKTREE}/../../.. && bun run build`],
    ["a redirect into it by a path that climbs", `echo x > ${WORKTREE}/../../../stray.txt`],
  ])("from a worktree, %s", async (_name, command) => {
    expect(await bash(command, WORKTREE)).toContain("no-main-checkout hook refuses")
  })
})

// a home whose installed skills and settings link into the main checkout, as link-skills.sh makes them, beside the dispatcher folder's own files
const HOME = mkdtempSync(join(tmpdir(), "no-main-checkout-home-"))
afterAll(() => rmSync(HOME, { force: true, recursive: true }))
mkdirSync(join(MAIN, "skills", "x"), { recursive: true })
mkdirSync(join(MAIN, "scripts"), { recursive: true })
writeFileSync(join(MAIN, "scripts", "factory-settings.json"), "{}")
mkdirSync(join(HOME, ".claude", "skills"), { recursive: true })
mkdirSync(join(HOME, ".playground", "handoffs"), { recursive: true })
symlinkSync(join(MAIN, "skills", "x"), join(HOME, ".claude", "skills", "x"))
symlinkSync(
  join(MAIN, "scripts", "factory-settings.json"),
  join(HOME, ".playground", "factory-settings.json"),
)
symlinkSync(WORKTREE, join(HOME, "wt"))

const tool = (tool_name: string, tool_input: Record<string, unknown>, cwd = MAIN) =>
  check(JSON.stringify({ cwd, hook_event_name: "PreToolUse", tool_input, tool_name }), {}, MAIN)

describe("a file tool's write into the main checkout is refused, with the fix", () => {
  test.each([
    ["a Write", "Write", { content: "x", file_path: `${MAIN}/stray.txt` }],
    ["an Edit", "Edit", { file_path: `${MAIN}/AGENTS.md`, new_string: "b", old_string: "a" }],
    ["a MultiEdit", "MultiEdit", { edits: [], file_path: `${MAIN}/AGENTS.md` }],
    ["a NotebookEdit", "NotebookEdit", { new_source: "x", notebook_path: `${MAIN}/n.ipynb` }],
    ["a Write by a relative path", "Write", { content: "x", file_path: "stray.txt" }],
    [
      "a Write into a folder it has yet to make",
      "Write",
      { content: "x", file_path: `${MAIN}/new/deeper/stray.txt` },
    ],
    [
      "a Write through an installed skill's link",
      "Write",
      { content: "x", file_path: `${HOME}/.claude/skills/x/SKILL.md` },
    ],
    [
      "an Edit through the factory settings' link",
      "Edit",
      {
        file_path: `${HOME}/.playground/factory-settings.json`,
        new_string: "b",
        old_string: "a",
      },
    ],
    [
      "a Write by a path that climbs out of a worktree",
      "Write",
      { content: "x", file_path: `${WORKTREE}/../../../stray.txt` },
    ],
  ])("%s", async (_name, name, input) => {
    const reason = await tool(name, input)
    expect(reason).toContain("no-main-checkout hook refuses a write to")
    expect(reason).toContain(".claude/worktrees/")
  })

  test.each([
    ["a Write in a worktree", "Write", { content: "x", file_path: `${WORKTREE}/api/hono/a.ts` }],
    [
      "a Write through a link into a worktree",
      "Write",
      { content: "x", file_path: `${HOME}/wt/a.ts` },
    ],
    [
      "a handoff under the dispatcher folder",
      "Write",
      { content: "x", file_path: `${HOME}/.playground/handoffs/a-worker.md` },
    ],
    [
      "the roster under the dispatcher folder",
      "Edit",
      { file_path: `${HOME}/.playground/roster.json`, new_string: "b", old_string: "a" },
    ],
    ["a scratch file", "Write", { content: "x", file_path: "/tmp/scratch/a.md" }],
  ])("%s runs", async (_name, name, input) => {
    expect(await tool(name, input)).toBeUndefined()
  })

  test("an Edit in a worktree by a relative path, from the worktree, runs", async () => {
    const input = { file_path: "api/hono/a.ts", new_string: "b", old_string: "a" }
    expect(await tool("Edit", input, WORKTREE)).toBeUndefined()
  })
})

describe("what keeps the main checkout up to date, or only reads it, runs", () => {
  test.each([
    ["fetch", `git -C ${MAIN} fetch`],
    ["link-skills", "scripts/link-skills.sh"],
    ["link-skills by its path", `${MAIN}/scripts/link-skills.sh`],
    ["the packages build after a pull", `${OFF} turbo run build --filter='./packages/*'`],
    ["the packages build unquoted", `${OFF} turbo run build --filter=./packages/*`],
    ["the packages build with its filter apart", `${OFF} turbo run build --filter './packages/*'`],
    ["the packages build through bun x", `${OFF} bun x turbo run build --filter='./packages/*'`],
    ["the packages build through bunx", `${OFF} bunx turbo run build --filter='./packages/*'`],
    ["the packages build through npx", `${OFF} npx turbo run build --filter='./packages/*'`],
    [
      "the packages build as the release skill types it",
      `${OFF} ${MAIN}/node_modules/.bin/turbo run build --filter='./packages/*' --cwd ${MAIN}`,
    ],
    [
      "the packages build with its settings before it",
      "NODE_ENV=production SKIP_ENV_VALIDATION=true turbo run build --filter='./packages/*'",
    ],
    [
      "the packages build with its settings exported first",
      "export NODE_ENV=production SKIP_ENV_VALIDATION=true && turbo run build --filter='./packages/*'",
    ],
    ["git status", "git status --short"],
    ["git log", "git log --oneline -3"],
    ["a read", "cat README.md"],
    ["a search", "grep -rn hook scripts/hooks"],
    ["output to /dev/null", "ls > /dev/null 2>&1"],
    ["stderr into stdout", "git status 2>&1"],
    ["a write outside it", "echo hi > /tmp/x"],
    ["cp out of it", "cp README.md /tmp/readme"],
    ["sed with no -i, to stdout", "sed -n 's/a/b/p' notes.txt"],
    ["sed -i, GNU's, on a file outside it", "sed -i 's/a/b/' /tmp/x"],
    ["sed -i, BSD's, on a file outside it", "sed -i '' 's/a/b/' /tmp/x"],
    ["perl -pi -e on a file outside it", "perl -pi -e 's/a/b/' /tmp/x"],
    ["perl with a module holding an i, no -i", "perl -Mstrict scripts/x.pl notes.txt"],
    ["perl -C holding an i, no -i", "perl -Ci -ne 'print' notes.txt"],
    ["perl -F holding an i, no -i", "perl -Fi -lane 'print' notes.txt"],
    ["BSD sed -i with a suffix word, on a file outside it", "sed -i .bak 's/a/b/' /tmp/x"],
    ["a read through run-slot", "~/.playground/ops/run-slot.sh w -- git status --short"],
    [
      "a commit through run-slot in a worktree by git -C",
      `~/.playground/ops/run-slot.sh w -- env K=V git -C ${WORKTREE} commit -m x`,
    ],
    ["run-slot with no command", "~/.playground/ops/run-slot.sh w"],
    ["curl to stdout", "curl -sS https://example.com"],
    ["curl to stdout by -o -", "curl -sS -o - https://example.com"],
    ["turbo in a worktree by its --cwd", "turbo run build --cwd .claude/worktrees/a"],
    [
      "turbo through bun x in a worktree by its --cwd",
      "bun x turbo run build --cwd .claude/worktrees/a",
    ],
    ["test:skills", "bun run test:skills"],
    ["bun's own bundler", "bun build ./x.ts --outdir /tmp/out"],
    [
      "bun test's own --cwd after test, into a worktree",
      "bun test --cwd .claude/worktrees/a tests/x.test.ts",
    ],
    ["a worktree's start", "git worktree add .claude/worktrees/x -b pg-1-x origin/canary"],
    ["a worktree's end", "git worktree remove --force .claude/worktrees/x"],
    ["worktree prune", "git worktree prune"],
    ["worktree list", "git worktree list"],
    ["a PR's head", "git fetch origin pull/12/head:refs/remotes/pr/12"],
    ["a branch's end", "git branch -D pg-1-x"],
    ["ls-remote", "git ls-remote origin refs/heads/canary"],
    ["rev-parse", "git rev-parse HEAD"],
    ["diff", "git diff --stat origin/canary...HEAD"],
    ["show", "git show origin/canary:AGENTS.md"],
    ["merge-tree", "git merge-tree --write-tree origin/canary HEAD"],
    ["a -C after the subcommand is the subcommand's", `git -C ${WORKTREE} commit -C HEAD`],
    ["an install into a worktree", "bun install --cwd .claude/worktrees/x"],
    ["a build in a worktree by bun's --cwd", "bun run --cwd .claude/worktrees/a build"],
    ["a test run in a worktree by bun's --cwd", "bun run --cwd .claude/worktrees/a test"],
    ["a build in a worktree by bun's --cwd=", "bun --cwd=.claude/worktrees/a run build"],
    [
      "the packages build through bun x past an ignored --cwd",
      `${OFF} bun --cwd=.claude/worktrees/a x turbo run build --filter='./packages/*'`,
    ],
    [
      "the packages build through bunx past an ignored --cwd",
      `${OFF} bunx --cwd=.claude/worktrees/a turbo run build --filter='./packages/*'`,
    ],
  ])("%s", async (_name, command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test("the packages build with its settings in the session's own environment", async () => {
    const raw = JSON.stringify({
      cwd: MAIN,
      hook_event_name: "PreToolUse",
      tool_input: { command: "turbo run build --filter='./packages/*'" },
      tool_name: "Bash",
    })
    const environment = { HOME: "/u", NODE_ENV: "production", SKIP_ENV_VALIDATION: "true" }
    expect(await check(raw, environment, MAIN)).toBeUndefined()
  })

  test.each([
    ["the packages build with no settings", "turbo run build --filter='./packages/*'"],
    ["bun run build", "bun run build"],
    ["lefthook", "lefthook run pre-commit"],
    ["a redirect", "echo x > f"],
    ["a cd within it", "cd api/hono && bun test"],
    ["bun x past a --cwd naming the main checkout", `bun --cwd=${MAIN} x turbo run build`],
  ])("in a worktree, %s", async (_name, command) => {
    expect(await bash(command, WORKTREE)).toBeUndefined()
  })

  test("a cd the hook cannot follow leaves the command alone", async () => {
    expect(await bash("cd $DIR && bun run build")).toBeUndefined()
  })

  test("from a worktree, bun's --cwd into another worktree runs", async () => {
    expect(await bash(`bun run --cwd ${MAIN}/.claude/worktrees/b build`, WORKTREE)).toBeUndefined()
  })
})

// Each git command that moves HEAD, the index or the files, as a session would type it
const MOVES = [
  ["reset --hard", "reset -q --hard 55ae3262ec"],
  ["a mixed reset", "reset HEAD~1"],
  ["checkout", "checkout 55ae3262ec"],
  ["checkout of a file", "checkout -- README.md"],
  ["switch", "switch -c x"],
  ["restore", "restore README.md"],
  ["merge", "merge origin/playground"],
  ["rebase", "rebase origin/canary"],
  ["rebase --abort", "rebase --abort"],
  ["pull", "pull --ff-only"],
  ["cherry-pick", "cherry-pick 55ae3262ec"],
  ["revert", "revert --no-edit HEAD"],
  ["am", "am /tmp/x.patch"],
  ["apply", "apply /tmp/x.patch"],
  ["stash", "stash push -m x"],
  ["clean", "clean -fdx"],
  ["a forced branch move", "branch -f main 55ae3262ec"],
  ["update-ref", "update-ref refs/heads/main 55ae3262ec"],
  ["bisect", "bisect start HEAD HEAD~1"],
  ["mv", "mv README.md x.md"],
  ["rm", "rm -f README.md"],
]

describe("a git command that moves the main checkout's HEAD, index or files is refused, with the fix", () => {
  test.each(MOVES)("%s, from its own folder", async (_name, words) => {
    const reason = await bash(`git ${words}`)
    expect(reason).toContain("no-main-checkout hook refuses")
    expect(reason).toContain("git -C <your worktree>")
  })

  test.each(MOVES)("%s, by git -C from a worktree", async (_name, words) => {
    expect(await bash(`git -C ${MAIN} ${words}`, WORKTREE)).toContain(
      "no-main-checkout hook refuses",
    )
  })

  test.each(MOVES)("%s, by --work-tree and --git-dir from elsewhere", async (_name, words) => {
    expect(
      await bash(`git --work-tree=${MAIN} --git-dir=${MAIN}/.git ${words}`, tmpdir()),
    ).toContain("no-main-checkout hook refuses")
    expect(await bash(`git --git-dir ${MAIN}/.git ${words}`, tmpdir())).toContain(
      "no-main-checkout hook refuses",
    )
  })

  test.each([
    ["a cd left in it", `cd ${MAIN} && git reset --hard 55ae3262ec`],
    ["a -C relative to an earlier -C", `git -C ${WORKTREE} -C ../../.. reset --hard HEAD`],
    ["inside a shell it starts", `bash -c 'git -C ${MAIN} checkout 55ae3262ec'`],
    ["a fast-forward to another branch", `git -C ${MAIN} merge --ff-only -q origin/playground`],
    ["a --git-dir with a trailing slash", `git --git-dir=${MAIN}/.git/ reset --hard HEAD`],
    [
      "a --git-dir of the main checkout beside another --work-tree",
      `git --git-dir ${MAIN}/.git --work-tree ${WORKTREE} reset --hard HEAD`,
    ],
  ])("%s", async (_name, command) => {
    expect(await bash(command, WORKTREE)).toContain("no-main-checkout hook refuses")
  })

  test.each(MOVES)("%s, in a worktree, runs", async (_name, words) => {
    expect(await bash(`git ${words}`, WORKTREE)).toBeUndefined()
    expect(await bash(`git -C ${WORKTREE} ${words}`)).toBeUndefined()
  })

  test.each([
    [
      "the release skill's step 5, as it types it",
      `git -C ${MAIN} fetch -q origin main && git -C ${MAIN} merge --ff-only -q origin/main`,
    ],
    ["status", "git status --short"],
    ["log", "git log --oneline -3"],
    ["reflog", "git reflog --date=iso -5"],
    ["diff", "git diff HEAD~1"],
    ["show", "git show HEAD"],
    ["fetch", "git fetch origin canary"],
    ["rev-parse", "git rev-parse --show-toplevel"],
    ["a worktree's start", "git worktree add .claude/worktrees/x -b fix-x origin/canary"],
    ["worktree list", "git worktree list"],
    ["a worktree's end", "git worktree remove .claude/worktrees/x"],
    ["a branch's end", "git branch -D fix-x"],
    ["a branch list", "git branch --list 'lm-*'"],
    ["stash list", "git stash list"],
    ["a dry clean", "git clean -n"],
    ["a dry add", "git add -n -A"],
    ["a dry add, by its long name", "git add --dry-run ."],
    ["apply --check", "git apply --check /tmp/x.patch"],
  ])("%s in the main checkout runs", async (_name, command) => {
    expect(await bash(command)).toBeUndefined()
  })
})

describe("git reset --keep origin/main, the one way back from a stray local commit on the main checkout's main", () => {
  const scratch = mkdtempSync(join(tmpdir(), "no-main-checkout-reset-"))
  afterAll(() => rmSync(scratch, { force: true, recursive: true }))
  const AS = {
    ...process.env,
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_AUTHOR_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
  }
  const git = (cwd: string, ...args: string[]) => {
    const run = Bun.spawnSync(["git", ...args], { cwd, env: AS, stderr: "pipe", stdout: "pipe" })
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  }
  // A main checkout on main one local commit over origin/main, which no remote holds; each state is its own repo.
  const repo = (name: string, setup?: (main: string) => void) => {
    const origin = join(scratch, `${name}-origin.git`)
    const main = join(scratch, name)
    git(scratch, "init", "-q", "--bare", "-b", "main", origin)
    git(scratch, "clone", "-q", origin, main)
    git(main, "commit", "-q", "--allow-empty", "-m", "shipped")
    git(main, "push", "-q", "origin", "main")
    writeFileSync(join(main, "run-slot.sh"), "stray\n")
    git(main, "add", "run-slot.sh")
    git(main, "commit", "-q", "-m", "stray")
    setup?.(main)
    return main
  }
  const reset = (main: string, command: string) =>
    check(
      JSON.stringify({
        cwd: main,
        hook_event_name: "PreToolUse",
        tool_input: { command },
        tool_name: "Bash",
      }),
      { HOME: "/u" },
      main,
    )

  const stray = repo("stray")
  test.each([
    ["by git -C", `git -C ${stray} reset --keep origin/main`],
    ["by a cd into it", `cd ${stray} && git reset --keep origin/main`],
    ["from its own folder", "git reset --keep origin/main"],
  ])("runs %s, with the tree clean and the commit on no remote", async (_name, command) => {
    expect(await reset(stray, command)).toBeUndefined()
  })

  test.each([
    ["--hard", "git reset --hard origin/main"],
    ["--soft", "git reset --soft origin/main"],
    ["--mixed", "git reset --mixed origin/main"],
    ["a bare reset", "git reset origin/main"],
    ["another target", "git reset --keep HEAD~1"],
    ["--keep with another flag", "git reset --keep -q origin/main"],
  ])("refuses %s", async (_name, command) => {
    expect(await reset(stray, command)).toContain("no-main-checkout hook refuses git reset")
  })

  test.each([
    ["a dirty tree", repo("dirty", (main) => writeFileSync(join(main, "run-slot.sh"), "edit\n"))],
    ["an untracked file", repo("untracked", (main) => writeFileSync(join(main, "new.txt"), "x\n"))],
    [
      "a commit another remote holds",
      repo("pushed", (main) => {
        const mirror = join(scratch, "pushed-mirror.git")
        git(scratch, "init", "-q", "--bare", "-b", "main", mirror)
        git(main, "remote", "add", "mirror", mirror)
        git(main, "push", "-q", "mirror", "main")
      }),
    ],
    ["another branch", repo("branch", (main) => git(main, "checkout", "-q", "-b", "other"))],
  ])("refuses it with %s", async (_name, main) => {
    expect(await reset(main, "git reset --keep origin/main")).toContain(
      "no-main-checkout hook refuses git reset",
    )
  })
})

describe("it fails open", () => {
  test("on input it cannot read", async () => {
    expect(await check("{not json", {}, MAIN)).toBeUndefined()
  })

  test("on a tool it does not judge", async () => {
    const raw = JSON.stringify({ cwd: MAIN, tool_input: { file_path: "x" }, tool_name: "Read" })
    expect(await check(raw, {}, MAIN)).toBeUndefined()
  })

  test("as its own process, on input it cannot read", async () => {
    const proc = Bun.spawn(["bun", "--no-env-file", script], {
      stderr: "pipe",
      stdin: new Blob(["{not json"]),
    })
    expect(await proc.exited).toBe(0)
  })

  test("as its own process, it refuses with exit 2", async () => {
    const raw = JSON.stringify({
      cwd: mainCheckout(root),
      tool_input: { command: "lefthook run pre-commit" },
      tool_name: "Bash",
    })
    const proc = Bun.spawn(["bun", "--no-env-file", script], {
      env: { ...process.env, PLAYGROUND_ROLE: "worker" },
      stderr: "pipe",
      stdin: new Blob([raw]),
    })
    expect(await proc.exited).toBe(2)
    expect(await new Response(proc.stderr).text()).toContain("no-main-checkout hook refuses")
  })
})

describe("mainCheckout", () => {
  const dir = mkdtempSync(join(tmpdir(), "no-main-checkout-"))
  afterAll(() => rmSync(dir, { force: true, recursive: true }))

  test("is the checkout itself where .git is a directory", () => {
    const main = join(dir, "main")
    mkdirSync(join(main, ".git"), { recursive: true })
    expect(mainCheckout(main)).toBe(main)
  })

  test("is the checkout a worktree's .git file points into", () => {
    const worktree = join(dir, "wt")
    mkdirSync(worktree)
    writeFileSync(join(worktree, ".git"), `gitdir: ${MAIN}/.git/worktrees/wt\n`)
    expect(mainCheckout(worktree)).toBe(MAIN)
  })
})
