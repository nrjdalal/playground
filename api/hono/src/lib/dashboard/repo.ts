import { checkoutRoot } from "@/lib/dashboard/fixture"

const GITHUB_REMOTE =
  /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/

// Pure: the pull requests page of a GitHub origin remote, over https or ssh, with or without .git; null for any other host or none.
export function pullsUrlOf(remote: string | null): string | null {
  const match = GITHUB_REMOTE.exec(remote?.trim() ?? "")
  return match ? `https://github.com/${match[1]}/${match[2]}/pulls` : null
}

// A pull requests link's repository as owner/repo, the form a pull's own URL carries.
export const repoOf = (pulls: string | null): string | null =>
  pulls ? pulls.replace(/^https:\/\/github\.com\//, "").replace(/\/pulls$/, "") : null

// This checkout's repository as owner/repo, what the Pull requests tab matches the leads' merge queue by: a queue entry's number alone would match any repository's pull. null when the origin is not GitHub's.
export function checkoutRepo(): string | null {
  return repoOf(checkoutPulls())
}

let pulls: { url: string | null } | null = null

// This checkout's origin as a pull requests link, read once: the sidebar's GitHub icon links there.
export function checkoutPulls(): string | null {
  if (!pulls) {
    const root = checkoutRoot()
    const read = root
      ? Bun.spawnSync(["git", "remote", "get-url", "origin"], {
          cwd: root,
          stderr: "ignore",
          stdin: "ignore",
        })
      : null
    pulls = { url: read?.exitCode === 0 ? pullsUrlOf(read.stdout.toString()) : null }
  }
  return pulls.url
}
