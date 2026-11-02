import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve, sep } from "node:path"

// The folders a delete starts from, passed in so a test builds them on a mkdtemp root of its own.
export type Roots = { home: string; main: string; trash: string }

// protected and tripwire refusals go to the dispatcher through the ops notify line; refused is a plain no.
export type Refusal = { kind: "protected" | "refused" | "tripwire"; refused: string }

// What tells a worktree is held: every process's working folder (null when they cannot be listed), the roster's live statuses, and the roster's path.
export type Holders = { cwds: string[] | null; live: string[]; roster: string }

export type Quarantined = { files: number; id: string; size: number; to: string }

export type TrashEntry = {
  at: string
  files: number
  id: string
  path: string
  reason: string
  session: string
  size: number
}

// The file makeScratch leaves in each folder it makes, which removeScratch requires.
export const MARKER = ".safe-delete-scratch"

export const LIMITS = { bytes: 2 * 1024 ** 3, files: 5000, perMinute: 3 }

export const PURGE = { days: 7, minFree: 50e9 }

const HOME_DIRS = [".claude", ".config", ".gnupg", ".playground", ".ssh", "Library", "Music"]
const BATCH = /^(\d{8}T\d{6}Z)-([A-Za-z0-9][A-Za-z0-9-]*)$/
const ID = /^(\d{8}T\d{6}Z-[A-Za-z0-9][A-Za-z0-9-]*)\/(\d+)$/
const SESSION = /^[A-Za-z0-9][A-Za-z0-9-]*$/

