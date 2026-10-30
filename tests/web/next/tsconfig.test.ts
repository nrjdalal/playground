import { expect, test } from "bun:test"
import { join } from "node:path"

const TSCONFIG = join(import.meta.dir, "../../../web/next/tsconfig.json")

// An incremental check keeps passing a call to an API route the rebuilt dist no longer has, since client.ts names AppType without spelling it out; the key stays present, as next build adds incremental: true when it is missing.
test("web/next type-checks without an incremental cache", async () => {
  const { compilerOptions } = await Bun.file(TSCONFIG).json()
  expect(compilerOptions.incremental).toBe(false)
})
