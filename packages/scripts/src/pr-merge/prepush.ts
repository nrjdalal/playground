// lefthook's pre-push keeps-canary: refuses a push whose range holds a merge that dropped a line canary added in a file git merges clean, as pr:merge's keeps canary gate would at merge time, from local git alone.

import { BASE, keepsCanary } from "./gates"
import { lostLines } from "./lost"
import { parseMergeTree, runGit, type Run } from "./merge"

const ZERO = /^0+$/

// The refusal for git's pre-push lines (`<local ref> <local sha> <remote ref> <remote sha>`), null when every pushed ref passes: a delete, a range with no merge, and a head that conflicts with canary (the merge gate names it) read nothing more.
export async function prePushRefusal(git: Run, stdin: string): Promise<string | null> {
  const canary = `origin/${BASE}`
  if ((await git(["rev-parse", "--verify", "--quiet", `${canary}^{commit}`])).code !== 0)
    return null
  for (const line of stdin.split("\n")) {
    const [, local, , remote] = line.trim().split(/\s+/)
    if (!local || ZERO.test(local)) continue
    const known =
      remote &&
      !ZERO.test(remote) &&
      (await git(["cat-file", "-e", `${remote}^{commit}`])).code === 0
    const merges = await git([
      "rev-list",
      "--merges",
      local,
      `^${canary}`,
      ...(known ? [`^${remote}`] : []),
    ])
    if (merges.code !== 0 || !merges.stdout.trim()) continue
    const merged = parseMergeTree(
      await git(["merge-tree", "--write-tree", "--name-only", local, canary]),
    )
    if (!merged?.clean) continue
    const gate = keepsCanary(await lostLines(git, canary, local, merged.tree))
    if (!gate.ok) return gate.detail
  }
  return null
}

if (import.meta.main) {
  const refusal = await prePushRefusal(runGit, await Bun.stdin.text())
  if (refusal) {
    console.error(`keeps-canary: ${refusal}`)
    process.exit(1)
  }
}
