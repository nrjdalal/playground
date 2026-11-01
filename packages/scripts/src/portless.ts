// Derives each app's public URLs from portless's PORTLESS_URL (worktree branch included) and injects them before spawning the real dev command; a transparent pass-through when PORTLESS_URL is unset (PORTLESS=0, CI).
import "../../env/src/aliases"

// Toggle the adjacent `api.` label (it sits just before the two base labels) to get the sibling app's host. Assumes the two-app `<name>` / `api.<name>` naming from the package.json `portless.name`s (convert.ts keeps forks in sync) and a single-label worktree prefix; a branch literally named `api` would be misread as the api host. Update this if that scheme changes.
export function deriveUrls(portlessUrl: string): { web: string; api: string } {
  const labels = new URL(portlessUrl).hostname.split(".")
  const apiIdx = labels.length - 3
  const isApi = apiIdx >= 0 && labels[apiIdx] === "api"
  const webLabels = isApi ? labels.toSpliced(apiIdx, 1) : labels
  const apiLabels = isApi ? labels : labels.toSpliced(labels.length - 2, 0, "api")
  const toOrigin = (host: string[]) => {
    const url = new URL(portlessUrl)
    url.hostname = host.join(".")
    return url.origin
  }
  return { web: toOrigin(webLabels), api: toOrigin(apiLabels) }
}

// The URLs each app is told: its own and its sibling's, from PORTLESS_URL. With bare set (the live dashboard, PLAYGROUND_BARE_NAMES from the dev launcher) the API also trusts the bare web origin its aliases give it, its branch prefix dropped; the apps keep their own names, so they work whatever the aliases hold.
export function overridesFor(portlessUrl: string, bare = false): Record<string, string> {
  const { web, api } = deriveUrls(portlessUrl)
  const origins = [web]
  if (bare) {
    const url = new URL(web)
    url.hostname = url.hostname.split(".").slice(1).join(".")
    origins.push(url.origin)
  }
  return {
    HONO_APP_URL: api,
    HONO_TRUSTED_ORIGINS: origins.join(","),
    NEXT_PUBLIC_API_URL: api,
    NEXT_PUBLIC_APP_URL: web,
  }
}

if (import.meta.main) {
  const cmd = process.argv.slice(2)
  if (cmd.length === 0) {
    console.error("portless: no command given")
    process.exit(1)
  }

  const portlessUrl = process.env.PORTLESS_URL
  const overrides = portlessUrl
    ? overridesFor(portlessUrl, process.env.PLAYGROUND_BARE_NAMES === "1")
    : {}

  const proc = Bun.spawn(cmd, {
    env: { ...process.env, ...overrides },
    stdio: ["inherit", "inherit", "inherit"],
  })
  const stop = () => proc.kill()
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  process.exit((await proc.exited) ?? 1)
}
