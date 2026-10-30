import "@packages/env/aliases"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

// The factory's main checkout for TypeScript jobs: PLAYGROUND_REPO, else the main checkout of the checkout this code sits in, else playground in the code root's default (the folder that holds that checkout); scripts/ops/beat.py's checkout() reads the job's folder first.
export const mainCheckout = (from = join(import.meta.dir, "..", "..", "..")) => {
  if (process.env.PLAYGROUND_REPO) return process.env.PLAYGROUND_REPO
  const git = Bun.spawnSync([
    "git",
    "-C",
    from,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ])
  const root = git.exitCode === 0 ? dirname(git.stdout.toString().trim()) : from
  return existsSync(join(root, "scripts", "spawn.sh")) ? root : join(dirname(from), "playground")
}
