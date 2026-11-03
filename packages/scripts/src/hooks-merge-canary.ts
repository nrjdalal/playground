import { join } from "node:path"

import { BUNDLED, ROOT } from "./hooks-bundle"

// hooks-merge-canary: merges origin/canary into the branch checked out at root in the order a hook PR needs: a conflict only in scripts/hooks/bundled/ takes canary's side there and commits the merge, any other conflict aborts the merge, and the bundles rebuilt from the merged sources go in a commit of their own, so pr:merge's keeps-canary gate finds no bundle line lost inside the merge.

type Outcome = { code: number; message: string }

const git = (args: string[]) => {
  const proc = Bun.spawnSync(["git", "-C", ROOT, ...args], { stderr: "pipe", stdout: "pipe" })
  return { code: proc.exitCode, out: `${proc.stdout}${proc.stderr}`.trim() }
}

// The merged checkout's own hooks-bundle.ts, run as a child, since a merge can change it or what it imports.
const hooksBundle = (...args: string[]) => {
  const proc = Bun.spawnSync(
    ["bun", "--no-env-file", join(ROOT, "packages", "scripts", "src", "hooks-bundle.ts"), ...args],
    { cwd: ROOT, stderr: "pipe", stdout: "pipe" },
  )
  return { code: proc.exitCode, out: `${proc.stdout}${proc.stderr}`.trim() }
}

function mergeCanary(): Outcome {
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
    // canary's side of each conflicted bundle, or its removal where canary deleted it; the rebuild settles the rest.
    for (const path of conflicts)
      if (git(["cat-file", "-e", `MERGE_HEAD:${path}`]).code === 0) {
        git(["checkout", "--theirs", "--", path])
        git(["add", "--", path])
      } else git(["rm", "-q", "--", path])
    const commit = git(["commit", "--no-edit"])
    if (commit.code !== 0)
      return {
        code: 1,
        message: `hooks-merge-canary: committing the merge failed, so it is still in progress with canary's bundles staged: ${commit.out}\nFix what it names, run \`git commit --no-edit\`, then run \`bun run hooks:merge-canary\` again to rebuild the bundles`,
      }
  }
  const merged = git(["rev-parse", "HEAD"]).out
  // The bundles inline what they import from node_modules, so a merge that changed bun.lock needs an install before they are rebuilt.
  if (merged !== before && git(["diff", "--quiet", before, merged, "--", "bun.lock"]).code !== 0)
    return {
      code: 1,
      message: `hooks-merge-canary: merged origin/canary as ${merged.slice(0, 7)}, and it changed bun.lock: run \`bun install\`, then \`bun run hooks:bundle\`, and commit the rebuild on its own`,
    }
  const rebuilt = hooksBundle()
  if (rebuilt.code !== 0)
    return {
      code: 1,
      message: `hooks-merge-canary: merged origin/canary as ${merged.slice(0, 7)}, but hooks:bundle failed: ${rebuilt.out}`,
    }
  let done = `merged origin/canary as ${merged.slice(0, 7)}; the bundles already match its sources`
  if (git(["status", "--porcelain", "--", BUNDLED]).out) {
    git(["add", "-A", "--", BUNDLED])
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
    done = `merged origin/canary as ${merged.slice(0, 7)} and committed the rebuilt bundles as ${git(["rev-parse", "--short", "HEAD"]).out}`
  }
  const check = hooksBundle("--check")
  return check.code === 0
    ? { code: 0, message: `hooks-merge-canary: ${done}` }
    : {
        code: 1,
        message: `hooks-merge-canary: ${done}, but hooks:bundle --check fails: ${check.out}`,
      }
}

if (import.meta.main) {
  const { code, message } = mergeCanary()
  console[code ? "error" : "log"](message)
  process.exit(code)
}
