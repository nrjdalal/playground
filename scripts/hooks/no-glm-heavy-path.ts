// PreToolUse hook, acting for a factory session (role.ts) that runs on GLM alone: refuses a git commit whose staged files, or a git push whose commits the remote does not hold, touch a path that is Opus work (GLM was handed UI work three times, against "truly tiny" mechanical work only), and while load5 is over glm.readOnlyLoad5 (15 by default) any install, node_modules clone, commit or push (a GLM worker pushed twice at load5 20 to 30), and, by the glm rule, a headless Claude run and every org tool. It fails closed on a commit or push whose file list it cannot read and on an org tool whose repository or policy it cannot read, and passes every other call.

import { readFileSync } from "node:fs"
import { loadavg } from "node:os"
import { dirname, join, resolve } from "node:path"

import { dataDir } from "../../packages/env/src/data-dir"
import { guardedOrgs } from "../../packages/settings/src/ext"
import { readPolicy } from "../../packages/settings/src/rendered"
import { ruleSettings } from "../../packages/settings/src/rules"
import { implicitRepos, remotes, repoOf } from "./github"
import { headless } from "./no-headless-login"
import { fromFactory, registryName, sessionOf } from "./role"
import {
  type Command,
  type Env,
  examine,
  GIT_TAKES,
  knownVariables,
  lex,
  marked,
  parseFlags,
  type Parsed,
  pathOf,
  program,
  pythonModule,
  run,
  slotWords,
  UV_TAKES,
  unknown,
  unreadable,
  type Text,
  type Visit,
  type Word,
} from "./shell"

type Environment = Record<string, string | undefined>

// Opus work, A to Z: a path ending in / covers everything under it.
const OPUS_PATHS = [
  ".github/workflows/",
  "lefthook.yml",
  "packages/scripts/src/pr-merge/",
  "packages/scripts/src/verify/",
  "scripts/hooks/",
  "scripts/spawn.sh",
  "web/next/",
]

const COMMIT_TAKES = new Set([
  "--author",
  "-c",
  "-C",
  "--cleanup",
  "--date",
  "-F",
  "--file",
  "--fixup",
  "-m",
  "--message",
  "--pathspec-from-file",
  "--reedit-message",
  "--reuse-message",
  "--squash",
  "-t",
  "--template",
  "--trailer",
])
// git's empty tree, which a first commit is read against
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
const ADD_TAKES = new Set(["--chmod", "--pathspec-from-file"])
const PUSH_TAKES = new Set(["--exec", "-o", "--push-option", "--receive-pack", "--repo"])
// The owner's rule: a GLM session goes read-only while load5 is over glm.readOnlyLoad5, read at each call so a change takes the next one; its default while the policy cannot be read.
const loadLimit = async (environment: Environment): Promise<number> => {
  const read = await readPolicy(dataDir(environment)).catch(() => undefined)
  return ruleSettings.get(read?.settings ?? { schemaVersion: 1, values: {} }, "glm.readOnlyLoad5")
}
const currentLoad5 = () => loadavg()[1]
const INSTALLS = new Set([
  "add",
  "ci",
  "cit",
  "i",
  "install",
  "install-ci-test",
  "install-test",
  "it",
  "up",
  "update",
])
// flags that make a bare yarn print rather than install
const YARN_INFO = new Set(["-h", "--help", "-v", "--version"])
const PIP = /^pip(?:\d+(?:\.\d+)*)?$/
const PACKAGE_MANAGERS = new Set(["bun", "npm", "pnpm", "yarn"])
const RUNNER_TAKES = new Set([
  "-C",
  "--cwd",
  "--dir",
  "-F",
  "--filter",
  "--prefix",
  "-w",
  "--workspace",
])
const COPIERS = new Set(["cp", "ditto", "rsync"])
// what a busy machine's refusal can match, read before the call is parsed
const BUSY_RUN = /\b(?:bun|cp|ditto|npm|pip[\d.]*|pipx|pnpm|python[\d.]*|rsync|uv|yarn)\b/i
// in any case, since macOS's filesystem runs GIT as git
const GIT_CALL = /\bgit\b[\s\S]*\b(?:commit|push)\b/i
// what an org tool's refusal can match, read before the call is parsed
const ORG_CALL = /\b(?:claude|curl|dm|gh|git|https?|wget|xh)\b|linear[-:]|mcp__/i

export const heavy = (path: string): boolean =>
  OPUS_PATHS.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p))

// Whether the session runs on GLM: spawn.sh's GLM launch points ANTHROPIC_BASE_URL at api.z.ai, else the backend pin spawn.sh keeps under the session's registry name reads glm.
export async function onGlm(raw: string, environment: Environment = process.env): Promise<boolean> {
  if (/(?:^|\/\/|\.)api\.z\.ai(?:[:/]|$)/.test(environment.ANTHROPIC_BASE_URL ?? "")) return true
  const id = sessionOf(raw)
  if (typeof id !== "string") return false
  try {
    const name = await registryName(id, environment)
    if (!name || name.includes("/")) return false
    const pin = join(dataDir(environment), "backends", name)
    return (await Bun.file(pin).text()).trim() === "glm"
  } catch {
    return false
  }
}

