import { expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"

import {
  importedNames,
  isMainCheckout,
  prebuildStep,
  sourcesIn,
  staleInstall,
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

test("workspaceImports scans a source that starts with a shebang, which Bun's scan throws on", () => {
  expect(
    workspaceImports([
      '#!/usr/bin/env bun\nimport { site } from "@packages/config/site"\nexport const x = site',
    ]),
  ).toEqual(["@packages/config/site"])
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

// pr:merge once stopped on "Export named 'dispatcherSeatOf' not found" in a config dist built before a canary merge added it, the file there all along.
test("unbuilt names a package whose dist lacks a name the sources import, and passes one that exports every name", () => {
  const dir = mkdtempSync(join(tmpdir(), "prebuild-names-"))
  try {
    for (const [name, dist] of [
      ["stale", "const a = 1\nexport { a }\n"],
      ["fresh", "const a = 1, b = 2\nexport { a, b }\n"],
    ]) {
      const pkg = join(dir, "node_modules/@packages", name)
      mkdirSync(join(pkg, "dist"), { recursive: true })
      writeFileSync(
        join(pkg, "package.json"),
        JSON.stringify({ exports: { ".": "./dist/index.mjs" }, name: `@packages/${name}` }),
      )
      writeFileSync(join(pkg, "dist/index.mjs"), dist)
    }
    const names = { "@packages/fresh": ["a", "b"], "@packages/stale": ["a", "b"] }
    expect(unbuilt(["@packages/stale", "@packages/fresh"], dir, names)).toEqual(["@packages/stale"])
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test("importedNames lists the value names each workspace import takes, by their exported names, with no type-only one", () => {
  expect(
    importedNames([
      'import { a, type B, c as d } from "@packages/config/kinds"\nimport type { X } from "@packages/env"\nimport def, { e } from "@packages/db"\nexport { f } from "@packages/config/org"\nimport { g } from "./map"\nexport const y = (q: B, r: X) => [a, d, def, e, g]',
    ]),
  ).toEqual({
    "@packages/config/kinds": ["a", "c"],
    "@packages/config/org": ["f"],
    "@packages/db": ["default", "e"],
  })
})

// pr-merge reaches @packages/config/kinds only through merge.ts, ops-job and ops-tick, outside its own folder.
test("prebuild given pr-merge reads every source it reaches through a relative import, outside its own folder too", async () => {
  expect(workspaceImports(await sourcesIn("pr-merge"))).toContain("@packages/config/kinds")
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

// A made-up worktree: `fresh` has its dependency linked, `added` came with a canary pull after the last install, and `hoisted` finds its own at the root.
const worktree = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "prebuild-install-"))
  writeFileSync(join(dir, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }))
  for (const [name, dep] of [
    ["fresh", "tsdown"],
    ["added", "tsdown"],
    ["hoisted", "typescript"],
  ]) {
    mkdirSync(join(dir, "packages", name), { recursive: true })
    writeFileSync(
      join(dir, "packages", name, "package.json"),
      JSON.stringify({ devDependencies: { [dep]: "catalog:" }, name: `@packages/${name}` }),
    )
  }
  mkdirSync(join(dir, "packages/fresh/node_modules/tsdown"), { recursive: true })
  mkdirSync(join(dir, "node_modules/typescript"), { recursive: true })
  return dir
}

// On 2 Nov pr:merge, run from a worktree installed before canary added @packages/safe-delete, stopped on "tsdown: command not found" partway through its build.
test("staleInstall refuses a worktree whose install predates a package its bun.lock added, naming the package and the install that fixes it", () => {
  const dir = worktree()
  try {
    const refusal = staleInstall("pr-merge", dir) ?? ""
    expect(refusal).toContain("packages/added (tsdown)")
    expect(refusal).not.toContain("packages/fresh")
    expect(refusal).not.toContain("packages/hoisted")
    expect(refusal).toContain(
      `~/.playground/ops/run-slot.sh <your name> -- bun install --ignore-scripts --cwd ${dir}`,
    )
    expect(refusal).toContain("then run pr-merge again")
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test("staleInstall passes a worktree whose every workspace package has its dependencies installed", () => {
  const dir = worktree()
  try {
    mkdirSync(join(dir, "packages/added/node_modules/tsdown"), { recursive: true })
    expect(staleInstall("pr-merge", dir)).toBeNull()
    expect(staleInstall("pr-merge", ROOT)).toBeNull()
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

// On 2 Nov a canary merge made packages/settings depend on @packages/safe-delete while every dist was still built, so the check never ran and pr:merge failed on "Cannot find module".
test("prebuildStep refuses pr-merge on a stale install with every dist built, naming the install, and leaves verify and the API building on", () => {
  const dir = worktree()
  try {
    expect(prebuildStep("pr-merge", [], dir, undefined)).toEqual({
      refused: staleInstall("pr-merge", dir)!,
    })
    expect(prebuildStep("pr-merge", [], dir, undefined)).toMatchObject({
      refused: expect.stringContaining("bun install --ignore-scripts"),
    })
    expect(prebuildStep("verify", [], dir, undefined)).toEqual({ build: [] })
    expect(prebuildStep("api", ["@packages/x"], dir, undefined)).toEqual({ build: ["@packages/x"] })
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test("prebuildStep adds no install and no refusal on an install that matches, building only what is unbuilt", () => {
  const dir = worktree()
  try {
    mkdirSync(join(dir, "packages/added/node_modules/tsdown"), { recursive: true })
    expect(prebuildStep("pr-merge", [], dir, undefined)).toEqual({ build: [] })
    expect(prebuildStep("pr-merge", ["@packages/x"], dir, undefined)).toEqual({
      build: ["@packages/x"],
    })
    expect(prebuildStep("pr-merge", ["@packages/x"], dir, dir)).toMatchObject({
      refused: expect.stringContaining("run it from your own worktree"),
    })
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})

test("bun run pr:merge's prebuild stops on a stale install even with every dist built, and passes once it is installed", () => {
  const dir = worktree()
  try {
    const verify = join(dir, "packages/scripts/src/verify")
    mkdirSync(verify, { recursive: true })
    mkdirSync(join(dir, "packages/scripts/src/pr-merge"))
    cpSync(join(ROOT, "packages/scripts/src/verify/prebuild.ts"), join(verify, "prebuild.ts"))
    cpSync(
      join(ROOT, "packages/scripts/src/shebang.ts"),
      join(dir, "packages/scripts/src/shebang.ts"),
    )
    writeFileSync(join(dir, "packages/scripts/src/pr-merge/cli.ts"), "export const x = 1\n")
    symlinkSync(
      join(ROOT, "packages/scripts/node_modules"),
      join(dir, "packages/scripts/node_modules"),
    )
    const { PLAYGROUND_REPO: _, ...env } = process.env
    const run = () =>
      Bun.spawnSync(["bun", join(verify, "prebuild.ts"), "pr-merge"], { cwd: dir, env })
    const stale = run()
    expect(stale.exitCode).toBe(1)
    expect(stale.stderr.toString()).toContain("packages/added (tsdown)")
    expect(stale.stderr.toString()).toContain("bun install --ignore-scripts")
    mkdirSync(join(dir, "packages/added/node_modules/tsdown"), { recursive: true })
    expect(run().exitCode).toBe(0)
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
})
