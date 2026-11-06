import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { dataDirOf } from "@packages/env/data-dir"

// Measures a head's hooks against a canary sha, each form or call reaching each hook's check() as data alone and never run: `sweep --forms <module>` passes the forms a module exports from the home, the data folder and a worktree, `replay` the last day's Bash calls from this machine's transcripts; a clean head's result is stored under its key and printed again for a day without a run; started bare it queues itself through run-slot, as commit-slot.ts queues a commit's build.

export type Check = (
  raw: string,
  env: Record<string, string | undefined>,
  main?: string,
) => Promise<string | undefined> | string | undefined
type Form = { command: string; inClass?: boolean }
type Call = { command: string; cwd: string }
type Tally = { inClass: number; outClass: number }

const USAGE =
  "usage: bun run hooks:differential <sweep --forms <module> | replay [--hours <n>]> --canary <sha> --hook <name> [--hook <name> ...] [--fresh]"

const DAY = 24 * 3600 * 1000

// The hooks whose check() takes the main checkout third: canary's tree is unpacked by git archive and is no git checkout, so on its own default each would read that folder as main, and both sides get the head's main checkout
export const TAKES_MAIN = ["no-main-checkout", "no-unslotted-run"]

// The run-slot call a bare start becomes, or the argv itself inside a ticket (whose child carries the RUN_SLOT_NICE run-slot exports) or with no executable run-slot.sh
export const routed = ({
  argv,
  cwd,
  env,
  executable,
  home,
}: {
  argv: string[]
  cwd: string
  env: Record<string, string | undefined>
  executable: (path: string) => boolean
  home: string
}): string[] => {
  const runSlot = `${home}/.playground/ops/run-slot.sh`
  if (env.RUN_SLOT_NICE !== undefined || !executable(runSlot)) return argv
  const folder = /\/\.claude\/worktrees\/([^/]+)/.exec(cwd)?.[1] ?? "main"
  return [runSlot, `hooks-${folder.replace(/[^A-Za-z0-9._#-]/g, "-")}`, "--", ...argv]
}

// The folders each sweep form is checked from: the home, the data folder and a worktree
export const cwdsOf = (home: string) => [
  home,
  join(home, ".playground"),
  join(home, "x", ".claude", "worktrees", "y"),
]

// main undefined leaves a hook's own default in place, as a call with no third argument does
const allows = async (check: Check, call: Call, home: string, main?: string) =>
  (await check(
    JSON.stringify({ cwd: call.cwd, tool_input: { command: call.command }, tool_name: "Bash" }),
    { HOME: home },
    main,
  )) === undefined

// Each form from each folder through both hooks: the same, newly allowed and newly refused, each split by the form's class (a form with no class is outside it)
export async function sweep(
  canary: Check,
  head: Check,
  forms: Form[],
  home: string,
  main?: string,
) {
  const counts = {
    cases: 0,
    forms: forms.length,
    "newly allowed": { inClass: 0, outClass: 0 } as Tally,
    "newly refused": { inClass: 0, outClass: 0 } as Tally,
    same: 0,
  }
  const changed: string[] = []
  for (const { command, inClass } of forms)
    for (const cwd of cwdsOf(home)) {
      counts.cases++
      const [was, now] = [
        await allows(canary, { command, cwd }, home, main),
        await allows(head, { command, cwd }, home, main),
      ]
      if (was === now) {
        counts.same++
        continue
      }
      counts[now ? "newly allowed" : "newly refused"][inClass ? "inClass" : "outClass"]++
      if (!now || !inClass) changed.push(`${now ? "allowed" : "refused"} ${cwd} :: ${command}`)
    }
  return { changed, counts }
}

// Every Bash call of the transcripts under `projects` newer than `since`, a sub-agent's nested ones included, one per folder and command
export async function calls(projects: string, since: number): Promise<Call[]> {
  const found = new Map<string, Call>()
  const files = existsSync(projects) ? readdirSync(projects, { recursive: true }) : []
  for (const file of files.map(String).filter((f) => f.endsWith(".jsonl"))) {
    const path = join(projects, file)
    if (statSync(path).mtimeMs < since) continue
    for (const line of (await Bun.file(path).text()).split("\n")) {
      if (!line.includes('"Bash"')) continue
      let entry: { cwd?: unknown; message?: { content?: unknown }; timestamp?: string }
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (Date.parse(entry.timestamp ?? "") < since || typeof entry.cwd !== "string") continue
      const content = Array.isArray(entry.message?.content) ? entry.message.content : []
      for (const part of content as {
        input?: { command?: unknown }
        name?: string
        type?: string
      }[])
        if (
          part?.type === "tool_use" &&
          part.name === "Bash" &&
          typeof part.input?.command === "string"
        )
          found.set(`${entry.cwd}\0${part.input.command}`, {
            command: part.input.command,
            cwd: entry.cwd,
          })
    }
  }
  return [...found.values()]
}