const refuse = (what: string, files: string[]) =>
  `no-glm-heavy-path hook refuses this ${what}: it touches ${files.join(", ")}, which is Opus work, and this session runs on GLM. Stop, report to your lead with this file list, and the lead moves the change to a Claude worker.`

const unread = (what: string, why: string) =>
  `no-glm-heavy-path hook refuses this ${what}: it cannot read ${why}, and this session runs on GLM, whose commits and pushes must stay off Opus paths. Run it again from your own worktree with a literal path, or report to your lead.`

const loaded = (what: string, load5: number, limit: number) =>
  `no-glm-heavy-path hook refuses this ${what}: load5 is ${load5.toFixed(1)}, and a GLM session goes read-only while load5 is over ${limit} (no install, node_modules clone, commit or push). Wait until load5 is ${limit} or under (the middle figure of sysctl -n vm.loadavg), then run it again, or report to your lead.`

// The install or node_modules clone a command runs, named for its refusal; a clone is read as run-slot.sh reads cp's.
function installOrClone(name: string, args: Word[]): string | undefined {
  if (COPIERS.has(name))
    return args.some((a) => /(?:^|\/)node_modules$/.test(a.value.replace(/\/(?:\.|\*)?$/, "")))
      ? "node_modules clone"
      : undefined
  const python = pythonModule(name, args)
  if (python) return PIP.test(python.module) ? installOrClone("pip", python.rest) : undefined
  const { flags, positionals } = parseFlags(args, name === "uv" ? UV_TAKES : RUNNER_TAKES)
  const [sub, next] = positionals.map((w) => w.value)
  // uv run runs its first positional after run, with the words after it
  if (name === "uv" && sub === "run" && next !== undefined)
    return installOrClone(program(next), args.slice(args.indexOf(positionals[1]) + 1))
  if (name === "yarn" && sub === undefined && !flags.some((f) => YARN_INFO.has(f.name)))
    return "yarn install"
  if (name === "yarn" && sub === "global" && next === "add") return "yarn global add"
  // yarn workspace <name> runs the words after the workspace's name
  if (name === "yarn" && sub === "workspace" && next !== undefined)
    return installOrClone("yarn", args.slice(args.indexOf(positionals[1]) + 1))
  // bun upgrade updates bun itself, where npm's and yarn's upgrade dependencies
  const upgrade = sub === "upgrade" && name !== "bun"
  if (PACKAGE_MANAGERS.has(name) && sub !== undefined && (INSTALLS.has(sub) || upgrade))
    return `${name} ${sub}`
  if (name === "uv" && (sub === "add" || sub === "sync")) return `uv ${sub}`
  if (name === "uv" && sub === "pip" && (next === "install" || next === "sync"))
    return `uv pip ${next}`
  if (name === "uv" && sub === "tool" && next === "install") return "uv tool install"
  if ((PIP.test(name) || name === "pipx") && sub === "install") return `${name} install`
}

// What a git read lists, one a line (NUL-separated for paths), or null when the read fails.
function names(dir: string, args: string[], separator = "\n"): string[] | null {
  const proc = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stderr: "ignore",
  })
  if (proc.exitCode !== 0) return null
  return proc.stdout
    .toString()
    .split(separator)
    .filter((line) => line !== "")
}

// The paths a git read lists, read with -z, since a line lists a path holding a non-ASCII byte, a tab, " or \ quoted and escaped.
const pathsOf = (dir: string, [sub, ...rest]: string[]) => names(dir, [sub, "-z", ...rest], "\0")

const plain = (w: Word) => !unreadable(w)

// The files a side changed since its merge base with ours, or null when a read fails.
function changedBy(dir: string, ours: string, theirs: string): string[] | null {
  const base = names(dir, ["merge-base", ours, theirs])?.[0]
  return base ? pathsOf(dir, ["diff", "--name-only", "--no-renames", base, theirs]) : null
}

// The commits a merge being concluded brings in, one a side (an octopus has several), or null when they cannot be read.
async function mergeHeads(dir: string): Promise<string[] | null> {
  const path = names(dir, ["rev-parse", "--git-path", "MERGE_HEAD"])?.[0]
  if (!path) return null
  const file = Bun.file(resolve(dir, path))
  if (!(await file.exists())) return []
  return (await file.text()).split("\n").filter((line) => line.trim() !== "")
}

