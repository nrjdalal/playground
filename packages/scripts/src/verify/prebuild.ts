import "@packages/env/aliases"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"

import { withoutShebang } from "../shebang"

// verify, pr:merge and the dev launcher reach each workspace package through its built dist, which a fresh worktree lacks, and which a pulled change can outgrow by adding an export; it builds them only then, since a rebuild cleans the dist a running stack in this worktree imports (`bun run dev` refuses before this runs while one does). A dist that exists but lacks an export counts as unbuilt; any other stale dist is left as it is.
const VERIFY = import.meta.dir
const SRC = join(VERIFY, "..")
const ROOT = join(VERIFY, "../../../..")

// `api` reads the API's sources and builds @api/hono's dependencies; any other target is a folder under packages/scripts/src.
const dirOf = (target: string): string =>
  target === "api" ? join(ROOT, "api/hono/src") : join(SRC, target)

const transpiler = new Bun.Transpiler({ loader: "ts" })

// Every workspace package the given sources import, statically or dynamically.
export const workspaceImports = (sources: string[]): string[] => [
  ...new Set(
    sources.flatMap((source) =>
      transpiler
        .scanImports(withoutShebang(source))
        .map(({ path }) => path)
        .filter((path) => path.startsWith("@packages/")),
    ),
  ),
]

// The imports that resolve to nothing yet, an exports target whose file is missing among them.
export const unbuilt = (specifiers: string[], from: string): string[] =>
  specifiers.filter((specifier) => {
    try {
      Bun.resolveSync(specifier, from)
      return false
    } catch {
      return true
    }
  })

// Every source of one target: a folder under packages/scripts/src, or the API.
export const sourcesIn = async (target: string): Promise<string[]> =>
  Promise.all(
    [...new Bun.Glob("**/*.ts").scanSync(dirOf(target))].map((name) =>
      Bun.file(join(dirOf(target), name)).text(),
    ),
  )

// The factory's main checkout, which spawn.sh exports as PLAYGROUND_REPO, stays clean: every installed skill follows it.
export const isMainCheckout = (root: string, repo: string | undefined): boolean => {
  if (!repo) return false
  try {
    return realpathSync(root) === realpathSync(repo)
  } catch {
    return false
  }
}

// A worktree installed before a canary pull that added a workspace package, or a dependency of one, lacks its links, and its build then stops on "tsdown: command not found" or its run on "Cannot find module"; pr:merge refuses it naming the install that fixes it, while verify and `bun run dev`, the live dashboard's serve among them, build on as before.
export const staleInstall = (target: string, root: string): string | null => {
  const { workspaces } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const globs: string[] = Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? [])
  const missing = globs.flatMap((glob) =>
    [...new Bun.Glob(`${glob}/package.json`).scanSync({ cwd: root })].flatMap((manifest) => {
      const dir = dirname(manifest)
      const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8"))
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
        (dep) =>
          !existsSync(join(root, dir, "node_modules", dep)) &&
          !existsSync(join(root, "node_modules", dep)),
      )
      return deps.length > 0 ? [`${dir} (${deps.join(", ")})`] : []
    }),
  )
  if (missing.length === 0) return null
  return `${target}: this worktree's install predates its bun.lock and misses ${missing.join(", ")}; run \`~/.playground/ops/run-slot.sh <your name> -- bun install --ignore-scripts --cwd ${root}\`, then run ${target} again`
}

// What prebuild does before a target runs: the refusal it stops on, else the packages it builds, none when every dist is built. pr:merge checks its install on every run, since a canary merge can add a dependency to a package whose dist is already built, which then fails on "Cannot find module".
export const prebuildStep = (
  target: string,
  missing: string[],
  root: string,
  repo: string | undefined,
): { refused: string } | { build: string[] } => {
  if (missing.length > 0 && isMainCheckout(root, repo))
    return {
      refused: `${target}: ${missing.join(", ")} is unbuilt here, and the factory's main checkout builds only packages/* after a pull; run it from your own worktree`,
    }
  const stale = target === "pr-merge" ? staleInstall(target, root) : null
  return stale ? { refused: stale } : { build: missing }
}

if (import.meta.main) {
  const target = process.argv[2] ?? "verify"
  const step = prebuildStep(
    target,
    unbuilt(workspaceImports(await sourcesIn(target)), dirOf(target)),
    ROOT,
    process.env.PLAYGROUND_REPO,
  )
  if ("refused" in step) {
    console.error(step.refused)
    process.exit(1)
  }
  if (step.build.length > 0) {
    console.error(`${target}: building what ${step.build.join(", ")} needs`)
    // turbo's output goes to stderr, so `verify --json` keeps stdout to itself
    const build = Bun.spawnSync(
      [
        join(ROOT, "node_modules/.bin/turbo"),
        "run",
        "build",
        `--filter=${target === "api" ? "@api/hono" : "@packages/scripts"}^...`,
        "--output-logs=errors-only",
      ],
      { cwd: ROOT, stdio: ["ignore", 2, "inherit"] },
    )
    if (build.exitCode !== 0) process.exit(build.exitCode ?? 1)
  }
}
