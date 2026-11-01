import { existsSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"

import { livePair } from "@/lib/dev/live-dashboard"

// A user install keeps the database's settings in the Dashboard's checkout, the worktree on live.branch (as dashboardCheckout in packages/scripts/src/playground/probe.ts finds it), so `bun run ask` from the clone root alone with no POSTGRES_URL runs as that checkout's ask, whose guards judge its own .env and branch; imported before @packages/env/db validates.
const liveCheckout = (): string | null => {
  try {
    const root = realpathSync(process.cwd())
    const common = Bun.spawnSync(
      ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: root, stderr: "ignore" },
    )
    if (common.exitCode !== 0) return null
    if (realpathSync(dirname(common.stdout.toString().trim())) !== root) return null
    const listed = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], {
      cwd: root,
      stderr: "ignore",
    })
    if (listed.exitCode !== 0) return null
    const line = `branch refs/heads/${livePair().branch}`
    const found = listed.stdout
      .toString()
      .split("\n\n")
      .find((block) => block.split("\n").includes(line))
      ?.match(/^worktree (.+)$/m)?.[1]
    if (!found || realpathSync(found) === root) return null
    return existsSync(join(found, ".env")) ? found : null
  } catch {
    return null
  }
}

const target = process.env.POSTGRES_URL ? null : liveCheckout()
if (target) {
  const run = Bun.spawnSync(
    [process.execPath, "run", "--cwd", target, "ask", ...process.argv.slice(2)],
    {
      stdio: ["inherit", "inherit", "inherit"],
    },
  )
  process.exit(run.exitCode ?? 1)
}