const lstat = (path: string): Stats | null => {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

// A path with every symlink resolved, the part that does not exist yet kept as written.
const real = (path: string): string => {
  const abs = resolve(path)
  try {
    return realpathSync(abs)
  } catch {
    const parent = dirname(abs)
    return parent === abs ? abs : join(real(parent), basename(abs))
  }
}

const inside = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

const worktreesOf = (roots: Roots): string => join(real(roots.main), ".claude", "worktrees")

const whyProtected = (path: string, roots: Roots): string | null => {
  const home = real(roots.home)
  const main = real(roots.main)
  const trash = real(roots.trash)
  if (inside(path, trash)) return `${path} is in the trash, which the trash-purge beat empties`
  const subtrees = [...HOME_DIRS.map((dir) => real(join(home, dir))), dirname(trash)]
  for (const root of [home, main, ...subtrees])
    if (inside(root, path))
      return path === root ? `${path} is protected` : `${path} holds the protected ${root}`
  for (const root of subtrees)
    if (inside(path, root)) return `${path} is inside the protected ${root}`
  if (inside(path, main) && !path.startsWith(worktreesOf(roots) + sep))
    return `${path} is inside the main checkout ${main}`
  return null
}

// Why a path may not be deleted, or null: checked at the path's own place and at its symlink's target.
export function isProtected(path: string, roots: Roots): string | null {
  const abs = resolve(path)
  const own = join(real(dirname(abs)), basename(abs))
  return whyProtected(own, roots) ?? whyProtected(real(abs), roots)
}

// The files and bytes under a path, symlinks not followed; the walk stops once either passes its limit.
const measure = (path: string, limits = { bytes: Infinity, files: Infinity }) => {
  let files = 0
  let size = 0
  const stack = [path]
  while (stack.length && files <= limits.files && size <= limits.bytes) {
    const at = stack.pop()!
    const info = lstatSync(at)
    if (info.isDirectory()) for (const name of readdirSync(at)) stack.push(join(at, name))
    else {
      files++
      size += info.size
    }
  }
  return { files, size }
}

const stamp = (at: Date): string => at.toISOString().replace(/[-:]|\.\d{3}/g, "")

const stampMs = (text: string): number =>
  Date.parse(text.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"))

const batches = (trash: string): string[] => {
  try {
    return readdirSync(trash)
      .filter((name) => BATCH.test(name))
      .sort()
  } catch {
    return []
  }
}

const manifestOf = (trash: string, batch: string): TrashEntry[] => {
  try {
    return readFileSync(join(trash, batch, "manifest.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TrashEntry)
  } catch {
    return []
  }
}

const recentCount = (trash: string, session: string, now: Date): number => {
  const since = now.getTime() - 60_000
  return batches(trash)
    .filter(
      (batch) =>
        BATCH.exec(batch)![2] === session && stampMs(BATCH.exec(batch)![1]!) > since - 1000,
    )
    .flatMap((batch) => manifestOf(trash, batch))
    .filter((entry) => Date.parse(entry.at) > since).length
}

const otherVolume = (path: string, trash: string) =>
  `${path} is on another volume than the trash ${trash}, so a move would copy it`

const refused = (text: string, kind: Refusal["kind"] = "refused"): Refusal => ({
  kind,
  refused: text,
})

// Renames a path into <trash>/<UTC-ts>-<session>/<n>/ with a manifest line, after the protected list, worktreeRefusal for a worktree (which only the worktree option's holders move), the tripwire and the volume check.
export function quarantine(
  path: string,
  opts: { reason: string; session: string; worktree?: Holders },
  roots: Roots,
  io: { dev?: (path: string) => number; now?: Date } = {},
): Quarantined | Refusal {
  const abs = resolve(path)
  if (!SESSION.test(opts.session))
    return refused(`the session name ${opts.session} is not a word of letters, digits and hyphens`)
  if (!lstat(abs)) return refused(`no such path ${abs}`)
  const why = isProtected(abs, roots)
  if (why) return refused(why, "protected")
  const isWorktree = dirname(join(real(dirname(abs)), basename(abs))) === worktreesOf(roots)
  if (isWorktree && !opts.worktree)
    return refused(`${abs} is a worktree: playground rm --worktree removes it`)
  if (!isWorktree && opts.worktree)
    return refused(`--worktree takes a folder in ${worktreesOf(roots)}, not ${abs}`)
  const held = opts.worktree && worktreeRefusal(abs, roots, opts.worktree)
  if (held) return refused(held)
  const now = io.now ?? new Date()
  const trash = real(roots.trash)
  const recent = recentCount(trash, opts.session, now)
  if (recent >= LIMITS.perMinute)
    return refused(
      `${opts.session} quarantined ${recent} paths in the last minute, the most one session may`,
      "tripwire",
    )
  const { files, size } = measure(abs, opts.worktree ? undefined : LIMITS)
  if (!opts.worktree && (files > LIMITS.files || size > LIMITS.bytes))
    return refused(
      `${abs} holds over ${LIMITS.files} files or ${LIMITS.bytes / 1024 ** 3} GB, past the tripwire`,
      "tripwire",
    )
  mkdirSync(trash, { recursive: true })
  const dev = io.dev ?? ((p: string) => lstatSync(p).dev)
  if (dev(abs) !== dev(trash)) return refused(otherVolume(abs, trash))
  const batch = `${stamp(now)}-${opts.session}`
  mkdirSync(join(trash, batch), { recursive: true })
  let n = 1
  while (existsSync(join(trash, batch, String(n)))) n++
  const slot = join(trash, batch, String(n))
  mkdirSync(slot)
  const to = join(slot, basename(abs))
  try {
    renameSync(abs, to)
  } catch (error) {
    rmdirSync(slot)
    const code = (error as NodeJS.ErrnoException).code
    return refused(
      code === "EXDEV"
        ? otherVolume(abs, trash)
        : `${abs} did not move: ${code ?? (error as Error).message}`,
    )
  }
  const id = `${batch}/${n}`
  const entry: TrashEntry = {
    at: now.toISOString(),
    files,
    id,
    path: abs,
    reason: opts.reason,
    session: opts.session,
    size,
  }
  appendFileSync(join(trash, batch, "manifest.jsonl"), `${JSON.stringify(entry)}\n`)
  return { files, id, size, to }
}

// Every item still in the trash, oldest first.
export function listTrash(trash: string): TrashEntry[] {
  return batches(trash)
    .flatMap((batch) => manifestOf(trash, batch))
    .filter((entry) => existsSync(join(trash, entry.id)))
}

// Moves a trash item back to the path it came from, refusing a protected path, one anything stands at, and one whose folder is gone.
export function restore(id: string, roots: Roots): { path: string } | Refusal {
  const trash = roots.trash
  const match = ID.exec(id)
  if (!match) return refused(`${id} is not a trash id; playground rm --list prints them`)
  const entry = manifestOf(trash, match[1]!).find((line) => line.id === id)
  const slot = join(trash, id)
  const items = existsSync(slot) ? readdirSync(slot) : []
  if (!entry || items.length !== 1) return refused(`no trash item ${id}`)
  const why = isProtected(entry.path, roots)
  if (why) return refused(why, "protected")
  if (lstat(entry.path)) return refused(`${entry.path} already exists; move it aside first`)
  if (!existsSync(dirname(entry.path)))
    return refused(`${dirname(entry.path)}, the folder ${id} came from, is gone`)
  renameSync(join(slot, items[0]!), entry.path)
  rmdirSync(slot)
  return { path: entry.path }
}

// Why a worktree may not be removed, or null: it sits in <main>/.claude/worktrees, the roster reads, no live session or process holds it, and its HEAD is on a remote branch.
export function worktreeRefusal(path: string, roots: Roots, holders: Holders): string | null {
  const at = real(path)
  if (dirname(at) !== worktreesOf(roots)) return `${at} is not a worktree in ${worktreesOf(roots)}`
  let agents: ({ branch?: unknown; name?: unknown; pr?: unknown; status?: unknown } | null)[]
  try {
    agents = JSON.parse(readFileSync(holders.roster, "utf8")).agents
    if (!Array.isArray(agents)) throw new Error("no agents")
  } catch {
    return `the roster ${holders.roster} cannot be read, so no worktree is removed`
  }
  const git = (...args: string[]) => {
    const run = Bun.spawnSync(["git", "-C", at, ...args], { stderr: "pipe", stdout: "pipe" })
    return { ok: run.exitCode === 0, out: run.stdout.toString().trim() }
  }
  const top = git("rev-parse", "--show-toplevel")
  if (!top.ok || real(top.out) !== at) return `${at} is not a git worktree`
  const branch = git("symbolic-ref", "--quiet", "--short", "HEAD").out
  const folder = basename(at).toLowerCase()
  const where = `${folder} ${branch.toLowerCase()}`
  for (const agent of agents) {
    if (!agent || !holders.live.includes(String(agent.status)) || typeof agent.name !== "string")
      continue
    const id = agent.name.split("-")[0]!
    const tokens = [agent.name, ...(/\d/.test(id) ? [id] : [])].map((t) => t.toLowerCase())
    const byBranch =
      typeof agent.branch === "string" && agent.branch.toLowerCase() === branch.toLowerCase()
    const pr = typeof agent.pr === "string" ? /\/pull\/(\d+)$/.exec(agent.pr)?.[1] : undefined
    const byPr = pr !== undefined && new RegExp(`(^|\\D)${pr}(\\D|$)`).test(where)
    if (byBranch || byPr || tokens.some((t) => where.includes(t)))
      return `${at} is held by ${agent.name}, which the roster lists as ${agent.status}`
  }
  if (holders.cwds === null) return `the processes' folders cannot be listed, so ${at} stays`
  const cwd = holders.cwds.find((dir) => inside(real(dir), at))
  if (cwd) return `${at} is held by a process working in ${cwd}`
  if (!git("branch", "-r", "--contains", "HEAD").out)
    return `${at}'s HEAD is on no remote branch: push it first`
  return null
}

// A mkdtemp folder under the temp folder, marked so removeScratch will remove it.
export function makeScratch(prefix: string, tmp = tmpdir()): string {
  const dir = mkdtempSync(join(tmp, prefix))
  writeFileSync(join(dir, MARKER), "")
  return dir
}

// Removes a folder makeScratch made, and nothing else: null once removed, else why not.
export function removeScratch(dir: string, tmp = tmpdir()): string | null {
  const abs = resolve(dir)
  if (!lstat(abs)?.isDirectory()) return `${abs} is not a folder`
  if (dirname(real(abs)) !== real(tmp))
    return `${abs} is not a folder made in the temp folder ${tmp}`
  if (!lstat(join(abs, MARKER))?.isFile()) return `${abs} has no ${MARKER} marker`
  rmSync(abs, { force: true, recursive: true })
  return null
}

// The one recursive delete of the trash: each batch over 7 days old, then the oldest while free space is under 50 GB; a batch whose real path is not a folder directly in the trash root is skipped.
export function purgeTrash(
  trash: string,
  io: { free: () => number; now: Date },
): { removed: string[]; skipped: string[] } {
  const root = real(trash)
  const removed: string[] = []
  const skipped: string[] = []
  const remove = (batch: string) => {
    const at = join(root, batch)
    if (!lstat(at)?.isDirectory() || dirname(real(at)) !== root) {
      skipped.push(batch)
      return
    }
    rmSync(at, { force: true, recursive: true })
    removed.push(batch)
  }
  const cutoff = io.now.getTime() - PURGE.days * 86_400_000
  const left: string[] = []
  for (const batch of batches(root))
    if (stampMs(BATCH.exec(batch)![1]!) < cutoff) remove(batch)
    else left.push(batch)
  while (left.length && io.free() < PURGE.minFree) remove(left.shift()!)
  return { removed, skipped }
}
