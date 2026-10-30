import { join } from "node:path"

import { firstEnv } from "@/lib/dev/first-env"
import { commitRefusal, stackIn, startRefusal } from "@/lib/dev/stop"

// lefthook's pre-commit runs this before the build, which would rebuild packages/* under this checkout's running `bun run dev` and hang it; `bun run dev` runs it as `start` before its prebuild, for the same reason, and there it also writes a fresh checkout's .env, which that prebuild's packages check.
const ROOT = join(import.meta.dir, "../../../..")

const running = stackIn(ROOT)
if (running) {
  console.error(
    process.argv[2] === "start"
      ? `dev: refusing to start: ${startRefusal(running)}`
      : commitRefusal(running),
  )
  process.exit(1)
}
if (process.argv[2] === "start") {
  const fresh = firstEnv(process.env.DEV_ENV_ROOT || ROOT)
  if (fresh) console.error(`dev: ${fresh}`)
}
