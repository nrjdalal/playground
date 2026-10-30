import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"

import { jobKey, resetSetting, setSetting, settingRows, writeAtomically } from "@packages/settings"

// The machine half of playground migrate, run with the Dashboard's job stopped. Every old name it moves comes from the migration table at the pre-squash head (TABLE), so this file names none: the data folder takes its new name before the seeds, then each renamed job takes its new name in jobs.json and in the login's settings, the dropped jobs go, every path into an old data folder points at the playground one, the stale ops copies are archived then deleted, the Dashboard's state folder and the table's files move, and each variable the shell profiles and LaunchAgents set under an old name takes the new one.

export const TABLE = ".github/notes/migrate/table.json"

type Pair = { from: string; to: string }
export type Table = {
  dataFolders: string[]
  droppedEnv: string[]
  droppedJobs: string[]
  env: Pair[]
  envPrefix: Pair
  files: Pair[]
  job: { name: Pair; script: Pair; setting: Pair; stop: Pair }
  jobs: (Pair & { command?: string; cwd?: string })[]
  linkConverter: string
  sources?: Record<string, string>
  staleCopies: string[]
  stateFolder: Pair
}
export type Step = { line: string; ok: boolean }
type Job = Record<string, unknown> & { name?: string }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// A text with every path into an old data folder, under ~/.claude, pointing at the data folder, ~/.playground, and each variable under an old name taking its new one.
const movedText = (table: Table, text: string): string => {
  const folders = new RegExp(`\\.claude/(?:${table.dataFolders.map(escape).join("|")})(?=/)`, "g")
  const prefix = new RegExp(`\\b${escape(table.envPrefix.from)}(?=[A-Z])`, "g")
  return table.env.reduce(
    (moved, { from, to }) => moved.replace(new RegExp(`\\b${escape(from)}\\b`, "g"), to),
    text.replace(folders, ".playground").replace(prefix, table.envPrefix.to),
  )
}

// One job with its new names: the Dashboard's from the table's job, any other renamed job's name and heartbeat from its jobs.
export const movedJob = (table: Table, job: Job): Job => {
  const moved = JSON.parse(movedText(table, JSON.stringify(job))) as Job
  const renamed = table.jobs.find((pair) => pair.from === moved.name)
  if (renamed)
    return {
      ...moved,
      name: renamed.to,
      ...(moved.heartbeat === renamed.from ? { heartbeat: renamed.to } : {}),
      ...(renamed.command ? { command: renamed.command } : {}),
      ...(renamed.cwd ? { cwd: renamed.cwd } : {}),
    }
  const { name, script, stop } = table.job
  if (moved.name !== name.from && moved.heartbeat !== name.from) return moved
  return {
    ...moved,
    ...(moved.name === name.from ? { name: name.to } : {}),
    ...(typeof moved.command === "string"
      ? { command: moved.command.replace(script.from, script.to) }
      : {}),
    heartbeat: name.to,
    ...(moved.stop === stop.from ? { stop: stop.to } : {}),
  }
}

// jobs.json rewritten: the dropped entries out, every other job moved.
export const movedJobs = (table: Table, text: string): { lines: string[]; text: string } => {
  const parsed = JSON.parse(text) as { jobs: Job[] }
  const lines: string[] = []
  const jobs = parsed.jobs.flatMap((job) => {
    if (table.droppedJobs.includes(job.name ?? "")) {
      lines.push(`- job ${job.name}: dropped`)
      return []
    }
    const moved = movedJob(table, job)
    if (JSON.stringify(moved) !== JSON.stringify(job))
      lines.push(`~ job ${job.name}${moved.name === job.name ? "" : ` as ${moved.name}`}`)
    return [moved]
  })
  return { lines, text: `${JSON.stringify({ ...parsed, jobs }, null, 2)}\n` }
}

const PROFILES = [".bash_profile", ".bashrc", ".profile", ".zprofile", ".zshenv", ".zshrc"]

// The files outside the data folder that can set a variable: the shell profiles and the LaunchAgents.
const envFiles = (home: string): string[] => {
  const agents = join(home, "Library", "LaunchAgents")
  return [
    ...PROFILES.map((name) => join(home, name)),
    ...(existsSync(agents)
      ? readdirSync(agents)
          .filter((name) => name.endsWith(".plist"))
          .map((name) => join(agents, name))
      : []),
  ].filter(existsSync)
}

const WHO = {
  actor: "playground migrate",
  author: "playground",
  inboxRef: null,
  reason: "the switch: the Dashboard's job takes its new name",
}

