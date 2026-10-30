import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { check } from "../../../scripts/hooks/no-unslotted-run"

const root = join(import.meta.dir, "..", "..", "..")
const script = join(root, "scripts", "hooks", "no-unslotted-run.ts")
// real directories, since the reader follows a cd only into one that exists
const MAIN = mkdtempSync(join(tmpdir(), "no-unslotted-run-main-"))
const WORKTREE = `${MAIN}/.claude/worktrees/a`
const LEADS = `${MAIN}/.claude/worktrees/leads`
const OUTSIDE = mkdtempSync(join(tmpdir(), "no-unslotted-run-outside-"))
mkdirSync(join(WORKTREE, "api", "hono"), { recursive: true })
mkdirSync(LEADS, { recursive: true })
afterAll(() => {
  rmSync(MAIN, { force: true, recursive: true })
  rmSync(OUTSIDE, { force: true, recursive: true })
})

const SLOT = "~/.playground/ops/run-slot.sh worker-x --"

const bash = (command: string, cwd = WORKTREE) =>
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

describe("a heavy run in a worktree outside run-slot is refused, naming the run-slot form", () => {
  test.each([
    ["bun install", "bun install"],
    ["bun install with its flags", "bun install --ignore-scripts"],
    ["bun i", "bun i"],
    ["a node_modules clone into it", `cp -cR ${LEADS}/node_modules ${WORKTREE}/`],
    ["a node_modules clone with a trailing slash", `cp -R ${LEADS}/node_modules/ ./`],
    ["a node_modules clone by --recursive", `cp --recursive ${LEADS}/node_modules .`],
    ["bun run build", "bun run build"],
    ["bun run check-types", "bun run check-types"],
    ["bun run test", "bun run test"],
    ["check-types by its bare name", "bun check-types"],
    ["the whole suite through bun test", "bun test"],
    ["the whole suite through bun run test:file", "bun run test:file"],
    ["bun test with a flag and its value only", "bun test --timeout 20000"],
    ["bun test with --max-concurrency and its value only", "bun test --max-concurrency 2"],
    ["bun test with --seed and its value only", "bun test --seed 2"],
    ["bun test with --shard and its value only", "bun test --shard 1/2"],
    ["bun test with --retry and its value only", "bun test --retry 1"],
    ["bun test with --coverage-reporter and its value only", "bun test --coverage-reporter lcov"],
    [
      "bun test with --path-ignore-patterns and its value only",
      "bun test --path-ignore-patterns x",
    ],
    ["bun test with --parallel-delay and its value only", "bun test --parallel-delay 0"],
    ["bun test with --timings and its value only", "bun test --timings t.json"],
    ["bun test with --reporter and its value only", "bun test --reporter dots"],
    ["bun test with --reporter-outfile and its value only", "bun test --reporter-outfile o.xml"],
    ["bun test with --rerun-each and its value only", "bun test --rerun-each 2"],
    ["bun test with --coverage-dir and its value only", "bun test --coverage-dir c"],
    ["bun test with --preload and its value only", "bun test --preload ./p.ts"],
    ["bun test with -t and its value only", "bun test -t name"],
    ["bun test with --test-name-pattern and its value only", "bun test --test-name-pattern name"],
    ["bun test with --env-file and its value only", "bun test --env-file .env"],
    ["bun test with -r and its value only", "bun test -r ./p.ts"],
    ["bun test with --require and its value only", "bun test --require ./p.ts"],
    ["bun test with --tsconfig-override and its value only", "bun test --tsconfig-override t.json"],
    ["bun test with --define and its value only", "bun test --define A:1"],
    ["next build", "next build"],
    ["next build through bunx -p", "bunx -p next next build"],
    ["next build through bunx --bun", "bunx --bun next build"],
    ["next build through bunx", "bunx next build"],
    ["next build through bun x", "bun x next build"],
    ["turbo build by name (#2018)", "turbo run build"],
    ["the packages build by its path", "node_modules/.bin/turbo run build --filter=./packages/*"],
    ["turbo build by its absolute path", `${WORKTREE}/node_modules/.bin/turbo run build`],
    ["turbo build through bunx", "bunx turbo run build --filter=./packages/*"],
    ["turbo build through npx", "npx turbo run build"],
    ["turbo build through bun x", "bun x turbo run build"],
    ["turbo build through npx -y", "npx -y turbo run build"],
    ["turbo build through npx --yes", "npx --yes turbo run build"],
    ["turbo build through npx -p", "npx -p turbo turbo run build"],
    ["turbo build through bunx -p", "bunx -p turbo turbo run build"],
    ["turbo build by its versioned package through bunx", "bunx turbo@latest run build"],
    ["turbo build by its versioned package through npx", "npx turbo@2 run build"],
    ["turbo build by its versioned package through bun x", "bun x turbo@latest run build"],
    ["turbo build behind env", "env NODE_ENV=production SKIP_ENV_VALIDATION=true turbo run build"],
    ["turbo check-types", "turbo run check-types"],
    ["turbo test", "turbo run test"],
    ["turbo lint", "turbo run lint"],
    ["turbo's shorthand without run", "turbo build"],
    ["a heavy task among others", "turbo run format build"],
    ["inside a shell it starts", "bash -c 'bun run test'"],
    ["after other commands", "git status && bun run build"],
    ["after a run-slot run", `${SLOT} bun install && bun run test`],
    ["a cd within it", "cd api/hono && bun test"],
  ])("%s", async (_name, command) => {
    const reason = await bash(command)
    expect(reason).toContain("no-unslotted-run hook refuses")
    expect(reason).toContain("~/.playground/ops/run-slot.sh <your name> -- ")
    expect(command.replaceAll("'", "")).toContain(reason?.split("<your name> -- ")[1] ?? "unset")
  })

  test("the fix keeps the command's assignments behind env and its quoting, and shows an unread value as a space", async () => {
    expect(await bash("NODE_ENV=test bun test -t 'a b'")).toEndWith(
      "-- env NODE_ENV=test bun test -t 'a b'",
    )
    expect(await bash("env SKIP_ENV_VALIDATION=true bun run test")).toEndWith(
      "-- env SKIP_ENV_VALIDATION=true bun run test",
    )
    expect(await bash("exec bun run test")).toEndWith("<your name> -- bun run test")
    expect(await bash('FOO="a b" bun run test')).toEndWith("-- env 'FOO=a b' bun run test")
    expect(
      await bash('NODE_ENV=production SKIP_ENV_VALIDATION="true" bun run check-types'),
    ).toEndWith("-- env NODE_ENV=production 'SKIP_ENV_VALIDATION=true' bun run check-types")
    const unread = await bash("bun test --timeout $NOPE")
    expect(unread).toContain("no-unslotted-run hook refuses")
    expect(unread).not.toContain("\u0000")
  })

  test("the fix starts in the folder an earlier cd moved to, so it runs where the hook judged it", async () => {
    for (const cwd of [MAIN, OUTSIDE]) {
      expect(await bash(`cd ${WORKTREE} && bun install`, cwd)).toEndWith(
        `Run it as cd ${WORKTREE} && ~/.playground/ops/run-slot.sh <your name> -- bun install`,
      )
    }
    expect(await bash("bun install")).toContain("Run it as ~/.playground/ops/run-slot.sh")
  })

  test.each([
    ["bun run's --cwd", `bun run --cwd ${WORKTREE} test`],
    ["bun's --cwd before run", `bun --cwd ${WORKTREE} run build`],
    ["bun's --cwd=", `bun --cwd=${WORKTREE} run check-types`],
    ["bun install's own --cwd", `bun install --ignore-scripts --cwd ${WORKTREE}`],
    ["bun test's own --cwd", `bun test --cwd ${WORKTREE}`],
    ["a cd into it", `cd ${WORKTREE} && bun run check-types`],
    ["a node_modules clone by its destination", `cp -cR ${LEADS}/node_modules ${WORKTREE}/`],
  ])("from anywhere, by %s", async (_name, command) => {
    for (const cwd of [MAIN, LEADS, OUTSIDE]) {
      expect(await bash(command, cwd)).toContain("no-unslotted-run hook refuses")
    }
  })
})

