import { definePackageConfig } from "@packages/config/tsdown"
import { getSafeEnv } from "@packages/env"
import { env } from "@packages/env/api-hono"

export default definePackageConfig({
  name: "@api/hono",
  // Scalar's single-file bundle beside the API's code, so /api/docs/scalar.js serves it where no node_modules exist (the Docker image ships bundle/ alone)
  copy: [
    {
      flatten: true,
      from: "node_modules/@scalar/api-reference/dist/browser/standalone.js",
      rename: "scalar.js",
    },
  ],
  env,
  // main.ts beside index.ts: the live dashboard serves main's bundle, which holds first run's setup mode, while Docker and Vercel serve index's
  entry: ["src/index.ts", "src/main.ts"],
  getSafeEnv,
  deps: { alwaysBundle: [/^@packages\//], neverBundle: ["bun"] },
})
