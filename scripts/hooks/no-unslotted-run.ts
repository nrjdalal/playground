// PreToolUse hook: refuses a worktree install, node_modules clone, build, type check or whole suite outside run-slot, since five worktree installs at once drove load1 to 66.8 on 18 Oct, and a docker build from any folder, since one fills the Docker VM the live dashboard's Postgres shares.
import { join, resolve, sep } from "node:path"

import { atOnce, buildName, DOCKERS, dockerBuild, portlessCompose } from "./docker-build"
import { bunCall, cwdFlag, mainCheckout, turboWords } from "./no-main-checkout"
import { fromFactory } from "./role"
import {
  ASSIGN,
  type Env,
  knownVariables,
  lex,
  pathOf,
  places,
  program,
  run,
  visible,
  type Visit,
  type Word,
} from "./shell"

const refuse = (what: string, cd: string, command: string) =>
  `no-unslotted-run hook refuses ${what} in a worktree outside run-slot: every heavy run goes through it (playbook's **slots**), so the machine runs a few at a time. Run it as ${cd}~/.playground/ops/run-slot.sh <your name> -- ${command}`

// A docker build fills the one Docker VM every folder shares, the live dashboard's Postgres included, so it goes through run-slot from any folder, one at a time.
const refuseDocker = (what: string, cd: string, command: string, fix?: string) =>
  fix
    ? `no-unslotted-run hook refuses ${what} from any folder, which run-slot refuses too: ${fix}`
    : `no-unslotted-run hook refuses ${what} outside run-slot, from any folder: a build fills the Docker VM the live dashboard's Postgres shares (6 Nov: a parallel compose build got it killed), so run-slot runs one docker build at a time, a compose build one service at a time. Run it as ${cd}~/.playground/ops/run-slot.sh <your name> -- ${command}`

// A line that names more folders than the reader carries (`Env.cwdAnywhere` in shell.ts) may run in any folder, a worktree included, so a heavy run on it goes through run-slot too.
const anywhere = (what: string, command: string) =>
  `no-unslotted-run hook refuses ${what} on a line that names more folders than the hook carries, since it cannot rule out a worktree: every heavy run goes through run-slot (playbook's **slots**). Run it as ~/.playground/ops/run-slot.sh <your name> -- ${command}, or as a line of its own after a cd to a literal path.`

// bun scripts that build packages/* or run the whole suite
const BUN_SCRIPTS = new Set(["build", "check-types", "test"])
const RUNNERS = new Set(["bunx", "npx"])
// bunx's and npx's options whose next word is their value
const RUNNER_TAKES = new Set(["--package", "-p"])
// bun test's options, and bun's runtime ones it also takes, whose next word is their value (bun test --help, bun --help), so it is no test file; --bail, -c, --changed, --config, --elide-lines, --inspect, --parallel and --shell take theirs only attached
const TEST_TAKES = new Set([
  "--conditions",
  "--console-depth",
  "--coverage-dir",
  "--coverage-reporter",
  "--define",
  "--disable-warning",
  "--dns-result-order",
  "--drop",
  "--env-file",
  "--extension-order",
  "--feature",
  "--fetch-preconnect",
  "--import",
  "--install",
  "--jsx-factory",
  "--jsx-fragment",
  "--jsx-import-source",
  "--jsx-runtime",
  "--loader",
  "--main-fields",
  "--max-concurrency",
  "--max-http-header-size",
  "--parallel-delay",
  "--path-ignore-patterns",
  "--port",
  "--preload",
  "--redirect-warnings",
  "--reporter",
  "--reporter-outfile",
  "--require",
  "--rerun-each",
  "--retry",
  "--seed",
  "--shard",
  "--test-name-pattern",
  "--timeout",
  "--timings",
  "--title",
  "--tsconfig-override",
  "--unhandled-rejections",
  "--user-agent",
  "-d",
  "-l",
  "-r",
  "-t",
])

