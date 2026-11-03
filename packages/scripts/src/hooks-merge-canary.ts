import { join } from "node:path"

import { BUNDLED, bundle, ROOT } from "./hooks-bundle"

// hooks-merge-canary: merges origin/canary into the branch checked out at root in the order a hook PR needs: a conflict only in scripts/hooks/bundled/ takes canary's side there and commits the merge, any other conflict aborts the merge, and the bundles rebuilt from the merged sources go in a commit of their own, so pr:merge's keeps-canary gate finds no bundle line lost inside the merge.

export type Outcome = { code: number; message: string }

// Runs git in root, its exit code and output.
const gitIn = (root: string) => (args: string[]) => {
  const proc = Bun.spawnSync(["git", "-C", root, ...args], { stderr: "pipe", stdout: "pipe" })
  return { code: proc.exitCode, out: `${proc.stdout}${proc.stderr}`.trim() }
}

export async function mergeCanary(root: string): Promise<Outcome> {
  const git = gitIn(root)
  // A merge abort cannot always bring back uncommitted changes, so the merge starts from a clean tree.
  const dirty = git(["status", "--porcelain", "--untracked-files=no"])
  if (dirty.code !== 0 || dirty.out)
    return {
      code: 1,
      message: `hooks-merge-canary: commit or set aside your changes first, since a merge abort cannot always bring them back:\n${dirty.out}`,
    }
  const fetch = git(["fetch", "-q", "origin", "canary"])
  if (fetch.code !== 0)
    return { code: 1, message: `hooks-merge-canary: git fetch origin canary failed: ${fetch.out}` }
  const before = git(["rev-parse", "HEAD"]).out
  const merge = git(["merge", "--no-edit", "origin/canary"])
  if (merge.code !== 0) {
    const conflicts = git(["diff", "--name-only", "--diff-filter=U"])
      .out.split("\n")
      .filter(Boolean)
    const others = conflicts.filter((path) => !path.startsWith(`${BUNDLED}/`))
    if (!conflicts.length || others.length) {
      git(["merge", "--abort"])
      return {
        code: 1,
        message: others.length
          ? `hooks-merge-canary: the merge conflicts outside ${BUNDLED}, so it was aborted and nothing was committed: ${others.join(", ")}; merge origin/canary by hand, resolving each conflict with both sides' meaning, commit the merge with canary's bundles as they are, then run \`bun run hooks:bundle\` and commit the rebuild on its own`
          : `hooks-merge-canary: git merge origin/canary failed, so it was aborted: ${merge.out}`,
      }
    }
    // canary's side of each conflicted bundle, or its removal where canary deleted it.
    for (const path of conflicts)
      if (git(["cat-file", "-e", `MERGE_HEAD:${path}`]).code === 0) {
        git(["checkout", "--theirs", "--", path])
        git(["add", "--", path])
      } else git(["rm", "-q", "--", path])
    const commit = git(["commit", "--no-edit"])
    if (commit.code !== 0)
      return {
        code: 1,
        message: `hooks-merge-canary: committing the merge failed, so it is still in progress with canary's bundles staged: ${commit.out}`,
      }
  }
  const merged = git(["rev-parse", "HEAD"]).out
  // The bundles inline what they import from node_modules, so a merge that changed bun.lock needs an install before they are rebuilt.
  if (merged !== before && git(["diff", "--quiet", before, merged, "--", "bun.lock"]).code !== 0)
    return {
      code: 1,
      message: `hooks-merge-canary: merged origin/canary as ${merged.slice(0, 7)}, and it changed bun.lock: run \`bun install\`, then \`bun run hooks:bundle\`, and commit the rebuild on its own`,
    }
  for (const [name, text] of await bundle(root)) await Bun.write(join(root, BUNDLED, name), text)
  if (!git(["status", "--porcelain", "--", BUNDLED]).out)
    return {
      code: 0,
      message: `hooks-merge-canary: merged origin/canary as ${merged.slice(0, 7)}; the bundles already match its sources`,
    }
  git(["add", "--", BUNDLED])
  const rebuild = git([
    "commit",
    "-q",
    "-m",
    "chore(hooks): rebuild the bundles on the merged canary",
  ])
  if (rebuild.code !== 0)
    return {
      code: 1,
      message: `hooks-merge-canary: merged origin/canary as ${merged.slice(0, 7)}, but committing the rebuild failed, so it stays staged: ${rebuild.out}`,
    }
  return {
    code: 0,
    message: `hooks-merge-canary: merged origin/canary as ${merged.slice(0, 7)} and committed the rebuilt bundles as ${git(["rev-parse", "--short", "HEAD"]).out}`,
  }
}

if (import.meta.main) {
  const { code, message } = await mergeCanary(ROOT)
  console[code ? "error" : "log"](message)
  process.exit(code)
}
