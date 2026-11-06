import { existsSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

type Git = (...args: string[]) => Promise<{ code: number; out: string }>

const BUNDLED = "scripts/hooks/bundled/"

// The blob at rev:path written beside path and renamed over it, so a reader finds the old file or the new one, the temp file removed when either throws; false when rev lacks it.
const place = (repo: string, rev: string, path: string): boolean => {
  const blob = Bun.spawnSync(["git", "-C", repo, "cat-file", "blob", `${rev}:${path}`], {
    stderr: "pipe",
    stdout: "pipe",
  })
  if (blob.exitCode !== 0) return false
  const temp = join(repo, `${path}.${process.pid}.tmp`)
  try {
    writeFileSync(temp, blob.stdout)
    renameSync(temp, join(repo, path))
  } catch (error) {
    if (existsSync(temp)) unlinkSync(temp)
    throw error
  }
  return true
}

// Each path back at HEAD's bundle by the same rename, one HEAD lacks removed, and the index reset to HEAD for them, so a swap or a move that stops leaves the checkout as it was and the next pull moves it; non-zero, naming each path, when a path could not be put back.
export const unswapBundles = async (
  repo: string,
  git: Git,
  paths: string[],
): Promise<{ code: number; out: string }> => {
  const failed: string[] = []
  for (const path of paths)
    try {
      if (!place(repo, "HEAD", path) && existsSync(join(repo, path))) unlinkSync(join(repo, path))
    } catch (error) {
      failed.push(`${path}: ${String(error)}`)
    }
  const reset = paths.length ? await git("reset", "-q", "--", ...paths) : { code: 0, out: "" }
  if (failed.length === 0) return reset
  return { code: 1, out: [...failed, reset.out.trim()].filter(Boolean).join("; ") }
}

// Every guard loads its bundle from the main checkout's scripts/hooks/bundled, and git rewrites a file it moves in place (unlink, then write), so a guard that starts mid-move can load a missing or half-written bundle and fail closed. So before the move, each bundle the target adds or changes is renamed in whole over its path and staged, and the move finds it at the target and leaves it alone; a swap that fails at any step puts back what it wrote (its putBack), and the swapped paths come back for unswapBundles after a move that fails.
export const swapBundles = async (
  repo: string,
  git: Git,
  target: string,
): Promise<{
  code: number
  out: string
  putBack?: { code: number; out: string }
  swapped: string[]
}> => {
  const listed = await git("diff", "-z", "--name-status", "--no-renames", "HEAD", target)
  if (listed.code !== 0) return { ...listed, swapped: [] }
  const fields = listed.out.split("\0")
  const paths: string[] = []
  for (let i = 0; i + 1 < fields.length; i += 2)
    if ((fields[i] === "A" || fields[i] === "M") && fields[i + 1]!.startsWith(BUNDLED))
      paths.push(fields[i + 1]!)
  if (paths.length === 0) return { code: 0, out: "", swapped: [] }
  const done: string[] = []
  let failed = { code: 1, out: "" }
  try {
    for (const path of paths) {
      if (!place(repo, target, path)) throw new Error(`${target} lacks ${path}`)
      done.push(path)
    }
    const staged = await git("add", "--", ...paths)
    if (staged.code === 0) return { ...staged, swapped: paths }
    failed = staged
  } catch (error) {
    failed = { code: 1, out: String(error) }
  }
  return { ...failed, putBack: await unswapBundles(repo, git, done), swapped: [] }
}
