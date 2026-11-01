import { join } from "node:path"

import type { Run } from "../ops-tick/tick"

// What this install runs, read and never acted on: the main checkout's version beside main's latest tag, and the live Dashboard's build or dev server with its own checkout's branch, at the sha its /api/health reports and that sha's tag.

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

// Pure: the main checkout's version, then main's latest tag when the checkout does not hold it (ancestor is `git merge-base --is-ancestor <tag> HEAD`, exit 1 when it does not); a main tag it cannot read leaves the comparison out.
export const checkoutOf = (input: {
  ancestor?: Answer
  describe: Answer
  mainTag: Answer
}): string => {
  const version = versionOf(input.describe)
  const tag = firstLine(input.mainTag.out)
  return input.mainTag.code === 0 && tag && input.ancestor?.code === 1
    ? `${version}, behind main ${tag}`
    : version
}

// Pure: the Dashboard checkout's `git branch --show-current`, then the process trees under root and under each pid listening on the route's port, from `ps -A -o pid=,ppid=,command=`, read as a build when a command runs from a /builds/<sha>/ path and as a dev server when one runs next dev, then /api/health's version, its sha alone when it ends in one.
// The listeners matter on a supervised stack: its run.sh owns the route so a web swap is one write, while the web it starts runs with ppid 1 on the route's port.
// A branch that is not read, fails or is a detached HEAD leaves the branch word out, since the main checkout's branch says nothing of the Dashboard's.
export const buildOf = (input: {
  branch?: Answer
  health: Health
  kind?: ReturnType<typeof kindOf>
  listeners?: number[]
  port?: number
  ps: string
  root: number | null
  tag?: Answer
  why?: string
}): string => {
  const sha = shaOf(input.health)
  const tag =
    input.tag === undefined
      ? ""
      : input.tag.code === 0 && firstLine(input.tag.out)
        ? ` (${firstLine(input.tag.out)})`
        : ` (tag unknown: git describe: ${firstLine(input.tag.out) || "no output"})`
  const version =
    "version" in input.health
      ? `${sha ?? input.health.version}${tag}`
      : `unknown (${input.health.reason})`
  const kind = input.kind ?? kindOf(input)
  const branch =
    input.branch?.code === 0 && firstLine(input.branch.out) ? firstLine(input.branch.out) : ""
  const what = "kind" in kind ? `${branch} ${kind.kind}`.trim() : `unknown (${kind.unknown})`
  return `${what}, at ${version}`
}

// The sha /api/health's version ends in, when it ends in one.
const shaOf = (health: Health): string | undefined =>
  "version" in health ? /-([0-9a-f]{7,40})$/.exec(health.version)?.[1] : undefined

