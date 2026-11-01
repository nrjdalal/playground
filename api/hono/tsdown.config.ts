import { definePackageConfig } from "@packages/config/tsdown"
import { getSafeEnv } from "@packages/env"
import { env } from "@packages/env/api-hono"

export default definePackageConfig({
  name: "@api/hono",
  // Its top-level entries alone, so a src/bin script that imports from packages/ gets no declaration written beside that file
  tsconfig: "tsconfig.build.json",
  // Scalar's single-file bundle beside the API's code, so /api/docs/scalar.js serves it where no node_modules exist (the Docker image ships bundle/ alone)
  copy: [
    {
      flatten: true,
      from: "node_modules/@scalar/api-reference/dist/browser/standalone.js",
      rename: "scalar.js",
    },
  ],
  env,
  getSafeEnv,
  deps: { alwaysBundle: [/^@packages\//], neverBundle: ["bun"] },
})