describe("a run through run-slot, a light run, or one outside the worktrees runs", () => {
  test.each([
    ["an install through run-slot", `${SLOT} bun install --ignore-scripts --cwd ${WORKTREE}`],
    ["a clone through run-slot", `${SLOT} cp -cR ${LEADS}/node_modules ${WORKTREE}/`],
    ["the suite through run-slot", `${SLOT} bun run test`],
    [
      "check-types through run-slot with env in front",
      `NODE_ENV=production ${SLOT} env SKIP_ENV_VALIDATION=true bun run check-types`,
    ],
    ["a script through run-slot", `${SLOT} bash /tmp/bisect.sh`],
    ["run-slot by env", `env NODE_ENV=production ${SLOT} bun run build`],
    ["bun test on a file", "bun test tests/scripts/hooks/no-stash.test.ts"],
    ["bun test on a folder", "bun test tests/scripts/hooks"],
    ["bun run test:file on a folder", "bun run test:file tests/scripts/hooks"],
    ["bun test on a file after a value flag", "bun test --timeout 20000 tests/x.test.ts"],
    ["test:skills", "bun run test:skills"],
    ["bun test --help", "bun test --help"],
    ["bun install --help", "bun install --help"],
    ["bun install --dry-run", "bun install --dry-run"],
    ["bun's own bundler", "bun build ./x.ts --outdir /tmp/out"],
    ["a copy that is not node_modules", `cp -R ${LEADS}/docs ./docs`],
    ["a read of node_modules", "ls node_modules/.bin"],
    ["git", "git status --short"],
    ["turbo --help", "turbo --help"],
    ["turbo run build --help", "turbo run build --help"],
    ["turbo --version", "turbo --version"],
    ["turbo --version through npx -y", "npx -y turbo@latest --version"],
    ["turbo run build --dry-run", "turbo run build --dry-run"],
    ["turbo run build --dry-run=json", "turbo run build --dry-run=json"],
    ["a light turbo task", "turbo run format"],
    ["turbo build through run-slot", `${SLOT} turbo run build --filter='./packages/*'`],
  ])("%s", async (_name, command) => {
    expect(await bash(command)).toBeUndefined()
  })

  test.each([
    ["in the main checkout", "bun run build", MAIN],
    ["an install in the main checkout", "bun install", MAIN],
    ["outside the repo", "bun run test", OUTSIDE],
    ["the worktrees folder itself", "bun install", `${MAIN}/.claude/worktrees`],
  ])("%s", async (_name, command, cwd) => {
    expect(await bash(command, cwd)).toBeUndefined()
  })

  test("a cd the hook cannot follow leaves the command alone", async () => {
    expect(await bash("cd $DIR && bun run build", OUTSIDE)).toBeUndefined()
  })
})