// Pure: the build or dev server under root or a listener, with the pid of the first process that shows it, whose working folder is the Dashboard's checkout.
export const kindOf = ({
  listeners = [],
  port,
  ps,
  root,
  why = "no web route",
}: {
  listeners?: number[]
  port?: number
  ps: string
  root: number | null
  why?: string
}): { kind: string; pid: number } | { unknown: string } => {
  if (root === null) return { unknown: why }
  const rows = ps
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((row) => row !== null)
    .map(([, pid, ppid, command]) => ({ command: command!, pid: Number(pid), ppid: Number(ppid) }))
  const tree = new Set([root, ...listeners].filter((pid) => rows.some((row) => row.pid === pid)))
  if (tree.size === 0) return { unknown: `pid ${root} is not running` }
  for (let grew = true; grew;) {
    grew = false
    for (const row of rows)
      if (tree.has(row.ppid) && !tree.has(row.pid)) {
        tree.add(row.pid)
        grew = true
      }
  }
  const inTree = rows.filter((row) => tree.has(row.pid))
  const built = inTree.find((row) => /\/builds\/[0-9a-f]{7,40}\//.test(row.command))
  if (built) return { kind: "build", pid: built.pid }
  const dev = inTree.find((row) => /\bnext dev\b/.test(row.command))
  if (dev) return { kind: "dev server", pid: dev.pid }
  return {
    unknown: `neither a /builds/<sha>/ path nor next dev runs under pid ${root}${port === undefined ? "" : ` or on port ${port}`}`,
  }
}

type Route = { hostname: string; pid: number; port: number }

const readRoutes = async (portless: string): Promise<Route[]> => {
  try {
    const rows = (await Bun.file(join(portless, "routes.json")).json()) as unknown
    return Array.isArray(rows)
      ? rows.filter(
          (row): row is Route =>
            typeof row?.hostname === "string" &&
            typeof row.port === "number" &&
            typeof row.pid === "number",
        )
      : []
  } catch {
    return []
  }
}

// The live Dashboard's web is whichever stack holds playground.localhost's port: the route itself when a stack holds the bare name, else the running route an alias follows (the live dashboard's desk route).
const webOwner = (routes: Route[]): { port: number; root: number } | { why: string } => {
  const bare = routes.find((route) => route.hostname === WEB)
  if (!bare) return { why: `portless has no route for ${WEB}` }
  const owner = bare.pid > 0 ? bare : routes.find((r) => r.port === bare.port && r.pid > 0)
  return owner
    ? { port: bare.port, root: owner.pid }
    : { why: `no running stack holds ${WEB}'s port ${bare.port}` }
}

// The live Dashboard's /api/health on its loopback port, which the API binds.
export const fetchHealth = async (url: string): Promise<Health> => {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(3000) })
  } catch (error) {
    return {
      reason: `/api/health did not answer: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const body = (await response.json().catch(() => null)) as { data?: { version?: unknown } } | null
  if (body === null) return { reason: `/api/health answered ${response.status}, not JSON` }
  const version = body.data?.version
  return typeof version === "string"
    ? { version }
    : { reason: `/api/health answered ${response.status} with no version` }
}

// The pids listening on a loopback TCP port, by lsof's own read; none when lsof finds none or fails.
const listenersOn = async (run: Run, port: number): Promise<number[]> =>
  (await run(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])).out
    .split("\n")
    .filter((line) => /^\d+$/.test(line.trim()))
    .map(Number)

// A process's working folder, from lsof's `n` field; undefined when lsof cannot read it.
const cwdOf = async (run: Run, pid: number): Promise<string | undefined> =>
  (await run(["lsof", "-a", "-p", String(pid), "-d", "cwd", "-Fn"])).out
    .split("\n")
    .find((line) => line.startsWith("n/"))
    ?.slice(1)

// The Dashboard's own checkout: the working folder of the process that shows the kind, else of its parent, then of that parent's parent, since next's standalone server.js moves into its build folder, which is in no repo, while the launcher above it works in the checkout.
const checkoutUp = async (
  run: Run,
  ps: string,
  pid: number,
): Promise<{ branch: Answer; folder: string } | undefined> => {
  const parent = new Map(
    ps
      .split("\n")
      .map((line) => /^\s*(\d+)\s+(\d+)\s/.exec(line))
      .filter((row) => row !== null)
      .map(([, child, ppid]) => [Number(child), Number(ppid)] as const),
  )
  for (let at = pid, step = 0; at > 1 && step < 3; at = parent.get(at) ?? 0, step++) {
    const folder = await cwdOf(run, at)
    const branch = folder ? await run(["git", "-C", folder, "branch", "--show-current"]) : undefined
    if (folder && branch?.code === 0) return { branch, folder }
  }
  return undefined
}

// Reads the two lines' values once: three git reads of the main checkout (its describe, main's latest tag and whether HEAD holds it), portless's routes, one ps read, lsof reads of the web's port and of up to 3 working folders up its process chain, the branch and the sha's tag in the Dashboard's checkout (the tag in the main checkout when none is found), and one GET.
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
  const git = (...args: string[]) => run(["git", "-C", repo, ...args])
  const mainTag = await git("describe", "--tags", "--abbrev=0", "origin/main")
  const sha = shaOf(health)
  const web = {
    listeners: "root" in owner ? await listenersOn(run, owner.port) : [],
    port: "root" in owner ? owner.port : undefined,
    ps: "root" in owner ? (await run(["ps", "-A", "-o", "pid=,ppid=,command="])).out : "",
    root: "root" in owner ? owner.root : null,
    why: "why" in owner ? owner.why : undefined,
  }
  const kind = kindOf(web)
  const dashboard = "pid" in kind ? await checkoutUp(run, web.ps, kind.pid) : undefined
  return {
    build: buildOf({
      ...web,
      branch: dashboard?.branch,
      health,
      kind,
      tag: sha
        ? await run([
            "git",
            "-C",
            dashboard?.folder ?? repo,
            "describe",
            "--tags",
            "--abbrev=0",
            sha,
          ])
        : undefined,
    }),
    version: checkoutOf({
      ancestor:
        mainTag.code === 0
          ? await git("merge-base", "--is-ancestor", firstLine(mainTag.out), "HEAD")
          : undefined,
      describe: await git("describe", "--tags", "--long", "--abbrev=7"),
      mainTag,
    }),
  }
}
