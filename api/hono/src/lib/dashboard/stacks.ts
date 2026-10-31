import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import { env } from "@packages/env/api-hono"
import { RouteStore } from "portless"

import { checkoutRoot, readFixtureMachine, readsLive } from "@/lib/dashboard/fixture"
import { dashboardHub } from "@/lib/dashboard/hub"
import { listLive } from "@/lib/dashboard/workers"
import { portlessDir } from "@/lib/dev/proxy"
import { readRecord, RECORD } from "@/lib/dev/stop"

// A worktree of a project this machine works in, for the Inbox's Preview row: its stack's https URL while `bun run dev` serves it there, else null, and the session working in it.
export type Stack = {
  branch: string | null
  // its host's first label while it runs, else its folder's name
  name: string
  path: string | null
  project: string
  session: string | null
  url: string | null
}

export type Worktree = { branch: string | null; path: string; project: string }

type Route = { childPgid?: unknown; hostname?: unknown; pid?: unknown }
type WebRoute = { groups: number[]; hostname: string }

// Pure: each web host with a process behind it: an API host (an `api` label), an alias (pid 0, as portless writes one), a bare app host (the live dashboard's second name) and an outside host left out.
export function webRoutes(routes: unknown): WebRoute[] {
  if (!Array.isArray(routes)) return []
  return (routes as Route[]).flatMap(({ childPgid, hostname, pid }) => {
    if (typeof hostname !== "string" || typeof pid !== "number" || pid <= 0) return []
    const labels = hostname.split(".")
    if (labels.length < 3 || labels.at(-1) !== "localhost" || labels.includes("api")) return []
    return [{ groups: typeof childPgid === "number" ? [childPgid] : [], hostname }]
  })
}

// Pure: the session working in each worktree, by the deepest worktree holding its folder, so a session in a linked worktree never counts for the checkout around it; the first A to Z where several share one.
export function ownersOf(
  sessions: readonly { cwd: string; name: string }[],
  paths: readonly string[],
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const { cwd, name } of sessions.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const home = paths
      .filter((path) => cwd === path || cwd.startsWith(`${path}/`))
      .toSorted((a, b) => b.length - a.length)[0]
    if (home && !owners.has(home)) owners.set(home, name)
  }
  return owners
}

const byPlace = (a: Stack, b: Stack) =>
  a.project.localeCompare(b.project) ||
  (a.branch ?? "\uffff").localeCompare(b.branch ?? "\uffff") ||
  a.name.localeCompare(b.name)

// Pure: every worktree, running where a web route belongs to a process group its stack's record names, then each web route no worktree claims under its app's name; by project, then branch, A to Z.
export function stacksOf({
  records,
  routes,
  sessions,
  worktrees,
}: {
  records: ReadonlyMap<string, readonly number[]>
  routes: unknown
  sessions: readonly { cwd: string; name: string }[]
  worktrees: readonly Worktree[]
}): Stack[] {
  const web = webRoutes(routes)
  const claimed = new Set<WebRoute>()
  const owners = ownersOf(
    sessions,
    worktrees.map((worktree) => worktree.path),
  )
  const stacks = worktrees.map(({ branch, path, project }): Stack => {
    const groups = records.get(path) ?? []
    const route = web.find((r) => !claimed.has(r) && r.groups.some((g) => groups.includes(g)))
    if (route) claimed.add(route)
    const labels = route?.hostname.split(".")
    return {
      branch,
      name: labels?.[0] ?? basename(path),
      path,
      project,
      session: owners.get(path) ?? null,
      url: route ? `https://${route.hostname}` : null,
    }
  })
  for (const route of web.filter((r) => !claimed.has(r))) {
    const labels = route.hostname.split(".")
    stacks.push({
      branch: null,
      name: labels[0] ?? "",
      path: null,
      project: labels.at(-2) ?? "",
      session: null,
      url: `https://${route.hostname}`,
    })
  }
  return stacks.toSorted(byPlace)
}

const read = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8").trim()
  } catch {
    return null
  }
}

