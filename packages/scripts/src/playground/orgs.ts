import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join, relative } from "node:path"

import { configDirOf, dataDir } from "@packages/env/data-dir"
import {
  CORE,
  extChain,
  extLinksSchema,
  loginOf,
  markerPath,
  readPolicyOrDefaults,
  scopeDir,
} from "@packages/settings"

// The core scope's skill folders in the checkout, read in this order; the last holds core's own skills beside upstream's, vendored as published.
export const CORE_SKILLS = ["skills/playground", "skills/zerostarter", "extensions/core/skills"]

// Claude Code's aliases of its built-in commands and bundled skills, A to Z (code.claude.com/docs/en/commands): a skill takes a built-in's own name over it, never an alias, so a skill named after one never runs: CI refuses one in the core scope, and the resolver leaves one out of any other.
export const BUILT_IN_ALIASES = [
  "allowed-tools",
  "android",
  "app",
  "bg",
  "bug",
  "checkpoint",
  "checkup",
  "continue",
  "cost",
  "feedback",
  "ios",
  "new",
  "proactive",
  "quit",
  "rc",
  "reset",
  "review",
  "routines",
  "settings",
  "share",
  "stats",
  "undo",
]

// Folders under a skill root that hold no skill a session gets.
const SKIPPED = new Set(["deprecated", "in-progress", "node_modules"])

export type Winner = { dir: string; from: string; name: string }

// Every skill under a root by its folder's name, a folder holding SKILL.md, nested as deep as the root keeps them.
export const skillsIn = (root: string): Map<string, string> => {
  const found = new Map<string, string>()
  const walk = (dir: string) => {
    if (existsSync(join(dir, "SKILL.md"))) {
      const name = dir.split("/").pop()!
      if (!found.has(name)) found.set(name, dir)
      return
    }
    for (const entry of readdirSync(dir, { withFileTypes: true }))
      if (entry.isDirectory() && !SKIPPED.has(entry.name)) walk(join(dir, entry.name))
  }
  if (existsSync(root)) walk(root)
  return found
}

// The GitHub owner in a repo's origin URL, lowercase, or undefined for a repo GitHub does not hold.
export const ownerOf = (origin: string): string | undefined =>
  origin.match(/github\.com[:/]([^/]+)\//)?.[1]?.toLowerCase()

// The extensions a session reads, first wins, core last, and the one linked to the repo's org by name, whose set the plugin is named for.
export type Plan = { chain: string[]; own?: string }

// The plan for a repo of owner (the home set with none) from the policy's ext.order and ext.links.
export const planFor = (
  owner: string | undefined,
  values: Record<string, unknown>,
  login = "",
): Plan => {
  const chain = extChain(values, login, owner)
  const links = extLinksSchema.safeParse(values["ext.links"]).data ?? {}
  return { chain, own: owner ? chain.find((name) => links[name]?.includes(owner)) : undefined }
}

export type Resolved = {
  // A line for each skill outside core left out, since a built-in's alias takes its name.
  left: string[]
  // Each name a lower scope also holds, with those scopes in order; only the winner loads.
  shadowed: Map<string, string[]>
  winners: Winner[]
}

// The winning folder of every name: the first scope holding a name keeps it and a lower copy never loads beside it, so the plugin holds no name twice.
export const resolveSkills = (plan: Plan, rootsOf: (scope: string) => string[]): Resolved => {
  const winners = new Map<string, Winner>()
  const shadowed = new Map<string, string[]>()
  const left: string[] = []
  for (const scope of plan.chain)
    for (const root of rootsOf(scope))
      for (const [name, dir] of skillsIn(root))
        if (scope !== CORE && BUILT_IN_ALIASES.includes(name))
          left.push(
            `left out ${scope}'s ${name}: a built-in's alias takes that name, so it never runs`,
          )
        else if (!winners.has(name)) winners.set(name, { dir, from: scope, name })
        else if (winners.get(name)!.from !== scope)
          shadowed.set(name, [...(shadowed.get(name) ?? []), scope])
  return { left, shadowed, winners: [...winners.values()] }
}

const filesOf = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => !entry.isDirectory() && statSync(join(entry.parentPath, entry.name)).isFile(),
    )
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort()