// turbo's tasks that build, type-check, test or lint, and the words that make a turbo call run none
const TURBO_TASKS = new Set(["build", "check-types", "lint", "test"])
const TURBO_LIGHT = /^(?:--help|-h|--version|--dry(?:-run)?(?:=.*)?)$/

// The heavy task a turbo call runs, as `turbo run <task>` or turbo's own `turbo <task>`, or undefined.
function turboTask(words: Word[]): string | undefined {
  if (words.some((w) => TURBO_LIGHT.test(w.value))) return
  const tasks = words.map((w) => w.value).filter((v) => !v.startsWith("-"))
  return (tasks[0] === "run" ? tasks.slice(1) : tasks).find((t) => TURBO_TASKS.has(t))
}

const recursive = (args: Word[]) =>
  args.some(
    (a) => /^-[a-zA-Z]*[Rra]/.test(a.value) || ["--archive", "--recursive"].includes(a.value),
  )

// What of the command is a heavy run, and the directory it runs in or writes to, or undefined.
function heavy(
  name: string,
  args: Word[],
  env: Env,
): { anywhere?: true; dir: string | undefined; fix?: string; what: string } | undefined {
  const compose = portlessCompose(name, args)
  if (DOCKERS.has(name) || compose) {
    const build = compose
      ? dockerBuild(compose, true)
      : dockerBuild(args, name === "docker-compose")
    return build && { anywhere: true, dir: env.cwd, fix: atOnce(build), what: buildName(build) }
  }
  if (name === "cp") {
    const paths = args.filter((a) => !a.value.startsWith("-"))
    const from = paths.slice(0, -1)
    if (
      recursive(args) &&
      from.some((a) => program(a.value.replace(/\/+$/, "")) === "node_modules")
    )
      return {
        dir: paths.at(-1) && pathOf(paths.at(-1) as Word, env),
        what: "a node_modules clone",
      }
    return
  }
  if (name === "next")
    return args[0]?.value === "build" ? { dir: env.cwd, what: "next build" } : undefined
  // turbo by name, path or versioned package, through bunx, npx or bun x past their options, read as no-main-checkout reads it
  const turbo = turboWords(name, args, env)
  if (turbo) {
    const task = turboTask(turbo)
    return task ? { dir: cwdFlag(turbo, env), what: `turbo run ${task}` } : undefined
  }
  if (RUNNERS.has(name)) {
    const words = args.filter(
      (a, k) => !a.value.startsWith("-") && !RUNNER_TAKES.has(args[k - 1]?.value ?? ""),
    )
    return program(words[0]?.value ?? "") === "next" && words[1]?.value === "build"
      ? { dir: env.cwd, what: `${name} next build` }
      : undefined
  }
  if (name !== "bun") return
  const { at, cwd, filtered, words } = bunCall(args, env)
  const rest = args.slice(at + 1)
  if (words[0] === "install" || words[0] === "i") {
    if (rest.some((a) => ["--dry-run", "--help", "-h"].includes(a.value))) return
    return { dir: cwdFlag(rest, { ...env, cwd }), what: "bun install" }
  }
  if (words[0] === "x" && program(words[1] ?? "") === "next" && rest[0]?.value === "build")
    return { dir: cwd, what: "bun x next build" }
  // bun run test:file passes its words to bun test, and with no file runs the whole suite as bun test does
  const testFile = words[0] === "run" && words[1] === "test:file"
  if (words[0] === "test" || testFile) {
    if (rest.some((a) => a.value === "--help" || a.value === "-h")) return
    let files = 0
    for (let k = 0; k < rest.length; k++) {
      if (TEST_TAKES.has(rest[k].value) || rest[k].value === "--cwd") k++
      else if (!rest[k].value.startsWith("-")) files++
    }
    if (files > 0) return
    return testFile
      ? { dir: cwd, what: "bun run test:file" }
      : { dir: cwdFlag(rest, { ...env, cwd }), what: "bun test" }
  }
  const target = words[0] === "run" ? words[1] : words[0]
  // bare, build is bun's own bundler unless a --filter names the packages whose script it runs
  if (target && BUN_SCRIPTS.has(target) && (words[0] === "run" || filtered || target !== "build"))
    return { dir: cwd, what: `bun ${words.join(" ")}` }
}

