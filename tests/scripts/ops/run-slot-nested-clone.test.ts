import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SCRIPT, machine } from "./run-slot-fake"

setDefaultTimeout(60_000)

// PG-655: a clone of a checkout's root node_modules left each workspace's own, so a bun install had to follow it; run-slot now clones those too
const checkout = (dir: string, workspaces: string[] = ["packages/*", "web/*"]) => {
  mkdirSync(join(dir, "packages", "p"), { recursive: true })
  mkdirSync(join(dir, "web", "w"), { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ workspaces }))
}

const clone = async (args: (root: string) => string[]) => {
  const m = machine()
  const from = join(m.root, "from")
  const to = join(m.root, "to")
  checkout(from)
  checkout(to)
  for (const dir of [
    "node_modules/root-dep",
    "packages/p/node_modules/p-dep",
    "web/w/node_modules/.bin",
  ])
    mkdirSync(join(from, dir), { recursive: true })
  writeFileSync(join(from, "web", "w", "node_modules", ".bin", "tool"), "")
  const p = Bun.spawn(["bash", SCRIPT, "worker-c", "--", ...args(m.root)], {
    cwd: m.root,
    env: m.env(),
    stderr: "ignore",
  })
  return { code: await p.exited, from, to }
}

describe("a node_modules clone of a checkout into another", () => {
  test("clones each workspace's own node_modules with the root's", async () => {
    const run = await clone((root) => [
      "cp",
      "-R",
      join(root, "from", "node_modules"),
      join(root, "to") + "/",
    ])
    expect(run.code).toBe(0)
    expect(existsSync(join(run.to, "node_modules", "root-dep"))).toBe(true)
    expect(existsSync(join(run.to, "packages", "p", "node_modules", "p-dep"))).toBe(true)
    expect(existsSync(join(run.to, "web", "w", "node_modules", ".bin", "tool"))).toBe(true)
  })

  test("clones them too when it names the destination's node_modules, behind env", async () => {
    const run = await clone((root) => [
      "env",
      "X=1",
      "cp",
      "-R",
      join(root, "from", "node_modules"),
      join(root, "to", "node_modules"),
    ])
    expect(run.code).toBe(0)
    expect(existsSync(join(run.to, "packages", "p", "node_modules", "p-dep"))).toBe(true)
  })

  test("leaves a workspace that already holds node_modules as it is", async () => {
    const run = await clone((root) => {
      mkdirSync(join(root, "to", "packages", "p", "node_modules", "own"), { recursive: true })
      return ["cp", "-R", join(root, "from", "node_modules"), join(root, "to") + "/"]
    })
    expect(run.code).toBe(0)
    expect(existsSync(join(run.to, "packages", "p", "node_modules", "own"))).toBe(true)
    expect(existsSync(join(run.to, "packages", "p", "node_modules", "node_modules"))).toBe(false)
    expect(existsSync(join(run.to, "web", "w", "node_modules", ".bin", "tool"))).toBe(true)
  })

  test("clones only the root when the destination is no checkout", async () => {
    const run = await clone((root) => [
      "cp",
      "-R",
      join(root, "from", "node_modules"),
      join(root, "loose"),
    ])
    expect(run.code).toBe(0)
    expect(existsSync(join(run.from, "..", "loose", "root-dep"))).toBe(true)
    expect(existsSync(join(run.from, "..", "loose", "packages"))).toBe(false)
  })
})
