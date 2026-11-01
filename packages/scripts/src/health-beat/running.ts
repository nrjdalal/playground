import { join } from "node:path"

import type { Run } from "../ops-tick/tick"

// What this install runs, read and never acted on: the main checkout's version, and its branch's build or dev server as the live Dashboard serves it, at the version its /api/health reports.

export type Running = { build: string; version: string }
export type Health = { reason: string } | { version: string }
type Answer = { code: number; out: string }

const WEB = "playground.localhost"
const API = "api.playground.localhost"

const firstLine = (out: string): string => out.trim().split("\n")[0] ?? ""

// Pure: `git describe --tags --long` as the tag, plus the commits the checkout is ahead of it.
export const versionOf = ({ code, out }: Answer): string => {
  const described = /^(.+)-(\d+)-g([0-9a-f]+)$/.exec(out.trim())
  if (code !== 0 || !described) return `unknown (git describe: ${firstLine(out) || "no output"})`
  const [, tag, ahead, sha] = described
  const n = Number(ahead)
  return n === 0 ? tag! : `${tag} + ${n} local commit${n === 1 ? "" : "s"} (${sha})`
}

// Pure: `git branch --show-current`, which prints nothing on a detached HEAD.
const branchOf = ({ code, out }: Answer): string => {
  if (code !== 0) return `unknown branch (git branch: ${firstLine(out) || "no output"})`
  return out.trim() || "unknown branch (detached HEAD)"
}

// Pure: the branch, then the process tree under root, from `ps -A -o pid=,ppid=,command=`, read as a build when a command runs from a /builds/<sha>/ path and as a dev server when one runs next dev, then /api/health's version, its sha alone when it ends in one.
export const buildOf = (input: {
  branch: Answer
  health: Health
  ps: string
  root: number | null
  why?: string
}): string => {
  const version =
    "version" in input.health
      ? (/-([0-9a-f]{7,40})$/.exec(input.health.version)?.[1] ?? input.health.version)
      : `unknown (${input.health.reason})`
  const kind = kindOf(input.ps, input.root, input.why)
  return `${branchOf(input.branch)}${kind.startsWith("unknown") ? ", " : " "}${kind}, at ${version}`
}

const kindOf = (ps: string, root: number | null, why = "no web route"): string => {
  if (root === null) return `unknown (${why})`
  const rows = ps
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((row) => row !== null)
    .map(([, pid, ppid, command]) => ({ command: command!, pid: Number(pid), ppid: Number(ppid) }))
  const tree = new Set([root])
  for (let grew = true; grew;) {
    grew = false
    for (const row of rows)
      if (tree.has(row.ppid) && !tree.has(row.pid)) {
        tree.add(row.pid)
        grew = true
      }
  }
  const commands = rows.filter((row) => tree.has(row.pid)).map((row) => row.command)
  if (commands.some((command) => /\/builds\/[0-9a-f]{7,40}\//.test(command))) return "build"
  if (commands.some((command) => /\bnext dev\b/.test(command))) return "dev server"
  return `unknown (neither a /builds/<sha>/ path nor next dev runs under pid ${root})`
}

type Route = { hostname: string; pid: number; port: number }

const readRoutes = async (portless: string): Promise<Route[]> => {
  try {
    const rows = (await Bun.file(join(portless, "routes.json")).json()) as unknown
    return Array.isArray(rows) ? (rows as Route[]) : []
  } catch {
    return []
  }
}

// The live Dashboard's web is whichever stack holds playground.localhost's port: the route itself when a stack holds the bare name, else the running route an alias follows (the live dashboard's desk route).
const webOwner = (routes: Route[]): { root: number } | { why: string } => {
  const bare = routes.find((route) => route.hostname === WEB)
  if (!bare) return { why: `portless has no route for ${WEB}` }
  const owner = bare.pid > 0 ? bare : routes.find((r) => r.port === bare.port && r.pid > 0)
  return owner ? { root: owner.pid } : { why: `no running stack holds ${WEB}'s port ${bare.port}` }
}

// The live Dashboard's /api/health on its loopback port, which the API binds.
export const fetchHealth = async (url: string): Promise<Health> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
    const body = (await response.json()) as { data?: { version?: unknown } }
    const version = body.data?.version
    return typeof version === "string"
      ? { version }
      : { reason: `/api/health answered ${response.status} with no version` }
  } catch (error) {
    return {
      reason: `/api/health did not answer: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

// Reads the two lines' values once: two git reads of the main checkout, portless's routes, one ps read and one GET.
export const readRunning = async (input: {
  health?: (url: string) => Promise<Health>
  portless: string
  repo: string
  run: Run
}): Promise<Running> => {
  const { repo, run } = input
  const routes = await readRoutes(input.portless)
  const api = routes.find((route) => route.hostname === API)
  const health = api
    ? await (input.health ?? fetchHealth)(`http://127.0.0.1:${api.port}/api/health`)
    : { reason: `portless has no route for ${API}` }
  const owner = webOwner(routes)
  return {
    build: buildOf({
      branch: await run(["git", "-C", repo, "branch", "--show-current"]),
      health,
      ps: "root" in owner ? (await run(["ps", "-A", "-o", "pid=,ppid=,command="])).out : "",
      root: "root" in owner ? owner.root : null,
      why: "why" in owner ? owner.why : undefined,
    }),
    version: versionOf(
      await run(["git", "-C", repo, "describe", "--tags", "--long", "--abbrev=7"]),
    ),
  }
}
