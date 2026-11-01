import { expect, test } from "bun:test"
import { join } from "node:path"

import { definePackageConfig } from "../../../packages/config/tsdown"

const ROOT = join(import.meta.dir, "../../..")

const config = (tsconfig?: string) =>
  definePackageConfig({
    env: {},
    getSafeEnv: () => {},
    name: "x",
    ...(tsconfig ? { tsconfig } : {}),
  })[0]!

test("a package that names a tsconfig builds its declarations from it, else from tsdown's own pick (PG-294)", async () => {
  expect(config().tsconfig).toBeUndefined()
  expect(config("tsconfig.build.json").tsconfig).toBe("tsconfig.build.json")
  const api = await Bun.file(join(ROOT, "api/hono/tsdown.config.ts")).text()
  expect(api).toContain('tsconfig: "tsconfig.build.json",')
})

// tsgo emits a declaration for every file its tsconfig includes and writes one for a file outside the package beside its source, so the API's declaration step includes its top-level entries alone, never a src/bin script that imports from packages/.
test("the API's declarations build from its top-level entries alone, which src/index.ts is one of (PG-294)", async () => {
  const build = await Bun.file(join(ROOT, "api/hono/tsconfig.build.json")).json()
  expect(build.extends).toBe("./tsconfig.json")
  expect(build.include).toEqual(["src/*.ts"])
  expect(new Bun.Glob(build.include[0]).match("src/index.ts")).toBe(true)
  expect(new Bun.Glob(build.include[0]).match("src/bin/ask-from-clone.ts")).toBe(false)
})
