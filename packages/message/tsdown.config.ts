import { defineConfig } from "tsdown"

export default defineConfig({
  dts: {},
  entry: ["src/index.ts"],
  minify: true,
  outDir: "dist",
})