describe("it fails open, and acts for a factory session alone", () => {
  test("on input it cannot read", async () => {
    expect(await check("{not json", {}, MAIN)).toBeUndefined()
  })

  test("on any tool but Bash", async () => {
    const raw = JSON.stringify({
      cwd: WORKTREE,
      tool_input: { file_path: "x" },
      tool_name: "Write",
    })
    expect(await check(raw, {}, MAIN)).toBeUndefined()
  })

  const own = (env: Record<string, string | undefined>) => {
    const worktree = join(root, ".claude", "worktrees", "a")
    const raw = JSON.stringify({
      cwd: worktree,
      tool_input: { command: `bun run --cwd ${worktree} test` },
      tool_name: "Bash",
    })
    return Bun.spawn(["bun", "--no-env-file", script], {
      env,
      stderr: "pipe",
      stdin: new Blob([raw]),
    })
  }

  test("as its own process, it refuses a factory session with exit 2", async () => {
    const proc = own({ ...process.env, PLAYGROUND_ROLE: "worker" })
    expect(await proc.exited).toBe(2)
    expect(await new Response(proc.stderr).text()).toContain("no-unslotted-run hook refuses")
  })

  test("as its own process, it passes a session outside the factory", async () => {
    const { PLAYGROUND_ROLE: _role, ...rest } = process.env
    const proc = own({ ...rest, CLAUDE_CONFIG_DIR: OUTSIDE })
    expect(await proc.exited).toBe(0)
  })

  test("as its own process, on input it cannot read", async () => {
    const proc = Bun.spawn(["bun", "--no-env-file", script], {
      env: { ...process.env, PLAYGROUND_ROLE: "worker" },
      stderr: "pipe",
      stdin: new Blob(["{not json"]),
    })
    expect(await proc.exited).toBe(0)
  })
})
