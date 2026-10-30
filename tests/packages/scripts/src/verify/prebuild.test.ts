import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import {
  isMainCheckout,
  sourcesIn,
  unbuilt,
  workspaceImports,
} from "../../../../../packages/scripts/src/verify/prebuild"

const ROOT = join(import.meta.dir, "../../../../..")

// A workspace package resolves through its built dist, which a fresh worktree lacks until something builds it.
test("bun run verify builds the workspace packages it imports before it runs, when they are unbuilt", async () => {
  const pkg = await Bun.file(join(ROOT, "package.json")).json()
  expect(pkg.scripts.verify).toBe(
    "bun packages/scripts/src/verify/prebuild.ts && bun packages/scripts/src/verify/cli.ts",
  )
})

// From a checkout whose dist predates an export, pr:merge --explain stopped on "Cannot find module '@packages/config/verdicts'".
test("bun run pr:merge and pr:train build the workspace packages pr-merge imports before they run, when they are unbuilt", async () => {
  const pkg = await Bun.file(join(ROOT, "package.json")).json()
  expect(pkg.scripts["pr:merge"]).toBe(
    "bun packages/scripts/src/verify/prebuild.ts pr-merge && bun --no-env-file packages/scripts/src/pr-merge/cli.ts",
  )
  expect(pkg.scripts["pr:train"]).toBe(
    "bun packages/scripts/src/verify/prebuild.ts pr-merge && bun --no-env-file packages/scripts/src/pr-merge/train-cli.ts",
  )
})

// The live dashboard's roll onto a new head once stopped on "Cannot find module '@packages/config/org'": the launcher loads the API before turbo builds. The running-stack check comes first, since the build cleans the dist a running stack imports, and neither loads .env, which the launcher does not load either.
test("bun run dev checks for a running stack, then builds the workspace packages the API imports when they are unbuilt, before the launcher runs", async () => {
  const pkg = await Bun.file(join(ROOT, "package.json")).json()
  expect(pkg.scripts.dev).toStartWith(
    "bun --no-env-file api/hono/src/bin/dev-running.ts start && bun --no-env-file packages/scripts/src/verify/prebuild.ts api && ",
  )
})

test("prebuild given api reads the API's sources, and exits 0 once they are built", async () => {
  const imports = workspaceImports(await sourcesIn("api"))
  expect(imports).toContain("@packages/config/org")
  expect(imports).toContain("@packages/env/data-dir")
  const run = Bun.spawnSync(["bun", join(ROOT, "packages/scripts/src/verify/prebuild.ts"), "api"], {
    cwd: ROOT,
  })
  expect(run.exitCode).toBe(0)
})

test("every workspace package the API imports is a dependency of @api/hono, so its build covers it", async () => {
  const pkg = await Bun.file(join(ROOT, "api/hono/package.json")).json()
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  const imported = workspaceImports(await sourcesIn("api")).map((specifier) =>
    specifier.split("/").slice(0, 2).join("/"),
  )
  expect(imported.length).toBeGreaterThan(0)
  expect(imported.filter((name) => !declared.includes(name))).toEqual([])
})

test("prebuild given pr-merge reads pr-merge's own sources, and exits 0 once they are built", async () => {
  expect(workspaceImports(await sourcesIn("pr-merge"))).toContain("@packages/config/verdicts")
  const run = Bun.spawnSync(
    ["bun", join(ROOT, "packages/scripts/src/verify/prebuild.ts"), "pr-merge"],
    {
      cwd: ROOT,
    },
  )
  expect(run.exitCode).toBe(0)
})

test("isMainCheckout is the factory's main checkout alone, by real path, so a person's own clone still builds", () => {
  const dir = mkdtempSync(join(tmpdir(), "prebuild-main-"))
  try {
    symlinkSync(ROOT, join(dir, "link"))
    expect(isMainCheckout(ROOT, join(dir, "link"))).toBe(true)
    expect(isMainCheckout(ROOT, undefined)).toBe(false)
    expect(isMainCheckout(ROOT, dir)).toBe(false)
    expect(isMainCheckout(ROOT, join(dir, "missing"))).toBe(false)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test("in the factory's main checkout prebuild stops before any build and says where to run it", () => {
  const dir = mkdtempSync(join(tmpdir(), "prebuild-stop-"))
  try {
    writeFileSync(join(dir, "cli.ts"), 'import "@packages/config/nope"\n')
    const run = Bun.spawnSync(
      [
        "bun",
        join(ROOT, "packages/scripts/src/verify/prebuild.ts"),
        relative(join(ROOT, "packages/scripts/src"), dir),
      ],
      { cwd: ROOT, env: { ...process.env, PLAYGROUND_REPO: ROOT } },
    )
    expect(run.exitCode).toBe(1)
    expect(run.stderr.toString()).toContain("run it from your own worktree")
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test("workspaceImports finds static, dynamic and bare imports of workspace packages", () => {
  expect(
    workspaceImports([
      'import { site } from "@packages/config/site"\nimport type { X } from "@packages/env"\nexport const x: X = site',
      'const db = await import("@packages/db")\nimport "@packages/auth/access"\nimport { a } from "./map"\nexport { a, db }',
    ]),
  ).toEqual(["@packages/config/site", "@packages/db", "@packages/auth/access"])
})

// Two packages alike but for their dist, since Bun caches a resolution for the life of the process.
test("unbuilt names a package whose exports target is missing, and passes one whose file is there", () => {
  const dir = mkdtempSync(join(tmpdir(), "prebuild-"))
  try {
    for (const name of ["unbuilt", "built"]) {
      const pkg = join(dir, "node_modules/@packages", name)
      mkdirSync(join(pkg, "dist"), { recursive: true })
      writeFileSync(
        join(pkg, "package.json"),
        JSON.stringify({ exports: { ".": "./dist/index.mjs" }, name: `@packages/${name}` }),
      )
    }
    writeFileSync(join(dir, "node_modules/@packages/built/dist/index.mjs"), "export {}\n")
    expect(unbuilt(["@packages/unbuilt", "@packages/built"], dir)).toEqual(["@packages/unbuilt"])
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test("every workspace package verify or pr-merge imports is a dependency of @packages/scripts, so its build covers it", async () => {
  const pkg = await Bun.file(join(ROOT, "packages/scripts/package.json")).json()
  const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
  for (const sources of [await sourcesIn("verify"), await sourcesIn("pr-merge")]) {
    const imported = workspaceImports(sources).map((specifier) =>
      specifier.split("/").slice(0, 2).join("/"),
    )
    expect(imported.length).toBeGreaterThan(0)
    expect(imported.filter((name) => !declared.includes(name))).toEqual([])
  }
})