// A commit after git add or a git read is judged with every change on disk, which is all git add can stage; after any other command, or a push after any command, what that command will make cannot be read before the call runs.
const STAGING = new Set(["add", "diff", "log", "show", "status"])
// The reads of the current branch's name a push names its ref by, which never chain
const BRANCH_READS = new Set(["branch --show-current", "rev-parse --abbrev-ref HEAD"])
const SUBSTITUTION = unknown("a command substitution")
// Commands that make no file unless a redirect writes one, so they never chain, wherever they sit: the commit message's own `$(cat <<'EOF' ... EOF)` among them, whose command the reader visits before the commit's.
const PURE = new Set(["cat", "date", "echo", "printf", "pwd", "true"])
const writes = (cmd: Command) =>
  cmd.redirects.some(
    (r) => r.op.includes(">") && !/^(?:\d+|-|\/dev\/null)$/.test(r.target?.value ?? ""),
  )

const chainRefusal = (what: string, made: string) =>
  `no-glm-heavy-path hook refuses this ${what}: it runs after another command in the same call, which may make ${made} before it runs, and the hook reads the checkout before the call starts, while this session runs on GLM. Run ${what} as its own call${what === "git commit" ? ", or after git add alone" : ""}.`

async function commit(
  rest: Word[],
  dir: string,
  chained: boolean,
  forced: string[],
): Promise<string | undefined> {
  const { flags, positionals } = parseFlags(rest, COMMIT_TAKES)
  if (positionals.some((w) => !plain(w)))
    return unread("git commit", "the paths it names, built at run time")
  if (flags.some((f) => f.name === "--pathspec-from-file"))
    return unread("git commit", "the paths --pathspec-from-file names")
  const all = flags.some((f) => f.name === "-a" || f.name === "--all")
  const paths = positionals.map((w) => w.value)
  // -a commits every tracked change, a path named on the command line commits that file as it stands, and a git add chained before may stage any change on disk, untracked files included, and ignored ones after git add -f
  const worktree = all || paths.length > 0 || chained
  const untracked = chained
    ? pathsOf(dir, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--full-name",
        "--",
        ...(paths.length > 0 ? paths : [":(top)"]),
      ])
    : []
  // git add -f stages ignored files too, but only under the paths it names
  const ignored =
    chained && forced.length > 0
      ? pathsOf(dir, [
          "ls-files",
          "--others",
          "--ignored",
          "--exclude-standard",
          "--full-name",
          "--",
          ...forced,
        ])
      : []
  if (untracked === null || ignored === null) return unread("git commit", "the files it commits")
  untracked.push(...ignored)
  const against = (base: string) => [
    pathsOf(dir, ["diff", "--cached", "--name-only", "--no-renames", base]),
    ...(worktree
      ? [pathsOf(dir, ["diff", base, "--name-only", "--no-renames", "--", ...paths])]
      : []),
    untracked,
  ]
  const born = names(dir, ["rev-parse", "-q", "--verify", "HEAD"]) !== null
  const lists = against(born ? "HEAD" : EMPTY_TREE)
  if (lists.some((l) => l === null)) return unread("git commit", "the files it commits")
  const heads = await mergeHeads(dir)
  if (heads === null) return unread("git commit", "the merge it concludes")
  const sides = heads.map((head) => ({
    changed: changedBy(dir, "HEAD", head),
    differs: against(head),
  }))
  if (sides.some((s) => [s.changed, ...s.differs].some((l) => l === null)))
    return unread("git commit", "the files it commits")
  const differ = sides.map((s) => new Set(s.differs.flat() as string[]))
  // concluding a merge, a file a side brought in as it stands is not this session's work, so only what differs from every side counts
  const files = new Set(
    [...new Set(lists.flat() as string[])].filter((f) => differ.every((d) => d.has(f))),
  )
  // and a file a side changed that the result does not take, since the squash would revert that side's change
  sides.forEach((side, i) => {
    for (const file of side.changed as string[]) if (differ[i].has(file)) files.add(file)
  })
  const heavyFiles = [...files].filter(heavy).sort()
  if (heavyFiles.length === 0) return
  // read from disk alone for the chain's sake, an Opus file may be one the git add before never stages
  const staged = new Set(lists[0] as string[])
  if (chained && !all && paths.length === 0 && heavyFiles.every((f) => !staged.has(f)))
    return `no-glm-heavy-path hook refuses this git commit: ${heavyFiles.join(", ")} is on disk and not staged, and the hook cannot tell before the call runs whether the git add before it stages it, while this session runs on GLM and that is Opus work. Run git commit as its own call.`
  return refuse("git commit", heavyFiles)
}

