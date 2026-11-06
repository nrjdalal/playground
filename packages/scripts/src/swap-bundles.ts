import { renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

type Git = (...args: string[]) => Promise<{ code: number; out: string }>

const BUNDLED = "scripts/hooks/bundled"

// Every guard loads its bundle from the main checkout's scripts/hooks/bundled, and git rewrites a file it moves in place (unlink, then write), so a guard that starts mid-move can load a missing or half-written bundle and fail closed. So before the move, each bundle the target adds or changes is written beside its path and renamed over it, then staged, and the move finds it at the target and leaves it alone; the swapped paths come back for unswapBundles.
export const swapBundles = async (
  repo: string,
  git: Git,
  target: string,
): Promise<{ code: number; out: string; swapped: string[] }> => {
  const listed = await git("diff", "--name-status", "--no-renames", "HEAD", target, "--", BUNDLED)
  if (listed.code !== 0) return { ...listed, swapped: [] }
  const paths = listed.out
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([status, path]) => path && (status === "A" || status === "M"))
    .map(([, path]) => path!)
  const done: string[] = []
  for (const path of paths) {
    const blob = Bun.spawnSync(["git", "-C", repo, "cat-file", "blob", `${target}:${path}`], {
      stderr: "pipe",
      stdout: "pipe",
    })
    if (blob.exitCode !== 0)
      return { code: blob.exitCode, out: blob.stderr.toString(), swapped: done }
    const temp = join(repo, `${path}.${process.pid}.tmp`)
    writeFileSync(temp, blob.stdout)
    renameSync(temp, join(repo, path))
    done.push(path)
  }
  if (paths.length === 0) return { code: 0, out: "", swapped: [] }
  return { ...(await git("add", "--", ...paths)), swapped: paths }
}

// After a move that failed, the swapped bundles go back to HEAD's, a bundle HEAD lacks removed, as update.ts puts back the manifests it staged; git writes these in place, on this rare path alone.
export const unswapBundles = (git: Git, swapped: string[]) =>
  git("restore", "-q", "--source=HEAD", "--staged", "--worktree", "--", ...swapped)
