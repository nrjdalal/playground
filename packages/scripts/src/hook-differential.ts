import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"

// Measures a head's hooks against a canary sha, each form or call reaching each hook's check() as data alone and never run: `sweep --forms <module>` passes the forms a module exports from the home, the data folder and a worktree, `replay` the last day's Bash calls from this machine's transcripts; started bare it queues itself through run-slot, as commit-slot.ts queues a commit's build.

export type Check = (
  raw: string,
  env: Record<string, string | undefined>,
) => Promise<string | undefined> | string | undefined
type Form = { command: string; inClass?: boolean }
type Call = { command: string; cwd: string }
type Tally = { inClass: number; outClass: number }

const USAGE =
  "usage: bun run hooks:differential <sweep --forms <module> | replay [--hours <n>]> --canary <sha> --hook <name> [--hook <name> ...]"

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

const allows = async (check: Check, call: Call, home: string) =>
  (await check(
    JSON.stringify({ cwd: call.cwd, tool_input: { command: call.command }, tool_name: "Bash" }),
    {
      HOME: home,
    },
  )) === undefined

// Each form from each folder through both hooks: the same, newly allowed and newly refused, each split by the form's class (a form with no class is outside it)
export async function sweep(canary: Check, head: Check, forms: Form[], home: string) {
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
        await allows(canary, { command, cwd }, home),
        await allows(head, { command, cwd }, home),
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
export async function replay(canary: Check, head: Check, list: Call[], home: string) {
  const counts = { calls: list.length, "newly allowed": 0, "newly refused": 0, same: 0 }
  const changed: string[] = []
  for (const call of list) {
    const [was, now] = [await allows(canary, call, home), await allows(head, call, home)]
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

// canary's whole tree at the sha, installed from its own lockfile with no install scripts, once per sha in `base`, so its hooks load canary's packages, extensions/core and dependencies, never the head's
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
  mkdirSync(dir, { recursive: true })
  const archive = run(["git", "archive", sha], root)
  if (archive.exitCode !== 0 || run(["tar", "-x", "-C", dir], dir, archive.stdout).exitCode !== 0)
    throw new Error(`could not unpack ${sha}`)
  if (run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], dir).exitCode !== 0)
    throw new Error(`could not install ${sha}'s dependencies in ${dir}`)
  writeFileSync(join(dir, ".installed"), "")
  return dir
}

const option = (args: string[], name: string) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}

async function main(args: string[]): Promise<number> {
  const [mode] = args
  const ref = option(args, "--canary")
  const hooks = args.flatMap((a, i) => (args[i - 1] === "--hook" ? [a] : []))
  const formsAt = option(args, "--forms")
  if (
    (mode !== "sweep" && mode !== "replay") ||
    !ref ||
    hooks.length === 0 ||
    (mode === "sweep" && !formsAt)
  ) {
    console.error(USAGE)
    return 2
  }
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"])
  const missing = hooks.filter((h) => !existsSync(join(root, "scripts/hooks", `${h}.ts`)))
  if (missing.length > 0) {
    console.error(`hook-differential: no hook named ${missing.join(", ")} in scripts/hooks`)
    return 2
  }
  const home = process.env.HOME || homedir()
  const before = canaryTree({
    base: join(tmpdir(), "hook-differential"),
    root,
    run: (argv, cwd, stdin) =>
      Bun.spawnSync(argv, { cwd, stderr: "inherit", stdin, stdout: "pipe" }),
    sha: git(root, ["rev-parse", "--verify", `${ref}^{commit}`]),
  })
  const forms: Form[] = formsAt ? (await import(resolve(formsAt))).forms : []
  if (mode === "sweep" && !Array.isArray(forms)) {
    console.error(`hook-differential: the --forms module exports no forms array\n${USAGE}`)
    return 2
  }
  const hours = Number(option(args, "--hours") ?? 24)
  const projects = join(process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "projects")
  const list = mode === "replay" ? await calls(projects, Date.now() - hours * 3600 * 1000) : []
  for (const hook of hooks) {
    const canary: Check = (await import(join(before, "scripts/hooks", `${hook}.ts`))).check
    const head: Check = (await import(join(root, "scripts/hooks", `${hook}.ts`))).check
    const { changed, counts } =
      mode === "sweep"
        ? await sweep(canary, head, forms, home)
        : await replay(canary, head, list, home)
    console.log(JSON.stringify({ hook, ...counts }))
    for (const line of changed.slice(0, 20)) console.error(`${hook}: ${line}`)
  }
  return 0
}

if (import.meta.main) {
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
  const room = Bun.spawnSync([argv[0]!, "room"], { stderr: "ignore", stdout: "pipe" })
  const waiting = room.stdout.toString().trim().split(/\s+/)[3] ?? "?"
  console.error(`hook-differential: queued through run-slot behind ${waiting} waiting`)
  process.exit(await Bun.spawn(argv, { stdio: ["inherit", "inherit", "inherit"] }).exited)
}
