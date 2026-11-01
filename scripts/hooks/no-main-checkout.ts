// PreToolUse hook: refuses a build, a test run, lefthook, turbo (but for the packages build a pull needs, run with env validation off), a git command that moves HEAD, the index or the files (but for the release skill's step 5 fast-forward; a worker's hard reset there ran another branch's code under every hook for 3.5 minutes) or a file write (a Bash command's, or a Write, Edit, MultiEdit or NotebookEdit) in the main checkout, which every installed skill follows and so stays clean (a reviewer's `lefthook run pre-commit` from the Bash tool's default cwd rebuilt packages' dist and wrote .turbo/runs there).
import { readFileSync, realpathSync } from "node:fs"
import { basename, dirname, join, resolve, sep } from "node:path"

import { fromFactory } from "./role"
import {
  type Env,
  examine,
  knownVariables,
  lex,
  pathOf,
  program,
  run,
  slotWords,
  type Text,
  type Visit,
  type Word,
} from "./shell"

// The checkout a worktree's .git file points into, or the checkout itself where .git is a directory.
export function mainCheckout(dir: string): string {
  try {
    const gitdir = /^gitdir: (.+)$/m.exec(readFileSync(join(dir, ".git"), "utf8"))?.[1]
    const main = gitdir && /^(.+)\/\.git\/worktrees\/[^/]+$/.exec(resolve(dir, gitdir.trim()))?.[1]
    if (main) return main
  } catch {
    // a directory, or no .git: the checkout is its own
  }
  return dir
}

// A path with its nearest existing folder's links followed, so a write through a link into the checkout (link-skills' ~/.claude/skills) is judged where it lands.
function real(path: string): string {
  const rest: string[] = []
  for (let dir = path; ; dir = dirname(dir)) {
    try {
      return join(realpathSync(dir), ...rest.reverse())
    } catch {
      if (dir === dirname(dir)) return path
      rest.push(basename(dir))
    }
  }
}

// The file tools' path field
const FILE_TOOLS: Record<string, string> = {
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
  Write: "file_path",
}

const INSTEAD =
  "the main checkout is what every installed skill follows, so it stays clean. Run it in your own worktree under .claude/worktrees/ (git worktree add .claude/worktrees/<name> -b <branch> origin/canary), or start lefthook from a script with cwd set to a scratch repo, as tests/lefthook.test.ts does."

const refuse = (what: string, fix = INSTEAD) => `no-main-checkout hook refuses ${what}: ${fix}`

// bun scripts that rebuild packages/* or write turbo's runs
const BUN_SCRIPTS = new Set(["build", "check-types", "test", "test:file"])
const RUNNERS = new Set(["npx"])
// bunx is bun x, read as one
const X: Word = { quoted: false, value: "x" }
const TOOLS = new Set(["lefthook", "turbo"])
const DUPLICATE = /^(?:\d+|-)$/
// The one turbo call the main checkout runs, after a pull that changes packages/ (the release skill's step 5): its CLI imports their dist
const PACKAGES_BUILD = ["run", "build", "--filter=./packages/*"]
const BUILD_FIX =
  "the main checkout has no .env, so the packages' env checks fail. Run it as playground update's build step types it, env NODE_ENV=production SKIP_ENV_VALIDATION=true <main checkout>/node_modules/.bin/turbo run build --filter='./packages/*' --cwd <main checkout>."

// Whether turbo's words are that build alone, wherever its --cwd points.
function packagesBuild(args: Word[]): boolean {
  const words: string[] = []
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (v === "--cwd") k++
    else if (v === "--filter") words.push(`--filter=${args[++k]?.value}`)
    else if (!v.startsWith("--cwd=")) words.push(v)
  }
  return words.length === PACKAGES_BUILD.length && words.every((w, i) => w === PACKAGES_BUILD[i])
}

// The directory the last --cwd among a command's words names, turbo's anywhere among them.
export function cwdFlag(args: Word[], env: Env): string | undefined {
  let cwd = env.cwd
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (v === "--cwd") cwd = args[k + 1] && pathOf(args[++k], env)
    else if (v.startsWith("--cwd=")) cwd = pathOf({ ...args[k], value: v.slice(6) }, env)
  }
  return cwd
}

