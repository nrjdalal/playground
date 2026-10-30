import { branchOf, checkoutRoot } from "@/lib/dashboard/fixture"
import { livePair } from "@/lib/dev/live-dashboard"

// The upstream is fetched at most this often, and only while the System report is being read.
export const FETCH_EVERY_MS = 10 * 60 * 1000

export type Upstream = "canary" | "main"

// How far the running build is behind the branch its checkout follows: `behind` commits on origin/<upstream> it lacks, the newest of them (or the upstream's head when none), and `pulled` once the checkout's HEAD has moved since the build started, so only a restart is left.
export type Update = {
  behind: number
  branch: string
  // Whether the branch is the live dashboard's (live.branch), whose runner rolls it to each new build.
  live: boolean
  newest: { at: string; title: string }
  pulled: boolean
  upstream: Upstream
}

export type UpdateRead = { problem: string | null; update: Update | null }

// Pure: the branch a checkout's branch follows on origin. The live dashboard's branch runs canary's latest head.
export function upstreamOf(branch: string | null, live = livePair().branch): Upstream | null {
  if (branch === "main") return "main"
  if (branch === "canary" || branch === live) return "canary"
  return null
}

export type UpdateGit = {
  // The checkout's branch and HEAD as the build starts, read once; null with no git checkout.
  start: () => { branch: string | null; head: string | null } | null
  // Fetches origin/<upstream>, then counts what `start`'s head lacks of it, and whether the HEAD on disk now holds all of it.
  compare: (
    upstream: Upstream,
    head: string,
  ) => Promise<{ behind: number; newest: Update["newest"]; pulled: boolean }>
}

// The update check's life: a read answers from the last check at once and starts the next one in the background when FETCH_EVERY_MS has passed since the last began, so no request waits on git.
export class UpdateCheck {
  private began = Number.NEGATIVE_INFINITY
  private last: UpdateRead = { problem: null, update: null }
  private running = false
  private readonly started: ReturnType<UpdateGit["start"]>

  // The start is read as the API starts, so a pull before anyone reads the report still counts against the build that runs.
  constructor(
    private readonly git: UpdateGit,
    private readonly now: () => number = Date.now,
  ) {
    this.started = git.start()
  }

  read(): UpdateRead {
    const now = this.now()
    if (!this.running && now - this.began >= FETCH_EVERY_MS) {
      this.began = now
      this.running = true
      void this.check().finally(() => {
        this.running = false
      })
    }
    return this.last
  }

  private async check(): Promise<void> {
    // A build with no checkout, a named branch that follows neither main nor canary, or a detached HEAD has nothing to check, which is not a fault: it says nothing. A HEAD that cannot be read is a fault, checked first unless the branch is named and follows neither.
    if (!this.started) return
    const { branch, head } = this.started
    const live = livePair().branch
    const upstream = upstreamOf(branch, live)
    if (branch && !upstream) return
    if (!head) {
      this.last = { problem: "Update check: the checkout's HEAD cannot be read", update: null }
      return
    }
    if (!branch || !upstream) return
    try {
      const found = await this.git.compare(upstream, head)
      this.last = {
        problem: null,
        update: {
          behind: found.behind,
          branch,
          live: branch === live,
          newest: found.newest,
          pulled: found.pulled,
          upstream,
        },
      }
    } catch (error) {
      this.last = {
        problem: `Update check: ${error instanceof Error ? error.message : String(error)}`,
        update: null,
      }
    }
  }
}

const git = async (root: string, args: string[]): Promise<string> => {
  const child = Bun.spawn(["git", ...args], {
    cwd: root,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
    timeout: 60_000,
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) {
    throw new Error(`git ${args[0]} failed: ${err.trim().split("\n")[0] || `exit ${code}`}`)
  }
  return out.trim()
}

const headOf = (root: string): string | null => {
  const read = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: root,
    stderr: "ignore",
    stdin: "ignore",
  })
  return read.exitCode === 0 ? read.stdout.toString().trim() || null : null
}

// A checkout's git: a fetch of the one branch it follows, which moves only origin/<upstream>, never the working tree.
export const gitOf = (root: string | null): UpdateGit => ({
  start: () => (root ? { branch: branchOf(root), head: headOf(root) } : null),
  compare: async (upstream, head) => {
    if (!root) throw new Error("this build has no git checkout")
    const ref = `origin/${upstream}`
    const lacks = async (from: string) =>
      Number(await git(root, ["rev-list", "--count", `${from}..${ref}`]))
    await git(root, ["fetch", "--quiet", "--no-tags", "origin", upstream])
    const behind = await lacks(head)
    const [at = "", title = ""] = (await git(root, ["log", "-1", "--format=%cI%x00%s", ref])).split(
      "\0",
    )
    // Pulled: the HEAD on disk has moved and holds everything upstream, so only a restart is left; a local commit or a reset is not a pull.
    const now = headOf(root)
    const pulled = behind > 0 && now !== null && now !== head && (await lacks(now)) === 0
    return { behind, newest: { at, title }, pulled }
  },
})

const CHECK_KEY = Symbol.for("playground.dashboard.update.check")
const kept = globalThis as { [CHECK_KEY]?: UpdateCheck }

// One check per process: a bun --hot reload re-evaluates this module, and a fresh check would take a pulled HEAD as the build's start and fetch again.
export const processCheck = (git: UpdateGit): UpdateCheck =>
  (kept[CHECK_KEY] ??= new UpdateCheck(git))

export const updateCheck = processCheck(gitOf(checkoutRoot()))
