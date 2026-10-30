// The GitHub repositories a command acts on, which the PreToolUse hooks share: a repository a word names, and the ones gh falls back to (GH_REPO, then the checkout's remotes).
import type { Env, Text } from "./shell"

export type Repo = { owner: string; repo: string }

export function repoOf(text: Text): Repo | undefined {
  if (text.unknown || text.reads?.length) return undefined
  const parts = text.value
    .trim()
    .replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
    .split("/")
    .filter(Boolean)
  const [owner, repo] = parts.length === 2 ? parts : parts.slice(1, 3)
  return owner && repo ? { owner, repo: repo.replace(/\.git$/, "") } : undefined
}

export function implicitRepos(env: Env, local: Map<string, Text>): (Repo | undefined)[] {
  const fromEnv =
    local.get("GH_REPO") ??
    env.vars.get("GH_REPO") ??
    (env.process.GH_REPO ? { value: env.process.GH_REPO } : undefined)
  const candidates = fromEnv && fromEnv.value !== "" ? [repoOf(fromEnv)] : []
  return [...candidates, ...remotes(env.cwd)]
}

// The owner and name of a remote URL, in any of git's forms (https, ssh, scp-like).
export function remoteRepo(url: string): Repo | undefined {
  const path = /^(?:[a-z][a-z\d+.-]*:\/\/)?(?:[^@/]+@)?[^/:]+[:/](.+)$/i.exec(url.trim())
  const parts = path?.[1].split("/").filter(Boolean) ?? []
  if (parts.length < 2) return undefined
  return { owner: parts[parts.length - 2], repo: parts[parts.length - 1].replace(/\.git$/, "") }
}

export function remotes(cwd: string | undefined): Repo[] {
  if (!cwd) return []
  const git = Bun.spawnSync(["git", "-C", cwd, "config", "--get-regexp", "^remote\\..*\\.url$"], {
    stderr: "ignore",
  })
  if (git.exitCode !== 0) return []
  return git.stdout
    .toString()
    .split("\n")
    .flatMap((line) => {
      const repo = remoteRepo(line.slice(line.indexOf(" ") + 1))
      return repo ? [repo] : []
    })
}
