import { existsSync } from "node:fs"
import { join } from "node:path"

import { loginOf, scopeDir } from "../../../settings/src/rendered"

type Versions = {
  claude: string | null
  describe: string | null
  rendered: string | null
  sha: string
}

export const versionLines = ({ claude, describe, rendered, sha }: Versions): string[] => [
  `playground ${describe ?? "untagged"} (${sha})`,
  `store      ${rendered ?? "none rendered"}`,
  `claude     ${claude ?? "not found"}`,
]

// The extensions new sessions read: the login scope's last commit, short.
export const renderedSet = (data: string): string | null => {
  let dir: string
  try {
    dir = scopeDir(data, loginOf(data))
  } catch {
    return null
  }
  return existsSync(join(dir, ".git"))
    ? out(["git", "-C", dir, "rev-parse", "--short", "HEAD"])
    : null
}

const out = (argv: string[]): string | null => {
  try {
    const run = Bun.spawnSync(argv, { stderr: "ignore" })
    return run.exitCode === 0 ? run.stdout.toString().trim() || null : null
  } catch {
    return null
  }
}

export const version = (repo: string, data: string): string[] =>
  versionLines({
    claude: out(["claude", "--version"])?.split(/\s+/)[0] ?? null,
    describe: out(["git", "-C", repo, "describe", "--tags"]),
    rendered: renderedSet(data),
    sha: out(["git", "-C", repo, "rev-parse", "HEAD"]) ?? "no commit",
  })
