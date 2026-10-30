import { existsSync } from "node:fs"
import { join } from "node:path"

// A user install keeps the database's settings in the Dashboard's checkout under the clone root (dashboardPath in packages/scripts/src/playground/probe.ts), so `bun run ask` there with no POSTGRES_URL runs as that checkout's ask, whose guards judge its own .env and branch; imported before @packages/env/db validates.
const desk = join(process.cwd(), ".claude", "worktrees", "desk")
if (!process.env.POSTGRES_URL && existsSync(join(desk, ".env"))) {
  const run = Bun.spawnSync(
    [process.execPath, "run", "--cwd", desk, "ask", ...process.argv.slice(2)],
    {
      stdio: ["inherit", "inherit", "inherit"],
    },
  )
  process.exit(run.exitCode ?? 1)
}