// A word as the fix shows it: a value the reader could not read as a space, and a quoted one in single quotes.
const shown = (word: Word) => {
  const value = visible(word.value)
  return word.quoted ? `'${value.replaceAll("'", "'\\''")}'` : value
}

// A directory as the fix shows it, in single quotes unless it is plain.
const quotedDir = (dir: string) =>
  /^[\w@%+=:,./~-]+$/.test(dir) ? dir : `'${dir.replaceAll("'", "'\\''")}'`

function inspect(raw: string, environment: Record<string, string | undefined>, main: string) {
  const { cwd, tool_input: toolInput, tool_name: tool } = JSON.parse(raw) as Record<string, unknown>
  if (tool !== "Bash") return
  const command = (toolInput as { command?: unknown } | null)?.command
  if (typeof command !== "string") return
  const worktrees = join(main, ".claude", "worktrees") + sep
  const inWorktree = (dir: string | undefined) =>
    dir !== undefined && resolve(dir).startsWith(worktrees)
  const directory = typeof cwd === "string" ? cwd : undefined
  const visit: Visit = async (cmd, { args, first, name }, env) => {
    // run-slot.sh queues the words after its -- as one heavy run
    if (name === "run-slot.sh") return
    const words = () => {
      const at = first ? cmd.words.indexOf(first) : -1
      if (at < 0) return undefined
      const assigns = cmd.words.slice(0, at).filter((w) => ASSIGN.test(w.value))
      return [
        ...(assigns.length ? ["env", ...assigns.map(shown)] : []),
        ...cmd.words.slice(at).map(shown),
      ].join(" ")
    }
    // a line that names more folders than the reader carries may run in a worktree, whatever folder it started in
    if (env.cwdAnywhere) {
      const found = heavy(name, args, { ...env, cwd: undefined })
      const line = words()
      if (found?.anywhere && line !== undefined)
        return refuseDocker(found.what, "", line, found.fix)
      if (found && line !== undefined && (found.dir === undefined || inWorktree(found.dir)))
        return anywhere(found.what, line)
    }
    // every folder the shell may be in, so a heavy run after a cd the reader cannot be sure of is caught wherever that cd may have left it
    for (const here of places(env)) {
      const found = heavy(name, args, here)
      if (!found || !(found.anywhere || inWorktree(found.dir))) continue
      // run-slot execs the first word after its --, so the fix keeps the program, its words and every assignment before it behind env, and drops every wrapper (exec, timeout, env's own options)
      const line = words()
      if (line === undefined) return
      // a cd earlier in the command moved the shell, so the fix starts in the folder the run would reach rather than in the tool's own
      const moved =
        here.cwd !== undefined &&
        (directory === undefined || resolve(here.cwd) !== resolve(directory))
      const cd = moved ? `cd ${quotedDir(here.cwd as string)} && ` : ""
      return found.anywhere
        ? refuseDocker(found.what, cd, line, found.fix)
        : refuse(found.what, cd, line)
    }
  }
  const env: Env = {
    cwd: directory,
    // the line starts in the folder the tool names, which the reader has proved by the payload itself
    cwdSure: directory,
    files: new Map(),
    known: knownVariables(command, environment, directory),
    process: environment,
    vars: new Map(),
  }
  return run(lex(command, env.known), env, visit)
}

// Fails open: an error on any call lets it run, so a reader bug cannot block every Bash command.
export async function check(
  raw: string,
  environment: Record<string, string | undefined> = process.env,
  main: string = mainCheckout(resolve(import.meta.dir, "..", "..")),
): Promise<string | undefined> {
  try {
    return await inspect(raw, environment, main)
  } catch {
    return
  }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text()
  const reason = (await fromFactory(raw)) ? await check(raw) : undefined
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