// Each call from its own folder through both hooks: the same, newly allowed and newly refused
export async function replay(
  canary: Check,
  head: Check,
  list: Call[],
  home: string,
  main?: string,
) {
  const counts = { calls: list.length, "newly allowed": 0, "newly refused": 0, same: 0 }
  const changed: string[] = []
  for (const call of list) {
    const [was, now] = [
      await allows(canary, call, home, main),
      await allows(head, call, home, main),
    ]
    if (was === now) counts.same++
    else {
      counts[now ? "newly allowed" : "newly refused"]++
      changed.push(`${now ? "allowed" : "refused"} ${call.cwd} :: ${call.command.slice(0, 300)}`)
    }
  }
  return { changed, counts }
}

const git = (cwd: string, args: string[]) => {
  const run = Bun.spawnSync(["git", ...args], { cwd, stderr: "pipe", stdout: "pipe" })
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString().trim()}`)
  return run.stdout.toString().trim()
}

// canary's whole tree at the sha, installed from its own lockfile with no install scripts in a folder of its own, then renamed to `base/<sha>`, so its hooks load canary's packages, extensions/core and dependencies, never the head's, and two runs against one sha never install into the same folder
export function canaryTree({
  base,
  root,
  run,
  sha,
}: {
  base: string
  root: string
  run: (argv: string[], cwd: string, stdin?: Uint8Array) => { exitCode: number; stdout: Uint8Array }
  sha: string
}): string {
  const dir = join(base, sha)
  if (existsSync(join(dir, ".installed"))) return dir
  mkdirSync(base, { recursive: true })
  const build = mkdtempSync(join(base, `${sha}.`))
  const archive = run(["git", "archive", sha], root)
  if (
    archive.exitCode !== 0 ||
    run(["tar", "-x", "-C", build], build, archive.stdout).exitCode !== 0
  )
    throw new Error(`could not unpack ${sha}`)
  if (run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], build).exitCode !== 0)
    throw new Error(`could not install ${sha}'s dependencies in ${build}`)
  writeFileSync(join(build, ".installed"), "")
  try {
    renameSync(build, dir)
  } catch (error) {
    if (!existsSync(join(dir, ".installed"))) throw error
  }
  return dir
}

const option = (args: string[], name: string) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}

type Options = {
  formsAt?: string
  fresh: boolean
  hooks: string[]
  hours: number
  mode: "replay" | "sweep"
  ref: string
}

export function parse(args: string[]): Options | undefined {
  const [mode] = args
  const ref = option(args, "--canary")
  const hooks = args.flatMap((a, i) => (args[i - 1] === "--hook" ? [a] : []))
  const formsAt = option(args, "--forms")
  const hours = Number(option(args, "--hours") ?? 24)
  if (
    (mode !== "sweep" && mode !== "replay") ||
    !ref ||
    hooks.length === 0 ||
    (mode === "sweep" && !formsAt) ||
    !(hours > 0)
  )
    return undefined
  return { formsAt, fresh: args.includes("--fresh"), hooks, hours, mode, ref }
}

// The newest mtime of the transcripts under `projects`, so a replay's key moves with each new call
const newest = (projects: string) =>
  existsSync(projects)
    ? Math.max(
        0,
        ...readdirSync(projects, { recursive: true })
          .map(String)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => statSync(join(projects, f)).mtimeMs),
      )
    : 0

type Key = { canary: string; head: string; input: string; key: string }

// The head's tree when the worktree has no modified or untracked file
const cleanTree = (root: string) =>
  git(root, ["status", "--porcelain", "--untracked-files=all"]) === ""
    ? git(root, ["rev-parse", "HEAD^{tree}"])
    : undefined

const formsBlob = (root: string, options: Options) =>
  git(root, ["hash-object", resolve(options.formsAt!)])

// A run's key: the head's tree at a clean worktree, the canary sha, the mode with its inputs (the forms module's blob, or the hours and the newest transcript) and the sorted hooks; a worktree with any modified or untracked file has none
export function keyOf({
  canary,
  options,
  projects,
  root,
}: {
  canary: string
  options: Options
  projects: string
  root: string
}): Key | undefined {
  const head = cleanTree(root)
  if (!head) return undefined
  const input =
    options.mode === "sweep" ? formsBlob(root, options) : `${options.hours}:${newest(projects)}`
  const key = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify([head, canary, options.mode, input, options.hooks.toSorted()]))
    .digest("hex")
    .slice(0, 16)
  return { canary, head, input, key }
}

// Whether the worktree is still clean at the key's tree, and a sweep's forms module still the key's blob, so a run whose inputs moved under it stores nothing
export const unmoved = (root: string, found: Key, options: Options) =>
  cleanTree(root) === found.head &&
  (options.mode !== "sweep" || formsBlob(root, options) === found.input)

type Result = { at: string; canary: string; changed: string[]; counts: string[]; head: string }

export const resultPath = (data: string, key: string) =>
  join(data, "hook-differential", "results", `${key}.json`)

// The result stored under the key, while it is under a day old
export async function stored(
  data: string,
  key: string,
  now = Date.now(),
): Promise<Result | undefined> {
  const file = Bun.file(resultPath(data, key))
  if (!(await file.exists())) return undefined
  const result: Result = await file.json()
  return now - Date.parse(result.at) < DAY ? result : undefined
}

