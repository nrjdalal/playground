import { definePackageConfig } from "@packages/config/tsdown"
import { getSafeEnv } from "@packages/env"
import { env } from "@packages/env/redis"

export default definePackageConfig({
  name: "@packages/redis",
  env,
  getSafeEnv,
  deps: { neverBundle: ["bun"] },
})