export function moveMachine(
  data: string,
  login: string,
  home: string,
  table: Table,
  dryRun: boolean,
): Step[] {
  const steps: Step[] = []
  const say = (ok: boolean, line: string) => steps.push({ line, ok })

  const jobsPath = join(data, "ops", "jobs.json")
  if (existsSync(jobsPath)) {
    try {
      const moved = movedJobs(table, readFileSync(jobsPath, "utf8"))
      for (const line of moved.lines) say(true, line)
      if (!dryRun && moved.lines.length) writeAtomically(jobsPath, moved.text)
    } catch (error) {
      say(false, `- ${jobsPath}: ${(error as Error).message}`)
    }
  }

  // Each renamed job's setting row in the login's scope, under its job key.
  const rows = settingRows(data)
  for (const { from, to } of [table.job.name, ...table.jobs]) {
    const row = rows.find((each) => each.scope === login && each.key === jobKey(from))
    if (!row) continue
    say(true, `~ setting ${jobKey(from)} at ${login} as ${jobKey(to)}`)
    if (dryRun) continue
    const reset = resetSetting(data, { key: jobKey(from), scope: login }, WHO)
    const value = movedJob(table, row.value as Job)
    const set = setSetting(data, { key: jobKey(to), scope: login, value }, WHO)
    for (const result of [reset, set])
      if (!result.ok) say(false, `- ${jobKey(to)} at ${login}: ${result.message}`)
  }

  for (const path of table.staleCopies.filter((each) => lstatOf(join(data, each)))) {
    say(true, `- ${path}: archived in archive/${path}, then deleted`)
    if (dryRun) continue
    mkdirSync(dirname(join(data, "archive", path)), { recursive: true })
    cpSync(join(data, path), join(data, "archive", path), {
      recursive: true,
      verbatimSymlinks: true,
    })
    rmSync(join(data, path), { recursive: true })
  }

  const { from, to } = table.stateFolder
  if (existsSync(join(data, from))) {
    if (existsSync(join(data, to))) say(false, `- ${from}: ${to} already exists, so neither moved`)
    else {
      say(true, `~ ${from} moved to ${to}`)
      if (!dryRun) renameSync(join(data, from), join(data, to))
    }
  }

  // A dry run left the state folder where it was, so a file it will hold is looked for there.
  const now = (path: string) =>
    dryRun && path.startsWith(`${to}/`) ? `${from}${path.slice(to.length)}` : path
  for (const file of table.files.filter((each) => existsSync(join(data, now(each.from))))) {
    if (existsSync(join(data, file.to))) {
      say(false, `- ${file.from}: ${file.to} already exists, so neither moved`)
      continue
    }
    say(true, `~ ${file.from} moved to ${file.to}`)
    if (dryRun) continue
    mkdirSync(dirname(join(data, file.to)), { recursive: true })
    renameSync(join(data, file.from), join(data, file.to))
  }

  const prefix = new RegExp(`\\b${escape(table.envPrefix.from)}(?=[A-Z])`, "g")
  for (const file of envFiles(home)) {
    const text = readFileSync(file, "utf8")
    const moved = movedText(table, text)
    if (moved === text) continue
    const names = [
      ...new Set(text.match(new RegExp(`\\b${escape(table.envPrefix.from)}[A-Z0-9_]+`, "g"))),
    ]
    for (const name of names.filter((each) => table.droppedEnv.includes(each)))
      say(true, `! ${file} sets ${name}, which nothing reads now: move its words into its list`)
    const changes = [
      ...names
        .filter((name) => !table.droppedEnv.includes(name))
        .map((name) => name.replace(prefix, table.envPrefix.to)),
      ...table.env
        .filter(({ from }) => new RegExp(`\\b${escape(from)}\\b`).test(text))
        .map(({ to }) => to),
      ...(movedText({ ...table, env: [], envPrefix: { from: "\0", to: "\0" } }, text) === text
        ? []
        : ["its paths into the data folder"]),
    ]
    say(true, `~ ${file}: ${changes.join(", ")}, its old copy in ${file}.pre-migrate`)
    if (dryRun) continue
    cpSync(file, `${file}.pre-migrate`)
    writeAtomically(file, moved)
  }
  return steps
}

const lstatOf = (path: string) => {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

// Before the seeds: the old data folder (the table's first data folder that is a real folder in Claude's config folder) moves to the data folder, ~/.playground, and each old name is left as a link to it, so a path written before the switch still reads; a link made in its place is replaced. The data folder to read from comes back with the steps, the old one on a dry run.
export function moveDataFolder(
  data: string,
  config: string,
  table: Table,
  dryRun: boolean,
): { data: string; steps: Step[] } {
  if (basename(data) !== ".playground") return { data, steps: [] }
  const old = table.dataFolders
    .map((name) => join(config, name))
    .find((path) => lstatOf(path)?.isDirectory())
  if (!old) return { data, steps: [] }
  if (lstatOf(data)?.isDirectory())
    return {
      data,
      steps: [{ line: `- ${old}: ${data} already exists, so neither moved`, ok: false }],
    }
  const steps = [{ line: `~ ${old} moved to ${data}, its old names left as links to it`, ok: true }]
  if (dryRun) return { data: old, steps }
  if (lstatOf(data)) unlinkSync(data)
  renameSync(old, data)
  for (const name of table.dataFolders) {
    const path = join(config, name)
    if (lstatOf(path)?.isSymbolicLink()) unlinkSync(path)
    if (!lstatOf(path)) symlinkSync(data, path)
  }
  return { data, steps }
}
