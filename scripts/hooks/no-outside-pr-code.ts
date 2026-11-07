// PreToolUse hook: refuses a reviewer or tester session (role.ts), its sub-agents included, a Bash or Monitor line that touches an outside author's PR clone unless every command on it only reads or moves the clone to a head, since running the PR's tests, scripts or installs runs its author's code on this machine; reading it passes, by the Read, Grep and Glob tools or read-only.ts's shapes.
import "../../packages/env/src/aliases"
import { mkdirSync, readdirSync } from "node:fs"
import { basename, dirname, join, resolve, sep } from "node:path"

import { dataDirOf } from "../../packages/env/src/data-dir"
import { mainCheckout } from "./no-main-checkout"
import { readsWords } from "./read-only"
import { sessionRole } from "./role"
import {
  type Command,
  type Env,
  examine,
  knownVariables,
  lex,
  marked,
  type Parsed,
  pathOf,
  places,
  run,
  slotWords,
  type Visit,
  type Word,
} from "./shell"

type Environment = Record<string, string | undefined>
type Pr = { author: string; owner: string; ownerType: string }

// What the hook reads off the machine and GitHub, a seam its tests fill with made-up clones.
export type Lookup = {
  author: (repo: string, pr: number) => Promise<Pr | undefined>
  clones: () => Promise<string[]>
  repoOf: (folder: string) => Promise<string | undefined>
}

