import { defineConfig } from "tsdown"

export default defineConfig({
  entry: [
    "src/console.ts",
    "src/inbox.ts",
    "src/kinds.ts",
    "src/org.ts",
    "src/schedule.ts",
    "src/session-state.ts",
    "src/site.ts",
    "src/threads.ts",
    "src/verdicts.ts",
  ],
  minify: true,
  outDir: "dist",
})