// bun's own --cwd and --filter count only before the script, tool or file it runs, which takes every word after it; the words are bun's subcommand (run, x, test) and that target.
export function bunCall(
  args: Word[],
  env: Env,
): { at: number; cwd: string | undefined; filtered: boolean; words: string[] } {
  let cwd = env.cwd
  let filtered = false
  const words: string[] = []
  let k = 0
  for (; k < args.length; k++) {
    const v = args[k].value
    if (v === "--cwd") cwd = args[k + 1] && pathOf(args[++k], env)
    else if (v.startsWith("--cwd=")) cwd = pathOf({ ...args[k], value: v.slice(6) }, env)
    else if (v === "--filter" || v === "-F") {
      filtered = true
      k++
    } else if (v.startsWith("--filter=")) filtered = true
    else if (!v.startsWith("-")) {
      words.push(v)
      if (v !== "run" && v !== "x") break
    }
  }
  return { at: k, cwd, filtered, words }
}

// git's options before its subcommand that take the next word as their value
const GIT_TAKES = new Set(["-c", "--config-env", "--namespace"])

// git's subcommand and its words, and the tree it acts on: the checkout a --git-dir of `<checkout>/.git` names, whose HEAD and index move, else its --work-tree, else the folder its -C options name (each relative to the one before); each counts only before the subcommand.
function gitCall(
  args: Word[],
  env: Env,
): { cwd: string | undefined; rest: string[]; sub: string | undefined } {
  let cwd = env.cwd
  let gitDir: string | undefined
  let workTree: string | undefined
  const value = (k: number, flag: string) =>
    args[k].value === flag
      ? args[k + 1]
      : { ...args[k], value: args[k].value.slice(flag.length + 1) }
  let k = 0
  for (; k < args.length && args[k].value.startsWith("-"); k++) {
    const v = args[k].value
    if (v === "-C") cwd = args[k + 1] && pathOf(args[++k], { ...env, cwd })
    else if (v === "--git-dir" || v.startsWith("--git-dir=")) {
      const word = value(k, "--git-dir")
      if (v === "--git-dir") k++
      gitDir = word && pathOf(word, { ...env, cwd })
    } else if (v === "--work-tree" || v.startsWith("--work-tree=")) {
      const word = value(k, "--work-tree")
      if (v === "--work-tree") k++
      workTree = word && pathOf(word, { ...env, cwd })
    } else if (GIT_TAKES.has(v)) k++
  }
  const repo = gitDir?.replace(/\/+$/, "")
  const tree = repo?.endsWith(`${sep}.git`) ? dirname(repo) : (workTree ?? cwd)
  return { cwd: tree, rest: args.slice(k + 1).map((a) => a.value), sub: args[k]?.value }
}

// these subcommands move HEAD, the index or the files, whatever their words
const GIT_MOVES = new Set([
  "add",
  "am",
  "bisect",
  "checkout",
  "cherry-pick",
  "mv",
  "pull",
  "rebase",
  "reset",
  "restore",
  "revert",
  "rm",
  "switch",
  "update-ref",
])
// apply's options that only report, unless --apply is given too
const APPLY_READS = new Set(["--check", "--numstat", "--stat", "--summary"])
// The release skill's step 5 moves the main checkout by this fast-forward alone.
const STEP_FIVE = /^(?:-q |--quiet )?--ff-only (?:-q |--quiet )?origin\/main$/
const GIT_FIX =
  "it moves the HEAD, index or files of the main checkout, which every installed skill, hook and ops job runs from. Name your own tree on every git call, git -C <your worktree> ..., after git -C <your worktree> rev-parse --show-toplevel names it; the main checkout moves only by the release skill's step 5, git -C <main checkout> fetch -q origin main && git -C <main checkout> merge --ff-only -q origin/main, and a worktree is made under .claude/worktrees/ by git worktree add."

// The one reset the main checkout takes, back to origin/main from its own main with the tree clean and every commit it drops (origin/main..main) on no remote, so it removes only a stray local commit nobody else holds; --keep refuses to drop uncommitted work too.
function keepReset(sub: string | undefined, rest: string[], cwd: string | undefined): boolean {
  if (sub !== "reset" || rest.join(" ") !== "--keep origin/main" || !cwd) return false
  const git = (...args: string[]) => {
    const read = Bun.spawnSync(["git", "-C", cwd, ...args], { stderr: "ignore", stdout: "pipe" })
    return read.exitCode === 0 ? read.stdout.toString() : undefined
  }
  if (git("symbolic-ref", "-q", "HEAD")?.trim() !== "refs/heads/main") return false
  if (git("status", "--porcelain") !== "") return false
  const dropped = git("rev-list", "origin/main..main")
  return (
    dropped !== undefined && dropped === git("rev-list", "origin/main..main", "--not", "--remotes")
  )
}