const CHECKERS = new Set(["reviewer", "tester"])
const TOOLS = new Set(["Bash", "Monitor"])
// A review clone's folder as the reviewer brief names it: review-<n>, or review-<repo>-<n> for a repo with no local checkout.
const CLONE = /^review-(?:[\w.-]+-)?(\d+)$/
const GLOB = /[*?[{]/
const SPECIAL = /[*?[{()$]/
const WAIT_MS = 5000

// The clone folder a path sits in, itself included, or undefined outside every clone.
function cloneOf(path: string): string | undefined {
  for (let at = path; at !== dirname(at); at = dirname(at)) if (CLONE.test(basename(at))) return at
}

// The literal git forms that move a clone to a PR's head without running a file it holds: a fetch by remote and refspec, a detached checkout or switch, and the clone's own `worktree add`.
function movesClone(words: string[]): boolean {
  if (words[0] !== "git") return false
  const [sub, ...rest] = words.slice(words[1] === "-C" ? 3 : 1)
  const plain = (w: string) => !w.startsWith("-") && !w.includes("::")
  if (sub === "fetch") return rest.every(plain)
  if (sub === "checkout" || sub === "switch")
    return rest.length === 2 && rest[0] === "--detach" && plain(rest[1])
  if (sub !== "worktree" || rest[0] !== "add") return false
  const operands = rest[1] === "--detach" ? rest.slice(2) : rest.slice(1)
  return operands.length === 2 && operands.every(plain)
}

// Whether one reading of a command only reads or moves the clone: a bare program name (a path could name the PR's own script), no variable set for it, no redirect and no word the reader cannot see whole.
function harmless(cmd: Command, parsed: Parsed): boolean {
  if (parsed.name === "") return parsed.args.length === 0
  if (cmd.redirects.length > 0 || parsed.local.size > 0) return false
  if (parsed.first?.value.includes("/")) return false
  const words = [parsed.name, ...parsed.args.map((a) => a.value)]
  if (words.some((w) => marked(w) || SPECIAL.test(w))) return false
  return readsWords(words) || movesClone(words)
}

// Each path a word may name: the word itself and what follows an `=` in it, cut at its first glob character, so `--cwd=<dir>` and `review-5*` name their folders.
function namedPaths(word: Word, here: Env): string[] | undefined {
  if (word.unknown || marked(word.value)) return
  const parts = word.value.includes("=")
    ? [word.value, word.value.slice(word.value.indexOf("=") + 1)]
    : [word.value]
  const paths: string[] = []
  for (const part of parts) {
    const cut = word.glob && GLOB.test(part) ? part.slice(0, part.search(GLOB)) : part
    const path = cut === "" ? here.cwd : pathOf({ value: cut }, here)
    if (path) paths.push(resolve(path))
  }
  return paths
}

export async function inspect(
  command: string,
  directory: string | undefined,
  environment: Environment,
  lookup: Lookup,
): Promise<string | undefined> {
  const verdicts = new Map<string, Promise<boolean>>()
  // An outside clone: its PR's author is not the repo's owner, on a repo a user owns (an org repo's PRs are its colleagues'); a PR the hook cannot read counts as outside.
  const outside = (clone: string): Promise<boolean> => {
    let verdict = verdicts.get(clone)
    if (!verdict) {
      verdict = (async () => {
        const repo = await lookup.repoOf(clone)
        const pr = repo && (await lookup.author(repo, Number(CLONE.exec(basename(clone))![1])))
        if (!pr) return true
        return pr.ownerType === "User" && pr.author.toLowerCase() !== pr.owner.toLowerCase()
      })()
      verdicts.set(clone, verdict)
    }
    return verdict
  }
  let listed: Promise<string[]> | undefined
  const outsideClones = (): Promise<string[]> =>
    (listed ??= lookup.clones().then(async (all) => {
      const flags = await Promise.all(all.map(outside))
      return all.filter((_, k) => flags[k])
    }))
  const inOutside = async (path: string) => {
    const clone = cloneOf(path)
    return clone !== undefined && (await outside(clone))
  }
  const holdsOutside = async (path: string) => {
    const prefix = path.endsWith(sep) ? path : path + sep
    return (await outsideClones()).some((clone) => clone.startsWith(prefix))
  }

  let touched = false
  let harmlessLine = true
  const touches = async (parsed: Parsed, here: Env): Promise<boolean> => {
    const folder = parsed.chdir ? pathOf(parsed.chdir, here) : here.cwd
    let blind = folder === undefined || here.cwdAnywhere === true || here.cwdUnread === true
    if (folder !== undefined && (await inOutside(resolve(folder)))) return true
    for (const word of parsed.args) {
      const paths = namedPaths(word, here)
      if (!paths) blind = true
      for (const path of paths ?? [])
        if ((await inOutside(path)) || (await holdsOutside(path))) return true
    }
    return blind && (await outsideClones()).length > 0
  }
  const visit: Visit = async (cmd, parsed, env) => {
    const slot = slotWords(parsed)
    if (slot)
      return slot.length === 0 ? undefined : examine({ ...cmd, words: slot }, env, visit, false)
    for (const reading of [parsed, ...parsed.also]) {
      if (!harmless(cmd, reading)) harmlessLine = false
      if (touched) continue
      for (const here of places(env, directory)) if (await touches(reading, here)) touched = true
    }
  }
  const variables = knownVariables(command, environment, directory)
  const env: Env = {
    cwd: directory,
    cwdSure: directory,
    files: new Map(),
    known: variables,
    old: { dir: directory },
    process: environment,
    vars: new Map(),
  }
  await run(lex(command, variables), env, visit, true)
  if (!touched || harmlessLine) return
  return "no-outside-pr-code hook refuses a reviewer or tester running an outside author's PR code: this line touches the clone of a PR whose author is not the repo's owner, and a test run, a script, a build, an install or a copy out of it runs that author's code on this machine. Read the PR instead: the Read, Grep and Glob tools, gh pr diff, or git diff, log and show in the clone; move the clone to a new head with git fetch <remote> <ref> and git checkout --detach <rev>. Score what the PR's own GitHub checks ran, and say in the verdict that its code was read, not run."
}

export async function check(
  raw: string,
  environment: Environment = process.env,
  lookup: Lookup = live(environment),
): Promise<string | undefined> {
  let input: Record<string, unknown>
  try {
    input = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  const { cwd, session_id: sessionId, tool_input: toolInput, tool_name: tool } = input
  if (typeof tool !== "string" || !TOOLS.has(tool)) return
  const command = (toolInput as { command?: unknown } | undefined)?.command
  if (typeof command !== "string") return
  if (!CHECKERS.has(await sessionRole(environment, sessionId))) return
  try {
    return await inspect(command, typeof cwd === "string" ? cwd : undefined, environment, lookup)
  } catch {
    return "no-outside-pr-code hook cannot read this line, so it cannot rule out an outside author's PR clone. Run it as plain commands with literal folders."
  }
}

async function output(argv: string[]): Promise<string | undefined> {
  const child = Bun.spawn(argv, { stderr: "ignore", stdout: "pipe" })
  const timer = setTimeout(() => child.kill(), WAIT_MS)
  try {
    const text = await new Response(child.stdout).text()
    return (await child.exited) === 0 ? text.trim() : undefined
  } finally {
    clearTimeout(timer)
  }
}

// The machine's own lookup: a clone's origin by git, a PR's author by gh, kept in the data folder once read since it never changes, and the clones under the main checkout's worktrees folder.
export function live(environment: Environment): Lookup {
  const cache = join(dataDirOf(environment), "hook-outside-pr")
  const trees = join(mainCheckout(resolve(import.meta.dir, "..", "..")), ".claude", "worktrees")
  return {
    author: async (repo, pr) => {
      const file = join(cache, `${repo.replace("/", "__")}__${pr}.json`)
      try {
        return (await Bun.file(file).json()) as Pr
      } catch {}
      const jq =
        "{author: .user.login, owner: .base.repo.owner.login, ownerType: .base.repo.owner.type}"
      const text = await output(["gh", "api", `repos/${repo}/pulls/${pr}`, "--jq", jq])
      if (!text) return
      const read = JSON.parse(text) as Pr
      if (typeof read.author !== "string" || typeof read.owner !== "string") return
      try {
        mkdirSync(cache, { recursive: true })
        await Bun.write(file, JSON.stringify(read))
      } catch {}
      return read
    },
    clones: async () => {
      try {
        return readdirSync(trees)
          .filter((name) => CLONE.test(name))
          .map((name) => join(trees, name))
      } catch {
        return []
      }
    },
    repoOf: async (folder) => {
      const url = await output(["git", "-C", folder, "remote", "get-url", "origin"])
      return url && /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url)?.[1]
    },
  }
}

if (import.meta.main) {
  const reason = await check(await Bun.stdin.text())
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