function push(rest: Word[], dir: string, branchReads: (string | undefined)[]): string | undefined {
  const { flags, positionals } = parseFlags(rest, PUSH_TAKES)
  const given = new Set(flags.map((f) => f.name))
  // each substitution that is a whole ref took one of the branch reads visited just before the push
  const reads = branchReads.filter((d) => d === dir)
  const [remote, ...refspecs] = positionals.map((w, i) =>
    i > 0 && w.unknown === SUBSTITUTION.unknown && w.value === SUBSTITUTION.value && reads.pop()
      ? { quoted: w.quoted, value: "HEAD" }
      : w,
  )
  if ([remote, ...refspecs].some((w) => w && !plain(w)))
    return `no-glm-heavy-path hook refuses this git push: it cannot read the refs it pushes, built at run time, and this session runs on GLM, whose pushes must stay off Opus paths. Run it again naming each ref literally (git push origin <branch>), or report to your lead.`
  const sources: string[] = []
  if (given.has("--all") || given.has("--branches") || given.has("--mirror"))
    sources.push("--branches")
  if (given.has("--tags") || given.has("--follow-tags") || given.has("--mirror"))
    sources.push("--tags")
  const deleting = given.has("--delete") || given.has("-d")
  for (const spec of refspecs) {
    const [source] = spec.value.replace(/^\+/, "").split(":")
    if (source !== "" && !deleting) sources.push(source)
  }
  // --follow-tags pushes the default refspec too; only these push in its place
  const replaced = ["--all", "--branches", "--mirror", "--tags"].some((f) => given.has(f))
  if (refspecs.length === 0 && !replaced) sources.push("HEAD")
  if (deleting && sources.length === 0) return
  const name = remote && !/[:/]/.test(remote.value) ? remote.value : undefined
  // a remote not fetched yet has no tracking refs, so every remote stands in for it
  const tracked = name && names(dir, ["for-each-ref", "--count=1", `refs/remotes/${name}`])?.length
  const not = tracked ? `--remotes=${name}` : "--remotes"
  // dense-combined lists what a merge commit itself changed, which plain --name-only leaves out
  const listed = pathsOf(dir, [
    "log",
    "--name-only",
    "--no-renames",
    "--diff-merges=dense-combined",
    "--format=",
    ...sources,
    "--not",
    not,
  ])
  const merges = names(dir, ["rev-list", "--merges", ...sources, "--not", not])
  if (listed === null || merges === null)
    return unread("git push", "the files of the commits it pushes")
  const files = new Set(listed)
  // a merge commit that does not take a file its other side changed reverts that change once squashed
  for (const merge of merges) {
    const [first, ...others] = names(dir, ["rev-parse", `${merge}^@`]) ?? []
    if (!first) return unread("git push", "the parents of a merge it pushes")
    for (const other of others) {
      const changed = changedBy(dir, first, other)
      const differs = pathsOf(dir, ["diff", "--name-only", "--no-renames", other, merge])
      if (changed === null || differs === null)
        return unread("git push", "the files of the commits it pushes")
      for (const file of changed) if (differs.includes(file)) files.add(file)
    }
  }
  const heavyFiles = [...files].filter(heavy).sort()
  return heavyFiles.length > 0 ? refuse("git push", heavyFiles) : undefined
}

// The pathspecs a git add -f stages ignored files under, as absolute paths: the whole checkout when it names none, or one the hook cannot read.
function forcedPaths(rest: Word[], dir: string | undefined): string[] {
  const { flags, positionals } = parseFlags(rest, ADD_TAKES)
  // git takes any unambiguous start of --force, from --f
  if (!flags.some((f) => f.name === "-f" || /^--f(?:o(?:r(?:ce?)?)?)?$/.test(f.name))) return []
  const named = !dir || flags.some((f) => f.name === "--pathspec-from-file") ? [] : positionals
  // a magic pathspec (`:(glob)...`, `:/...`) is not a path, so it reads as the whole checkout
  if (named.length === 0 || named.some((w) => !plain(w) || w.value.startsWith(":")))
    return [":(top)"]
  return named.map((w) => resolve(dir as string, w.value))
}

// The guarded orgs ext.links names, or why the policy cannot be read
type Orgs = string[] | { refusal: string }
const guardedOf = async (environment: Environment): Promise<Orgs> => {
  try {
    const read = await readPolicy(dataDir(environment))
    return read.refusal !== undefined
      ? { refusal: read.refusal }
      : guardedOrgs(read.settings.values)
  } catch (error) {
    return { refusal: String(error) }
  }
}
const LEAD =
  "Stop, report to your lead with this call, and the lead moves the task to a Claude worker."
const orgRefusal = (what: string, why: string, fix = LEAD) =>
  `no-glm-heavy-path hook refuses ${what}: ${why}, and this session runs on GLM, which the glm rule (playground rules glm) keeps off every org's tracker, chat, docs and repos and off a headless Claude run. ${fix}`