// Whether a git subcommand and its words move HEAD, the index or the files: stash's list and show, clean's dry run and apply's checks only read.
function gitMoves(sub: string, rest: string[]): boolean {
  if (GIT_MOVES.has(sub)) return true
  if (sub === "merge") return !STEP_FIVE.test(rest.join(" "))
  if (sub === "stash") return !["list", "show"].includes(rest[0] ?? "push")
  if (sub === "clean") return !rest.some((w) => w === "--dry-run" || /^-[a-z]*n/.test(w))
  if (sub === "apply") return rest.includes("--apply") || !rest.some((w) => APPLY_READS.has(w))
  if (sub === "branch") return rest.some((w) => w === "--force" || /^-[a-zA-Z]*f/.test(w))
  return false
}

// turbo's own words, however it is called: by name or path, through npx, or through bun (runs reads bunx as bun x).
export function turboWords(name: string, args: Word[], env: Env): Word[] | undefined {
  if (name === "turbo") return args
  if (RUNNERS.has(name) || name === "bunx") {
    const at = runnerTarget(args)
    return isTurbo(args[at]?.value) ? args.slice(at + 1) : undefined
  }
  if (name !== "bun") return
  const { at, words } = bunCall(args, env)
  const target = words[0] === "run" || words[0] === "x" ? words[1] : words[0]
  return isTurbo(target) ? args.slice(at + 1) : undefined
}

// npx's and bunx's options whose next word is their value
const RUNNER_TAKES = new Set(["--package", "-p"])

// The word a package runner runs, past its options and their values (-y, --yes, -p turbo).
function runnerTarget(args: Word[]): number {
  let k = 0
  while (k < args.length && args[k].value.startsWith("-"))
    k += RUNNER_TAKES.has(args[k].value) ? 2 : 1
  return k
}

// turbo by name or path, or as a package at a version (turbo@latest)
const isTurbo = (word: string | undefined) =>
  program((word ?? "").replace(/(?<=.)@[^/]*$/, "")) === "turbo"

// Whether the build's settings reach turbo: from its own assignments or env wrapper, an export before it, or the session's environment.
function validationOff(local: Map<string, Text>, env: Env): boolean {
  const read = (key: string) =>
    local.get(key)?.value ?? env.vars.get(key)?.value ?? env.process[key]
  return !!read("NODE_ENV") && read("SKIP_ENV_VALIDATION") === "true"
}

// What of the command would build, test, run lefthook or turbo, commit, or move the checkout with git, or undefined; fix, when set, replaces INSTEAD.
function runs(
  name: string,
  args: Word[],
  local: Map<string, Text>,
  env: Env,
): { cwd: string | undefined; fix?: string; what: string } | undefined {
  if (name === "bunx") return runs("bun", [X, ...args], local, env)
  const turbo = turboWords(name, args, env)
  if (turbo && packagesBuild(turbo)) {
    if (validationOff(local, env)) return
    return {
      cwd: cwdFlag(turbo, env),
      fix: BUILD_FIX,
      what: "the packages build without NODE_ENV and SKIP_ENV_VALIDATION=true",
    }
  }
  if (TOOLS.has(name)) return { cwd: cwdFlag(args, env), what: name }
  if (RUNNERS.has(name) && TOOLS.has(program(args[0]?.value ?? ""))) {
    return { cwd: cwdFlag(args, env), what: `${name} ${program(args[0].value)}` }
  }
  if (name === "git") {
    const { cwd, rest, sub } = gitCall(args, env)
    if (sub === "commit") return { cwd, what: "git commit, which runs lefthook's pre-commit" }
    if (keepReset(sub, rest, cwd)) return
    return sub && gitMoves(sub, rest) ? { cwd, fix: GIT_FIX, what: `git ${sub}` } : undefined
  }
  if (name !== "bun") return
  const { at, cwd, filtered, words } = bunCall(args, env)
  const target = words[0] === "run" || words[0] === "x" ? words[1] : words[0]
  // bun runs a tool by its path, as lefthook.yml does, or as a script or package by its name; a tool reads its own --cwd too, and bun x runs in the shell's folder whatever bun's --cwd says
  if (TOOLS.has(program(target ?? ""))) {
    const dir = words[0] === "x" ? env.cwd : cwd
    return {
      cwd: cwdFlag(args.slice(at + 1), { ...env, cwd: dir }),
      what: `bun ${words.join(" ")}`,
    }
  }
  // bun test runs no script, so a --cwd after test is still its own
  if (words[0] === "test")
    return { cwd: cwdFlag(args.slice(at + 1), { ...env, cwd }), what: "bun test" }
  // bare, a script name runs the script, but build is bun's own bundler unless a --filter names the packages whose script it runs
  if (target && BUN_SCRIPTS.has(target) && (words[0] === "run" || filtered || target !== "build"))
    return { cwd, what: `bun ${words.join(" ")}` }
}

