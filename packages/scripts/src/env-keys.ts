import { join } from "node:path"

import { gapsRefusal, readEnvGaps } from "@packages/env/gaps"

// Names each required key the checkout's .env lacks or leaves empty, read from @packages/env's schemas, and exits 1 when any is; `bun run test` runs it after the packages build and pre-commit before its build, so a hand-started .env fails here, every gap named at once, rather than in the web tests or the build far from the cause. Each argument names a key it may leave empty: pre-commit names POSTGRES_URL, which the build passes without (measured 1 Nov) and first run's setup fills, while `bun run test` names none, since a test that loads @packages/db's env fails without it.

const root = join(import.meta.dir, "../../..")
const gaps = readEnvGaps(join(root, "api/hono"), process.env, process.argv.slice(2))
if (!gaps.ok) {
  console.error(`env-keys: the schemas could not be read: ${gaps.error}`)
  process.exit(1)
}
if (gaps.missing.length === 0 && gaps.empty.length === 0) process.exit(0)
console.error(`env-keys: ${gapsRefusal(gaps)}`)
process.exit(1)