export async function store(
  data: string,
  { canary, head, key }: Key,
  result: Pick<Result, "changed" | "counts">,
) {
  await Bun.write(
    resultPath(data, key),
    JSON.stringify({ at: new Date().toISOString(), canary, head, ...result }),
  )
}

const projectsOf = (env: Record<string, string | undefined>, home: string) =>
  join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "projects")

const commitOf = (root: string, ref: string) =>
  git(root, ["rev-parse", "--verify", `${ref}^{commit}`])

// The stored result a run with these options would reproduce, printed under its `reused:` line; false when it runs fresh
export async function reuse(args: string[], cwd: string, env: Record<string, string | undefined>) {
  const options = parse(args)
  if (!options || options.fresh) return false
  const home = env.HOME || homedir()
  let found: Key | undefined
  let result: Result | undefined
  try {
    const root = git(cwd, ["rev-parse", "--show-toplevel"])
    const canary = commitOf(root, options.ref)
    found = keyOf({ canary, options, projects: projectsOf(env, home), root })
    result = found && (await stored(dataDirOf(env, home), found.key))
  } catch {
    return false
  }
  if (!found || !result) return false
  console.log(
    `reused: ${found.key} from ${result.at}, head ${result.head}, canary ${result.canary}`,
  )
  for (const line of result.counts) console.log(line)
  for (const line of result.changed) console.error(line)
  return true
}

async function main(args: string[]): Promise<number> {
  const options = parse(args)
  if (!options) {
    console.error(USAGE)
    return 2
  }
  const { formsAt, hooks, hours, mode, ref } = options
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"])
  const missing = hooks.filter((h) => !existsSync(join(root, "scripts/hooks", `${h}.ts`)))
  if (missing.length > 0) {
    console.error(`hook-differential: no hook named ${missing.join(", ")} in scripts/hooks`)
    return 2
  }
  const home = process.env.HOME || homedir()
  const sha = commitOf(root, ref)
  const projects = projectsOf(process.env, home)
  const found = keyOf({ canary: sha, options, projects, root })
  const forms: Form[] = formsAt ? (await import(resolve(formsAt))).forms : []
  if (mode === "sweep" && !Array.isArray(forms)) {
    console.error(`hook-differential: the --forms module exports no forms array\n${USAGE}`)
    return 2
  }
  const before = canaryTree({
    base: join(tmpdir(), "hook-differential"),
    root,
    run: (argv, cwd, stdin) =>
      Bun.spawnSync(argv, { cwd, stderr: "inherit", stdin, stdout: "pipe" }),
    sha,
  })
  const absent = hooks.filter((h) => !existsSync(join(before, "scripts/hooks", `${h}.ts`)))
  if (absent.length > 0) {
    console.error(`hook-differential: canary has no hook named ${absent.join(", ")} to compare`)
    return 2
  }
  const list = mode === "replay" ? await calls(projects, Date.now() - hours * 3600 * 1000) : []
  const headMain = dirname(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))
  const result = { changed: [] as string[], counts: [] as string[] }
  for (const hook of hooks) {
    const canary: Check = (await import(join(before, "scripts/hooks", `${hook}.ts`))).check
    const head: Check = (await import(join(root, "scripts/hooks", `${hook}.ts`))).check
    const main = TAKES_MAIN.includes(hook) ? headMain : undefined
    const { changed, counts } =
      mode === "sweep"
        ? await sweep(canary, head, forms, home, main)
        : await replay(canary, head, list, home, main)
    result.counts.push(JSON.stringify({ hook, ...counts }))
    console.log(result.counts.at(-1))
    for (const line of changed.slice(0, 20)) {
      result.changed.push(`${hook}: ${line}`)
      console.error(result.changed.at(-1))
    }
  }
  if (found && unmoved(root, found, options))
    await store(dataDirOf(process.env, home), found, result)
  return 0
}

if (import.meta.main) {
  if (await reuse(process.argv.slice(2), process.cwd(), process.env)) process.exit(0)
  const home = process.env.HOME || homedir()
  const argv = routed({
    argv: ["bun", import.meta.path, ...process.argv.slice(2)],
    cwd: process.cwd(),
    env: process.env,
    executable: (path) => {
      try {
        accessSync(path, constants.X_OK)
        return true
      } catch {
        return false
      }
    },
    home,
  })
  if (argv[0] === "bun") process.exit(await main(process.argv.slice(2)))
  const room = Bun.spawnSync([argv[0]!, "room"], {
    stderr: "ignore",
    stdout: "pipe",
    timeout: 10_000,
  })
  const waiting =
    (room.exitCode === 0 && /^\d+ \d+ \d+ (\d+)$/.exec(room.stdout.toString().trim())?.[1]) || "?"
  console.error(`hook-differential: queued through run-slot behind ${waiting} waiting`)
  process.exit(await Bun.spawn(argv, { stdio: ["inherit", "inherit", "inherit"] }).exited)
}
