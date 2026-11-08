// pre-push's keeps-canary imports @packages/config, whose exports read its dist alone, and a fresh worktree has none, whichever way it took node_modules: this builds it first, or names the fix when the build fails.

import { join } from "node:path"

export const CONFIG_DIST = "packages/config/dist/verdicts.mjs"
export const CONFIG_BUILD = ["bunx", "turbo", "run", "build", "--filter=@packages/config"]

export type Build = (root: string) => number

const turboBuild: Build = (root) =>
  Bun.spawnSync([...CONFIG_BUILD, "--output-logs=errors-only"], {
    cwd: root,
    env: {
      ...process.env,
      TURBO_CACHE_DIR:
        process.env.TURBO_CACHE_DIR ?? join(process.env.HOME ?? "", ".cache/turbo/playground"),
    },
    stderr: "inherit",
    stdout: "inherit",
  }).exitCode

// null when the checkout at root has @packages/config's dist, or builds it now; else the refusal naming the build through run-slot
export async function configDistRefusal(
  root: string,
  build: Build = turboBuild,
): Promise<string | null> {
  const dist = () => Bun.file(join(root, CONFIG_DIST)).exists()
  if (await dist()) return null
  if (build(root) === 0 && (await dist())) return null
  return `@packages/config has no dist (${CONFIG_DIST}) and its build failed: run ~/.playground/ops/run-slot.sh <your name> -- ${CONFIG_BUILD.join(" ")}, then push again`
}

if (import.meta.main) {
  const refusal = await configDistRefusal(join(import.meta.dir, "../../../.."))
  if (refusal) {
    console.error(`keeps-canary: ${refusal}`)
    process.exit(1)
  }
}
