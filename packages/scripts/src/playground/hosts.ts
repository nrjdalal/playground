import { dirname, join, resolve } from "node:path"

import { portlessDir, prefixOf } from "../../../../api/hono/src/lib/dev/proxy"

export type Hosts = { api: string; web: string }

// portless's own cli, run by path so no bunx lookup happens in the folder it runs in (brief-rush's `bunx --cwd` trap)
const PORTLESS = join(dirname(Bun.resolveSync("portless", import.meta.dir)), "cli.js")

const git = (dir: string, ...args: string[]): string | null => {
  const run = Bun.spawnSync(["git", "-C", dir, ...args], { stderr: "ignore", stdin: "ignore" })
  return run.exitCode === 0 ? run.stdout.toString().trim() : null
}

// The linked worktree a folder sits in, with the prefix portless gives its stack's hosts (prefixOf), or null wherever portless gives the bare names: outside git, the main checkout, a detached HEAD, main or master
export const worktreeOf = (dir: string): { prefix: string; top: string } | null => {
  const top = git(dir, "rev-parse", "--show-toplevel")
  const own = git(dir, "rev-parse", "--path-format=absolute", "--git-dir")
  const common = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir")
  const branch = git(dir, "symbolic-ref", "--quiet", "--short", "HEAD")
  const prefix = branch ? prefixOf(branch) : null
  return top && own && common && own !== common && prefix ? { prefix, top } : null
}

// A worktree's own web and API URLs by its path, from any folder: portless names a stack's hosts from the branch of the folder it runs in, so it runs in the worktree, in the state folder portlessDir() picks; a path whose hosts would be the bare names, the live dashboard's, is refused, and so is any URL not on the worktree's prefix
export const hostsOf = (
  path: string,
  env: Record<string, string | undefined> = process.env,
): Hosts | { error: string } => {
  const own = worktreeOf(path)
  if (!own)
    return {
      error: `${path} is not a linked worktree on a branch portless prefixes, so its hosts would be the bare names, the live dashboard's: name the worktree your stack runs in`,
    }
  const get = (name: string) => {
    const run = Bun.spawnSync([process.execPath, PORTLESS, "get", name], {
      cwd: own.top,
      env: { ...env, PORTLESS_STATE_DIR: portlessDir(env) },
      stderr: "ignore",
      stdin: "ignore",
    })
    return run.exitCode === 0 ? run.stdout.toString().trim() : ""
  }
  const hosts = { api: get("api.playground"), web: get("playground") }
  const stray = [hosts.web, hosts.api].find(
    (url) => !URL.canParse(url) || !new URL(url).hostname.startsWith(`${own.prefix}.`),
  )
  return stray === undefined
    ? hosts
    : {
        error: `portless gave ${stray || "no URL"} for ${own.top}, not a host on its prefix ${own.prefix}`,
      }
}

const USAGE = "usage: playground hosts [<worktree>] [web|api]"

// playground hosts [<worktree>] [web|api]: both URLs as `web <url>` and `api <url>`, or the one asked alone, for `WEB=$(playground hosts <worktree> web)`; the worktree is the current folder when none is named
export const hostsCli = (
  args: string[],
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): { code: number; out: string } => {
  const side = args.find((arg): arg is "api" | "web" => arg === "api" || arg === "web")
  const paths = args.filter((arg) => arg !== side)
  if (paths.length > 1 || paths.some((arg) => arg.startsWith("-"))) return { code: 1, out: USAGE }
  const hosts = hostsOf(resolve(cwd, paths[0] ?? "."), env)
  if ("error" in hosts) return { code: 1, out: hosts.error }
  return { code: 0, out: side ? hosts[side] : `web ${hosts.web}\napi ${hosts.api}` }
}
