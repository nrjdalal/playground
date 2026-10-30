import "@packages/env/load-dotenv"
import { definePackageConfig } from "@packages/config/tsdown"
import { getSafeEnv } from "@packages/env"

// First run's setup mode builds this package before any database exists, so the build checks POSTGRES_URL once one is set; the package still requires it when it connects.
const { env } = process.env.POSTGRES_URL ? await import("@packages/env/db") : { env: {} }

export default definePackageConfig({
  name: "@packages/db",
  env,
  getSafeEnv,
  deps: { neverBundle: ["bun"] },
})
