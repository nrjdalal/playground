import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../..")

// definePackageConfig's tsconfig, read in a child whose cwd is the package folder, as tsdown loads a package's config.
const tsconfigIn = (cwd: string): unknown => {
  const child = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      `const { definePackageConfig } = await import(${JSON.stringify(join(ROOT, "packages/config/tsdown.ts"))}); console.log(JSON.stringify(definePackageConfig({ name: "x", env: {}, getSafeEnv: () => {} })[0].tsconfig ?? null))`,
    ],
    { cwd, stderr: "pipe", stdout: "pipe" },
  )
  return JSON.parse(child.stdout.toString())
}

test("a package with a tsconfig.build.json builds its declarations from it, else from tsdown's own pick (PG-294)", () => {
  const dir = mkdtempSync(join(tmpdir(), "tsdown-tsconfig-"))
  expect(tsconfigIn(dir)).toBeNull()
  writeFileSync(join(dir, "tsconfig.build.json"), "{}")
  expect(tsconfigIn(dir)).toBe("tsconfig.build.json")
})

// tsgo emits a declaration for every file its tsconfig includes and writes one for a file outside the package beside its source, so the API's declaration step includes its top-level entries alone, never a src/bin script that imports from packages/.
test("the API's declarations build from its top-level entries alone, which src/index.ts is one of (PG-294)", async () => {
  const build = await Bun.file(join(ROOT, "api/hono/tsconfig.build.json")).json()
  expect(build.extends).toBe("./tsconfig.json")
  expect(build.include).toEqual(["src/*.ts"])
  expect(new Bun.Glob(build.include[0]).match("src/index.ts")).toBe(true)
  expect(new Bun.Glob(build.include[0]).match("src/bin/ask-from-clone.ts")).toBe(false)
})