// sed's and perl's options whose next word is their value, and which of those is the script
const EDIT_TAKES: Record<string, Set<string>> = {
  perl: new Set(["-E", "-e"]),
  sed: new Set(["--expression", "--file", "--line-length", "-e", "-f", "-l"]),
}
const SCRIPT = new Set(["--expression", "--file", "-E", "-e", "-f"])

// The files sed -i or perl -i edits in place (none without -i): every positional, but the first when no -e or -f gave the script; BSD sed's -i takes an empty suffix as its own word.
function inPlace(name: string, args: Word[]): Word[] {
  const takes = EDIT_TAKES[name]
  if (!takes) return []
  let edits = false
  let scripted = false
  const positionals: Word[] = []
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (v === "--") {
      positionals.push(...args.slice(k + 1))
      break
    }
    if (takes.has(v)) {
      scripted ||= SCRIPT.has(v)
      k++
    } else if (name === "sed" && (v === "--in-place" || v.startsWith("--in-place="))) edits = true
    // perl's -M, -m and -I hold a module or a folder, never -i
    else if (/^-[^-]/.test(v) && !(name === "perl" && /^-[MmI]/.test(v))) {
      if (/^-[A-Za-z0-9]*i/.test(v)) {
        edits = true
        if (name === "sed" && v === "-i" && args[k + 1]?.value === "") k++
      }
      // a flag group ending in the script's flag (-pe, -ne) takes the next word as the script
      if (/^-[A-Za-z0-9]+[eEf]$/.test(v)) {
        scripted = true
        k++
      }
    } else if (!v.startsWith("-")) positionals.push(args[k])
  }
  if (!edits) return []
  return scripted ? positionals : positionals.slice(1)
}

// The files a command writes by name, besides its redirects.
function writes(name: string, args: Word[]): Word[] {
  const positionals = args.filter((a) => !a.value.startsWith("-"))
  if (name === "sed" || name === "perl") return inPlace(name, args)
  if (name === "touch" || name === "tee") return positionals
  if (name === "cp" || name === "mv") return positionals.slice(-1)
  if (name !== "curl") return []
  const out: Word[] = []
  for (let k = 0; k < args.length; k++) {
    const v = args[k].value
    if (["-c", "--cookie-jar", "-o", "--output"].includes(v) && args[k + 1]) out.push(args[++k])
    const attached = /^--(?:cookie-jar|output)=(.+)$/.exec(v)?.[1]
    if (attached) out.push({ ...args[k], value: attached })
  }
  return out
}

function inspect(raw: string, environment: Record<string, string | undefined>, main: string) {
  const { cwd, tool_input: toolInput, tool_name: tool } = JSON.parse(raw) as Record<string, unknown>
  const input = (toolInput ?? {}) as Record<string, unknown>
  const directory = typeof cwd === "string" ? cwd : undefined
  const checkout = real(main)
  const worktrees = join(checkout, ".claude", "worktrees") + sep
  const inMain = (raw: string | undefined) => {
    const path = raw === undefined ? undefined : real(resolve(directory ?? "", raw))
    return (
      path !== undefined &&
      (path === checkout || path.startsWith(checkout + sep)) &&
      !(path + sep).startsWith(worktrees)
    )
  }
  const file = typeof tool === "string" ? input[FILE_TOOLS[tool]] : undefined
  if (typeof file === "string") return inMain(file) ? refuse(`a write to ${file}`) : undefined
  if (tool !== "Bash") return
  const { command } = input
  if (typeof command !== "string") return
  const visit: Visit = async (cmd, parsed, env) => {
    const slot = slotWords(parsed)
    if (slot)
      return slot.length === 0 ? undefined : examine({ ...cmd, words: slot }, env, visit, false)
    const { args, local, name } = parsed
    const ran = runs(name, args, local, env)
    if (ran && inMain(ran.cwd)) return refuse(ran.what, ran.fix)
    const targets = [
      ...cmd.redirects
        .filter(
          (r) =>
            [">", ">>", ">|"].includes(r.op) ||
            (r.op === ">&" && !DUPLICATE.test(r.target?.value ?? "")),
        )
        .flatMap((r) => (r.target ? [r.target] : [])),
      ...writes(name, args),
    ]
    const into = targets.find(
      (t) => !["-", "/dev/null"].includes(t.value) && inMain(pathOf(t, env)),
    )
    if (into) return refuse(`a write to ${pathOf(into, env)}`)
  }
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known: knownVariables(command, environment, directory),
    process: environment,
    vars: new Map(),
  }
  return run(lex(command, env.known), env, visit)
}

// Fails open: an error on any call lets it run, so a reader bug cannot block every Bash command or write.
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