const PLACE_FIX = `Name the repository literally (--repo <owner>/<name>, or repos/<owner>/<name>/... for gh api) in a call of its own, or report to your lead.`
// An org service's hosts, each with what it is to the org
const ORG_HOSTS: [RegExp, string][] = [
  [/(?:^|[/@.])(linear\.app)(?=[:/?#]|$)/i, "tracker"],
  [/(?:^|[/@.])(notion\.(?:com|site|so))(?=[:/?#]|$)/i, "docs"],
  [/(?:^|[/@.])(slack\.com)(?=[:/?#]|$)/i, "chat"],
]
const FETCHERS = new Set(["curl", "http", "https", "wget", "xh"])
// gh api's options that take a value, so its endpoint is the first word past them
const GH_API_TAKES = new Set([
  "--cache",
  "-F",
  "-f",
  "--field",
  "-H",
  "--header",
  "--hostname",
  "--input",
  "-p",
  "--preview",
  "-q",
  "--jq",
  "--raw-field",
  "-t",
  "--template",
  "-X",
  "--method",
])
// The folders of the factory's scripts that reach an org service, outside the tests' mirror of them, each with what it is to the org: the Linear readers and writers, and the DM sender, which posts to the owner's chat
const ORG_SCRIPT_DIRS: [RegExp, string][] = [
  [
    /(?<!\/tests)\/packages\/scripts\/src\/linear-[\w-]+(?:\/|$)/,
    "a Linear script, which reads or writes an org's tracker",
  ],
  [
    /(?<!\/tests)\/packages\/scripts\/src\/dm(?:\/|$)/,
    "the DM sender, which posts to the owner's chat",
  ],
]
// The programs that run a script, and their options that name the folder they run in
const RUNNERS = new Set([
  "bash",
  "bun",
  "bunx",
  "deno",
  "node",
  "npm",
  "npx",
  "pnpm",
  "sh",
  "tsx",
  "yarn",
  "zsh",
])
const RUNNER_DIR = /^(?:--cwd|--dir|--prefix|-C)(?:=|$)/
const scriptDir = (path: string | undefined) =>
  path === undefined ? undefined : ORG_SCRIPT_DIRS.find(([at]) => at.test(path))?.[1]
// The package scripts the package.json of a folder and of each folder above it names, the nearest first, each with the folder it runs in
function packageScripts(dir: string): Map<string, { at: string; command: string }> {
  const found = new Map<string, { at: string; command: string }>()
  for (let at = dir; ; at = dirname(at)) {
    try {
      const { scripts } = JSON.parse(readFileSync(join(at, "package.json"), "utf8"))
      for (const [name, command] of Object.entries(scripts ?? {}))
        if (!found.has(name) && typeof command === "string") found.set(name, { at, command })
    } catch {}
    if (dirname(at) === at) return found
  }
}
// What org script a call runs: a runner's word that resolves into an org script's folder from the folder it runs in, or names a package script whose command does, whatever the runner; or the playground CLI's dm command
function orgScript(parsed: Parsed, env: Env): string | undefined {
  const { args, name } = parsed
  if (name === "playground" && args.find((a) => !a.value.startsWith("-"))?.value === "dm")
    return ORG_SCRIPT_DIRS[1][1]
  if (!RUNNERS.has(name)) return
  let at = env.cwd
  for (let i = 0; i < args.length; i++) {
    const flag = RUNNER_DIR.exec(args[i].value)
    if (!flag) continue
    const value = flag[0].endsWith("=")
      ? { ...args[i], value: args[i].value.slice(flag[0].length) }
      : args[++i]
    at = value ? pathOf(value, { ...env, cwd: at }) : undefined
  }
  if (!at) return
  const scripts = packageScripts(at)
  for (const a of args) {
    if (a.value.startsWith("-") || unreadValue(a)) continue
    const hit = scriptDir(pathOf(a, { ...env, cwd: at }))
    if (hit) return hit
    const script = scripts.get(a.value)
    const ran = script?.command
      .split(/\s+/)
      .map((word) => scriptDir(resolve(script.at, word)))
      .find(Boolean)
    if (ran) return ran
  }
}
// Claude Code's npm package, which a package runner runs as claude
const CLAUDE_PACKAGE = /^@anthropic-ai\/claude-code(?:@\S*)?$/
// a fetcher's option that reads its URLs from a file: curl's -K or --config, wget's -i or --input-file
const URL_FILE = /^(?:-[A-Za-z]*K|--config(?:=|$))/
const WGET_URL_FILE = /^(?:-[A-Za-z]*i|--input-file(?:=|$))/
// gh commands whose reach is the whole account, and the api endpoints outside a repository, an owner or a search that read no org's data
const ACCOUNT_WIDE = new Set(["org", "status"])
const PLAIN_ENDPOINTS = new Set(["markdown", "rate_limit", "user"])
// gh's own placeholders for the checkout's repository, which gh fills from the checkout as it falls back
const GH_PLACEHOLDERS = /^repos\/\{owner\}\/\{repo\}(?:\/|$)/
// a GitHub repository a word names: a github.com URL in any of git's forms, an API URL's repos/, orgs/ or users/ path included, a raw or archive host's (raw.githubusercontent.com, codeload.github.com), or a REST path
const GITHUB_URL =
  /(?:github\.com|githubusercontent\.com)[/:](?:(?:repos|orgs|users)\/)?([\w.-]+)(?:\/([\w.-]+))?/i
const REST_PATH = /^\/?(?:repos|orgs|users)\/([\w.-]+)(?:\/([\w.-]+))?/i
// a search's scope: an owner or a repository named by flag or by qualifier
const SCOPED = /^(?:--owner|--repo|-R)(?:=|$)|(?:^|\s)(?:org|owner|repo|user):\S/
const isGuarded = (orgs: string[], owner: string) =>
  orgs.some((org) => org.toLowerCase() === owner.toLowerCase())
const label = (owner: string, repo?: string) =>
  repo ? `${owner}/${repo.replace(/\.git$/, "")}` : owner
// a guarded org a text names as a whole word, `-` and `_` counting as edges
const namedOrg = (orgs: string[], text: string) =>
  orgs.find((org) =>
    new RegExp(
      `(?:^|[^a-z\\d])${org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z\\d])`,
      "i",
    ).test(text),
  )
// the guarded repository or owner a URL or REST path names
const urlOrg = (orgs: string[], value: string, rest = false) => {
  const m = GITHUB_URL.exec(value) ?? (rest ? REST_PATH.exec(value) : null)
  return m && isGuarded(orgs, m[1]) ? label(m[1], m[2]) : undefined
}
const unreadValue = (w: Word) =>
  w.unknown !== undefined || Boolean(w.reads?.length) || marked(w.value)

const GRAPHQL_FIX = `Use a REST endpoint under repos/<owner>/<name>/ (gh api repos/<owner>/<name>/..., gh pr, gh issue), and reply to a review thread by REST, or report to your lead.`

// A gh call: refused when it names a guarded org (by -R, a URL, a REST path or any word), names its repository through a value the hook cannot read, searches with no scope, or falls back to a guarded org's repository (GH_REPO, the checkout's remotes).
function ghOrg(parsed: Parsed, env: Env, orgs: string[]): string | undefined {
  const { args } = parsed
  const words = args.filter((a) => !a.value.startsWith("-") && !unreadValue(a)).map((a) => a.value)
  // gh <command> <subcommand>, as typed first
  const head = args
    .slice(0, words[0] === "api" ? 1 : 2)
    .filter((a) => !a.value.startsWith("-") && !unreadValue(a))
  const what = `this gh ${head.map((a) => a.value).join(" ")} call`
  let placed = false
  for (let i = 0; i < args.length; i++) {
    const v = args[i].value
    const flag = v === "-R" || v === "--repo"
    const repo = flag
      ? args[++i]
      : v.startsWith("--repo=")
        ? { ...args[i], value: v.slice(7) }
        : undefined
    if (!repo && !flag) continue
    if (!repo || unreadValue(repo))
      return orgRefusal(
        what,
        "the hook cannot tell which repository it reaches, since a value it cannot read names it",
        PLACE_FIX,
      )
    const named = repoOf(repo)
    if (named && isGuarded(orgs, named.owner))
      return orgRefusal(
        what,
        `it reaches ${label(named.owner, named.repo)}, a guarded org's repository`,
      )
    placed = true
  }
  if (ACCOUNT_WIDE.has(words[0] ?? ""))
    return orgRefusal(what, "its reach is the whole account, every org it can read included")
  const api = words[0] === "api"
  const endpoint = api ? parseFlags(args.slice(1), GH_API_TAKES).positionals[0] : undefined
  if (endpoint && unreadValue(endpoint))
    return orgRefusal(
      what,
      "the hook cannot tell which repository it reaches, since a value it cannot read names its endpoint",
      PLACE_FIX,
    )
  const path = endpoint?.value
    .replace(/^https?:\/\/api\.github\.com\//i, "")
    .replace(/^\//, "")
    .replace(/[?#].*$/, "")
  if (path === "graphql")
    return orgRefusal(
      what,
      "a GraphQL query can walk from any repository to every org the account can read",
      GRAPHQL_FIX,
    )
  if (
    path !== undefined &&
    !REST_PATH.test(path) &&
    !GH_PLACEHOLDERS.test(path) &&
    !path.startsWith("search/") &&
    !PLAIN_ENDPOINTS.has(path)
  )
    return orgRefusal(
      what,
      `its endpoint ${path} reaches across the account, every org it can read included`,
      PLACE_FIX,
    )
  for (const a of args) {
    const hit = urlOrg(orgs, a.value, a === endpoint)
    if (hit)
      return orgRefusal(
        what,
        `it reaches ${hit}, ${hit.includes("/") ? "a guarded org's repository" : "a guarded org"}`,
      )
    if (GITHUB_URL.test(a.value) || (a === endpoint && REST_PATH.test(a.value))) placed = true
  }
  const org = namedOrg(orgs, args.map((a) => a.value).join(" "))
  if (org) return orgRefusal(what, `it names ${org}, a guarded org`)
  if (placed) return
  const search = words[0] === "search" || (api && /^\/?search\//.test(endpoint?.value ?? ""))
  if (search && !args.some((a) => SCOPED.test(a.value)))
    return orgRefusal(
      what,
      "a search with no owner or repository reaches every org the account can read",
      `Scope it with --repo <owner>/<name> or --owner <owner>, or report to your lead.`,
    )
  if (search) return
  const implicit = implicitRepos(env, parsed.local)
  if (implicit.some((r) => r === undefined) || (!env.cwd && implicit.length === 0))
    return orgRefusal(
      what,
      "the hook cannot tell which repository it reaches, since it names none and runs where the hook cannot read GH_REPO or the checkout",
      PLACE_FIX,
    )
  const fallback = implicit.find((r) => r && isGuarded(orgs, r.owner))
  return fallback
    ? orgRefusal(
        what,
        `it falls back to ${label(fallback.owner, fallback.repo)}, a guarded org's repository`,
      )
    : undefined
}

// The folders git reads a repository from: the call's own (its cwd or -C), each --git-dir or --work-tree before the subcommand, and GIT_DIR or GIT_WORK_TREE as the call sets or inherits them; undefined for one the hook cannot read.
function gitPlaces(parsed: Parsed, env: Env, dir: string | undefined): (string | undefined)[] {
  const places: (string | undefined)[] = [dir]
  const at = (w: Text) => (unreadValue(w as Word) ? undefined : pathOf(w, { ...env, cwd: dir }))
  const { args, local } = parsed
  for (let i = 0; i < args.length; i++) {
    const v = args[i].value
    const joined = /^--(?:git-dir|work-tree)=/.exec(v)
    if (joined) places.push(at({ ...args[i], value: v.slice(joined[0].length) }))
    else if (v === "--git-dir" || v === "--work-tree")
      places.push(args[i + 1] ? at(args[++i]) : undefined)
    else if (GIT_TAKES.has(v)) i++
    else if (!v.startsWith("-")) break
  }
  for (const key of ["GIT_DIR", "GIT_WORK_TREE"]) {
    const set =
      local.get(key) ??
      env.vars.get(key) ??
      (env.process[key] ? { value: env.process[key] as string } : undefined)
    if (set && set.value !== "") places.push(at(set))
  }
  return places
}

// A git call: refused when a word is a guarded org's URL, or the checkout it runs in has a guarded org's remote.
function gitOrg(
  parsed: Parsed,
  env: Env,
  dir: string | undefined,
  sub: string | undefined,
  orgs: string[],
): string | undefined {
  const { args } = parsed
  const what = sub ? `this git ${sub} call` : "this git call"
  for (const a of args) {
    const hit = urlOrg(orgs, a.value)
    if (hit) return orgRefusal(what, `it reaches ${hit}, a guarded org's repository`)
  }
  const places = gitPlaces(parsed, env, dir)
  if (places.includes(undefined))
    return orgRefusal(
      what,
      "the hook cannot tell which repository it reads, since a value it cannot read names it",
      "Name the checkout by its literal path, in a call of its own, or report to your lead.",
    )
  const remote = places.flatMap((place) => remotes(place)).find((r) => isGuarded(orgs, r.owner))
  return remote
    ? orgRefusal(
        what,
        `it runs in a checkout of ${label(remote.owner, remote.repo)}, a guarded org's repository`,
      )
    : undefined
}

// The org tools the glm rule keeps a GLM session off: a headless Claude run, a fetch of an org service's host, a Linear script, and gh or git on a guarded org's repository.
function orgCall(
  parsed: Parsed,
  env: Env,
  dir: string | undefined,
  sub: string | undefined,
  orgs: Orgs,
): string | undefined {
  const { args, name } = parsed
  const runs = args.findIndex((a) => CLAUDE_PACKAGE.test(a.value.replace(/^--package=/, "")))
  if (
    (name === "claude" && headless(parsed)) ||
    (runs >= 0 && headless({ ...parsed, args: args.slice(runs + 1) }))
  )
    return orgRefusal(
      "this headless Claude run",
      "a GLM session starts no Claude run of its own, which would reach what it may not",
    )
  if (FETCHERS.has(name))
    for (const a of args)
      for (const [host, kind] of ORG_HOSTS) {
        const m = host.exec(a.value)
        if (m) return orgRefusal(`this ${name} call`, `it reaches ${m[1]}, an org's ${kind}`)
      }
  if (
    FETCHERS.has(name) &&
    args.some((a) => (name === "wget" ? WGET_URL_FILE : URL_FILE).test(a.value))
  )
    return orgRefusal(
      `this ${name} call`,
      "it reads its URL from a file the hook cannot read",
      "Give the URL literally, in a call of its own, or report to your lead.",
    )
  const script = orgScript(parsed, env)
  if (script) return orgRefusal(`this ${name} call`, `it runs ${script}`)
  if (name !== "gh" && name !== "git" && !FETCHERS.has(name)) return
  if (!Array.isArray(orgs))
    return orgRefusal(
      `this ${name} call`,
      `the hook cannot read which orgs ext.links guards (${orgs.refusal})`,
      `Fix the policy, or report to your lead.`,
    )
  if (name === "gh") return ghOrg(parsed, env, orgs)
  if (name === "git") return gitOrg(parsed, env, dir, sub, orgs)
  for (const a of args) {
    const hit = urlOrg(orgs, a.value)
    if (hit) return orgRefusal(`this ${name} call`, `it reaches ${hit}, a guarded org's repository`)
  }
}

// A visitor for one call, tracking what ran before each command: cd, export and assignments are not visited, so they never chain.
const visitor = (load5: number, limit: number, orgs: Orgs): Visit => {
  const busy = load5 > limit
  let earlier: "none" | "staging" | "other" = "none"
  const forced: string[] = []
  let branchReads: (string | undefined)[] = []
  const visit: Visit = async (cmd, parsed, env) => {
    const slot = slotWords(parsed)
    if (slot)
      return slot.length === 0 ? undefined : examine({ ...cmd, words: slot }, env, visit, false)
    const { args, name } = parsed
    const reads = branchReads
    branchReads = []
    const busyRun = busy ? installOrClone(name, args) : undefined
    if (busyRun) return loaded(busyRun, load5, limit)
    if (PURE.has(name) && !writes(cmd)) return
    const before = earlier
    const isGit = name === "git"
    let dir = env.cwd
    let k = 0
    for (; isGit && k < args.length; k++) {
      const v = args[k].value
      if (v === "-C") {
        const next = args[++k]
        dir = next ? pathOf(next, { ...env, cwd: dir }) : undefined
      } else if (GIT_TAKES.has(v)) k++
      else if (!v.startsWith("-")) break
    }
    const sub = isGit ? args[k]?.value : undefined
    const org = orgCall(parsed, env, dir, sub, orgs)
    if (org) return org
    if (
      isGit &&
      !writes(cmd) &&
      BRANCH_READS.has(
        args
          .slice(k)
          .map((a) => a.value)
          .join(" "),
      )
    ) {
      branchReads = [...reads, dir]
      return
    }
    if (earlier !== "other") earlier = sub && STAGING.has(sub) ? "staging" : "other"
    if (sub === "add") forced.push(...forcedPaths(args.slice(k + 1), dir))
    if (sub !== "commit" && sub !== "push") return
    if (sub === "push" && before !== "none") return chainRefusal("git push", "a commit it pushes")
    if (before === "other") return chainRefusal("git commit", "a file it commits")
    if (!dir) return unread(`git ${sub}`, "which checkout it runs in")
    const reason =
      sub === "commit"
        ? await commit(args.slice(k + 1), dir, before === "staging", forced)
        : push(args.slice(k + 1), dir, reads)
    return reason ?? (busy ? loaded(`git ${sub}`, load5, limit) : undefined)
  }
  return visit
}

async function inspect(
  raw: string,
  environment: Environment,
  load5: number,
  limit: number,
): Promise<string | undefined> {
  const {
    cwd,
    tool_input: toolInput,
    tool_name: tool,
  } = JSON.parse(raw) as {
    cwd?: unknown
    tool_input?: { command?: unknown }
    tool_name?: unknown
  }
  if (typeof tool === "string" && tool.startsWith("mcp__"))
    return orgRefusal(
      `this ${tool} call`,
      "an MCP tool reaches an org's or an outside service's data",
    )
  if (tool !== "Bash" || typeof toolInput?.command !== "string") return
  const command = toolInput.command
  if (!mayRefuse(command.replace(/["'\\]/g, ""), load5, limit)) return
  const directory = typeof cwd === "string" ? cwd : undefined
  const env: Env = {
    cwd: directory,
    files: new Map(),
    known: knownVariables(command, environment, directory),
    process: environment,
    vars: new Map(),
  }
  return run(lex(command, env.known), env, visitor(load5, limit, await guardedOf(environment)))
}

// Whether a call may be one the hook refuses: a git commit or push, an org tool, or on a busy machine an install or clone.
const mayRefuse = (text: string, load5: number, limit: number) =>
  GIT_CALL.test(text) || ORG_CALL.test(text) || (load5 > limit && BUSY_RUN.test(text))

// Fails closed only on a call that reads as one it refuses: an error on any other call lets it run, so a parser bug never freezes a GLM worker.
export async function check(
  raw: string,
  environment: Environment = process.env,
  load5: number = currentLoad5(),
): Promise<string | undefined> {
  const limit = await loadLimit(environment)
  try {
    return await inspect(raw, environment, load5, limit)
  } catch (error) {
    if (!mayRefuse(raw, load5, limit)) return
    return `no-glm-heavy-path hook could not read this call (${error}), which reads as a git commit or push, an org tool, or an install or clone on a busy machine, from a GLM session, so it refuses it, as the glm rule (playground rules glm) asks of an org tool it cannot read. Run it as one plain command, or report to your lead.`
  }
}

// The reason a session's call is refused: none unless the session runs on GLM.
export async function refusal(
  raw: string,
  environment: Environment = process.env,
  load5: number = currentLoad5(),
): Promise<string | undefined> {
  return (await onGlm(raw, environment)) ? check(raw, environment, load5) : undefined
}

if (import.meta.main) {
  const raw = await Bun.stdin.text()
  const reason = (await fromFactory(raw)) ? await refusal(raw) : undefined
  if (reason) {
    console.error(reason)
    process.exit(2)
  }
}