// One merged plugin for a set of winners, under <data>/orgs/<set>/<hash>/: the folder is named by what it holds, so a session already running on an older one keeps it whole, and a second spawn with the same winners reuses it.
export const writePlugin = (data: string, set: string, winners: Winner[]): string => {
  const hash = createHash("sha256")
  for (const winner of [...winners].sort((a, b) => a.name.localeCompare(b.name)))
    for (const file of filesOf(winner.dir))
      hash.update(`${winner.name}/${file}\0`).update(readFileSync(join(winner.dir, file)))
  const id = hash.digest("hex").slice(0, 16)
  const dir = join(data, "orgs", set, id)
  if (existsSync(dir)) return dir
  const temp = join(dirname(dir), `.${id}.${process.pid}.tmp`)
  rmSync(temp, { force: true, recursive: true })
  mkdirSync(join(temp, ".claude-plugin"), { recursive: true })
  writeFileSync(
    join(temp, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ description: `The ${set} skill set`, name: `ws-${set}`, version: id }, null, 2)}\n`,
  )
  for (const winner of winners)
    cpSync(winner.dir, join(temp, "skills", winner.name), { dereference: true, recursive: true })
  try {
    renameSync(temp, dir)
  } catch (error) {
    rmSync(temp, { force: true, recursive: true })
    if (!existsSync(dir)) throw error
  }
  return dir
}

export const ORGS_USAGE = [
  "usage: playground orgs resolve [--repo <dir>]: write the merged skill plugin a session in <dir> loads (the home set with no --repo) and print its folder",
  "       playground orgs home: write the home set and install it at user scope, for a session started by hand (link-skills.sh runs it)",
].join("\n")

export type OrgsIo = {
  checkout: string
  // Claude Code's own CLI, `claude <args>`: its exit code and output, or undefined when it is not on PATH.
  claude: (args: string[]) => { code: number; out: string } | undefined
  data: string
  err: (line: string) => void
  // The login whose scope a session reads first; it throws, naming ext init, when none is set.
  login: () => string
  origin: (repo: string) => string
  out: (line: string) => void
  // Claude Code's personal skills folder, where a skill would take a bare name over every plugin's.
  personal: string
}

// What a session in repo, or in a repo of org, resolves to (the home set with neither): ext.order and ext.links from the extensions' policy (their defaults until a first setting writes it), each skill from the first scope that has it; a root ext init stopped in, holding no scope's folder yet, resolves with no login; a refusal when the policy does not parse, or when scopes are there and no login names whose they are.
export const resolveFor = async (
  io: OrgsIo,
  repo?: string,
  org?: string,
): Promise<
  ({ plan: Plan; refusal?: undefined } & Resolved) | { plan?: undefined; refusal: string }
> => {
  const policy = readPolicyOrDefaults(io.data)
  if (policy.refusal !== undefined) return { refusal: policy.refusal }
  const extensions = existsSync(markerPath(io.data))
  let login: string | undefined
  try {
    login = extensions ? io.login() : undefined
  } catch (error) {
    const scopes = readdirSync(markerPath(io.data), { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    )
    if (scopes.length) return { refusal: (error as Error).message }
  }
  const owner = org?.toLowerCase() ?? (repo ? ownerOf(io.origin(repo)) : undefined)
  const plan = planFor(owner, policy.settings.values, login)
  const resolved = resolveSkills(plan, (scope) =>
    scope === CORE
      ? CORE_SKILLS.map((folder) => join(io.checkout, folder))
      : extensions
        ? [join(scopeDir(io.data, scope), "skills")]
        : [],
  )
  return { plan, ...resolved }
}

const resolveSet = async (
  io: OrgsIo,
  repo?: string,
): Promise<{ plugin: string; refusal?: undefined } | { plugin?: undefined; refusal: string }> => {
  const resolved = await resolveFor(io, repo)
  if (resolved.refusal !== undefined) return { refusal: resolved.refusal }
  for (const line of resolved.left) io.err(line)
  return { plugin: writePlugin(io.data, resolved.plan.own ?? "home", resolved.winners) }
}

// The home set at user scope, through a directory marketplace, ws, in <data>/orgs: Claude Code installs a copy, so a later run moves the entry to the new folder and updates it. A link in the personal skills folder at a name the set ships goes first, since it would take the name; a real folder there is left alone and named, exit 1.
const installHome = (io: OrgsIo, plugin: string): number => {
  let code = 0
  for (const name of readdirSync(join(plugin, "skills"))) {
    const path = join(io.personal, name)
    let link: boolean
    try {
      link = lstatSync(path).isSymbolicLink()
    } catch {
      continue
    }
    if (link) {
      rmSync(path)
      io.out(`removed the personal link ${name}: the home skill set ships it`)
    } else {
      io.err(
        `skipped ${name}: ${path} is a real folder, which takes the name over the home skill set; move it aside`,
      )
      code = 1
    }
  }
  const orgs = join(io.data, "orgs")
  mkdirSync(join(orgs, ".claude-plugin"), { recursive: true })
  const marketplace = {
    name: "ws",
    owner: { name: "playground" },
    plugins: [{ name: "ws-home", source: `./${relative(orgs, plugin)}` }],
  }
  const file = join(orgs, ".claude-plugin", "marketplace.json")
  writeFileSync(`${file}.${process.pid}.tmp`, `${JSON.stringify(marketplace, null, 2)}\n`)
  renameSync(`${file}.${process.pid}.tmp`, file)
  const listed = io.claude(["plugin", "list"])
  if (!listed) {
    io.out("the home skill set waits: claude is not on PATH, so it is not installed at user scope")
    return code
  }
  const steps = listed.out.includes("ws-home@ws")
    ? [["plugin", "update", "ws-home@ws"]]
    : [
        ["plugin", "marketplace", "add", orgs],
        ["plugin", "install", "ws-home@ws", "--scope", "user"],
      ]
  for (const step of steps) {
    const ran = io.claude(step)!
    if (ran.code !== 0) {
      io.err(`claude ${step.join(" ")} failed: ${ran.out.trim()}`)
      return 1
    }
  }
  io.out(`the home skill set at user scope: ${plugin}`)
  return code
}

// The folder of the copy of name a session in repo (or a repo of org) loads, the scope it is from and each lower scope whose copy it shadows, or why there is none: a job that runs a skill's script reaches it here, wherever its scope keeps it, through `ext which <skill>`, and `ext why <skill>` prints it.
export const whichSkill = async (
  io: OrgsIo,
  name: string,
  repo?: string,
  org?: string,
): Promise<
  | { dir: string; from: string; refusal?: undefined; shadowed: string[] }
  | { dir?: undefined; refusal: string }
> => {
  const resolved = await resolveFor(io, repo, org)
  if (resolved.refusal !== undefined) return { refusal: resolved.refusal }
  const winner = resolved.winners.find((w) => w.name === name)
  return winner
    ? { dir: winner.dir, from: winner.from, shadowed: resolved.shadowed.get(name) ?? [] }
    : { refusal: `no scope holds the skill ${name}` }
}

// playground orgs resolve prints the plugin's folder for spawn.sh; playground orgs home installs the home set; exit 2 on a wrong word or a refusal.
export async function orgsCommand(words: string[], io: OrgsIo): Promise<number> {
  const [verb, ...rest] = words
  const [flag, repo, ...extra] = rest
  const scoped = (flag === undefined || (flag === "--repo" && repo)) && !extra.length
  const known = (verb === "resolve" && scoped) || (verb === "home" && flag === undefined)
  if (!known) {
    io.err(ORGS_USAGE)
    return 2
  }
  const set = await resolveSet(io, verb === "resolve" ? repo : undefined)
  if (set.refusal) {
    io.err(set.refusal)
    return 2
  }
  if (verb === "home") return installHome(io, set.plugin!)
  io.out(set.plugin!)
  return 0
}

// spawn.sh's and link-skills.sh's call: `bun packages/scripts/src/playground/orgs.ts resolve --repo <dir>` or `... home`, the same commands as `playground orgs` with none of the CLI's other imports.
export const orgsIo = (checkout: string, data: string): OrgsIo => ({
  checkout,
  claude: (args) => {
    if (!Bun.which("claude")) return undefined
    const ran = Bun.spawnSync(["claude", ...args], {
      cwd: homedir(),
      stderr: "pipe",
      stdout: "pipe",
    })
    return { code: ran.exitCode, out: `${ran.stdout}${ran.stderr}` }
  },
  data,
  err: console.error,
  login: () => loginOf(data),
  origin: (repo) =>
    Bun.spawnSync(["git", "-C", repo, "remote", "get-url", "origin"]).stdout.toString().trim(),
  out: console.log,
  personal: join(configDirOf(), "skills"),
})

if (import.meta.main)
  process.exit(
    await orgsCommand(
      process.argv.slice(2),
      orgsIo(join(import.meta.dir, "../../../.."), dataDir()),
    ),
  )
