import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { preToolUseGuards } from "./ops-tick/guard-probe"

// hooks-bundle: each PreToolUse guard in scripts/hooks/ bundled with everything it imports into scripts/hooks/bundled/<guard>.js, the file its wrapper runs, so a guard starts with no node_modules; the bundles are committed, since a git restore of a deleted checkout brings it back with no install. `--check` builds in memory and names each file that differs from a fresh build.
export const ROOT = join(import.meta.dir, "..", "..", "..")
export const HOOKS = join("scripts", "hooks")
export const BUNDLED = join(HOOKS, "bundled")

// no-extensions-write runs its check in this Worker, which it starts by URL beside its own file.
const WORKERS = ["no-extensions-write-worker"]

// A bundled module reads import.meta.dir as the folder of its source, scripts/hooks/, one up from the bundle, so each path a guard builds from it holds.
const BANNER = 'const __HOOK_DIR = import.meta.dir.slice(0, import.meta.dir.lastIndexOf("/"));'

export const entries = async (root: string): Promise<string[]> => [
  ...(await preToolUseGuards(root)),
  ...WORKERS,
]

// Each bundle's file name and text, built from root's sources.
export async function bundle(root: string): Promise<Map<string, string>> {
  const entrypoints = (await entries(root)).map((name) => join(root, HOOKS, `${name}.ts`))
  // Bun names each module in a comment by its path from the working folder, so the build runs from root and its text is the same wherever it is called from.
  const cwd = process.cwd()
  process.chdir(root)
  const result = await Bun.build({
    banner: BANNER,
    define: { "import.meta.dir": "__HOOK_DIR" },
    entrypoints,
    naming: "[name].js",
    root: join(root, HOOKS),
    target: "bun",
  }).finally(() => process.chdir(cwd))
  if (!result.success) throw new AggregateError(result.logs, "hooks-bundle: the build failed")
  const files = new Map<string, string>()
  for (const output of result.outputs)
    files.set(output.path.replace(/^.*\//, ""), await output.text())
  return files
}

// Each file in root's bundled folder that a fresh build would write otherwise, or that no build writes.
export async function stale(root: string): Promise<string[]> {
  const fresh = await bundle(root)
  const onDisk = await readdir(join(root, BUNDLED)).catch(() => [] as string[])
  const names = [...new Set([...fresh.keys(), ...onDisk])].sort()
  const drift: string[] = []
  for (const name of names) {
    const file = Bun.file(join(root, BUNDLED, name))
    const text = (await file.exists()) ? await file.text() : undefined
    if (text !== fresh.get(name)) drift.push(name)
  }
  return drift
}

export const FIX =
  "run `bun run hooks:bundle` and commit scripts/hooks/bundled; after a merge that conflicts there, take either side and run it again"

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const drift = await stale(ROOT)
    if (drift.length) {
      console.error(`hooks-bundle: stale in ${BUNDLED}: ${drift.join(", ")}; ${FIX}`)
      process.exit(1)
    }
  } else {
    for (const [name, text] of await bundle(ROOT)) await Bun.write(join(ROOT, BUNDLED, name), text)
    console.log(`hooks-bundle: wrote ${BUNDLED}`)
  }
}