// The git folder every worktree of a checkout shares, from any folder inside one: a `.git` folder is its own, a `.git` file points at a worktree's folder, whose `commondir` names the shared one.
export function commonDirOf(from: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const git = join(dir, ".git")
    if (existsSync(git)) {
      if (statSync(git).isDirectory()) return git
      const own = read(git)?.match(/^gitdir:\s*(.+)$/)?.[1]
      if (!own) return null
      const gitdir = resolve(dir, own)
      const common = read(join(gitdir, "commondir"))
      return common ? resolve(gitdir, common) : gitdir
    }
    if (dirname(dir) === dir) return null
  }
}

// Pure: the branch a HEAD file names, null on a detached HEAD.
export const branchOf = (head: string | null): string | null =>
  head?.match(/^ref:\s*refs\/heads\/(.+)$/)?.[1] ?? null

// Pure: the repository's name from its git config's origin URL, over https or ssh, with or without .git; null with no origin.
export const projectOf = (config: string | null): string | null => {
  const url = config?.match(/\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/)?.[1]
  return (
    url
      ?.replace(/\.git$/, "")
      .split(/[/:]/)
      .at(-1) || null
  )
}

// Every worktree of the checkout whose git folder this is, read from git's own files: the checkout around it, then each linked worktree whose folder is still there.
export function worktreesOf(common: string): Worktree[] {
  const project = projectOf(read(join(common, "config"))) ?? basename(dirname(common))
  const main: Worktree[] =
    basename(common) === ".git"
      ? [{ branch: branchOf(read(join(common, "HEAD"))), path: dirname(common), project }]
      : []
  const linked = join(common, "worktrees")
  const names = existsSync(linked) ? readdirSync(linked) : []
  return [
    ...main,
    ...names.flatMap((name) => {
      const gitFile = read(join(linked, name, "gitdir"))
      const path = gitFile ? dirname(gitFile) : null
      if (!path || !existsSync(path)) return []
      return [{ branch: branchOf(read(join(linked, name, "HEAD"))), path, project }]
    }),
  ]
}

// The process groups a worktree's `bun run dev` recorded, its launcher's and each task's.
const groupsOf = (path: string): number[] => {
  const record = readRecord(join(path, RECORD))
  return record ? [record.pgid, ...(record.groups ?? []).map((group) => group.pgid)] : []
}

// The machine's worktrees, from this checkout and every folder a live session works in, with the stacks portless's own store serves (it drops a route whose process has gone); a fixture stack reads the fixture's made-up worktrees, `$WEB` there naming its own web URL, so its link opens in a tab.
export async function readStacks(): Promise<Stack[]> {
  const sessions = await Promise.resolve(dashboardHub.snapshot ?? listLive())
    .then((live) => live.workers)
    .catch(() => [])
  if (!readsLive()) {
    const worktrees = readFixtureMachine().worktrees ?? []
    const owners = ownersOf(
      sessions,
      worktrees.map((worktree) => worktree.path),
    )
    return worktrees
      .map(({ url, ...worktree }) => {
        const own = url?.replace("$WEB", env.HONO_TRUSTED_ORIGINS[0] ?? "") ?? null
        return {
          ...worktree,
          name: own ? (new URL(own).hostname.split(".")[0] ?? "") : basename(worktree.path),
          session: owners.get(worktree.path) ?? null,
          url: own,
        }
      })
      .toSorted(byPlace)
  }
  const commons = new Set<string>()
  for (const from of [checkoutRoot(), ...sessions.map((session) => session.cwd)]) {
    const common = from ? commonDirOf(from) : null
    if (common) commons.add(common)
  }
  const worktrees = [...commons].flatMap((common) => worktreesOf(common))
  let routes: unknown = []
  try {
    routes = new RouteStore(portlessDir()).loadRoutes()
  } catch {}
  return stacksOf({
    records: new Map(worktrees.map((worktree) => [worktree.path, groupsOf(worktree.path)])),
    routes,
    sessions,
    worktrees,
  })
}
