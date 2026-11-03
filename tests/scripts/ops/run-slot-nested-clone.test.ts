import { describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"

import { clonesOf } from "../../../packages/scripts/src/playground/rm"
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

  test("exits with a failed root clone's code and clones no workspace", async () => {
    const run = await clone((root) => {
      const bare = join(root, "bare")
      checkout(bare)
      mkdirSync(join(bare, "packages", "p", "node_modules", "p-dep"), { recursive: true })
      return ["cp", "-R", join(bare, "node_modules"), join(root, "to") + "/"]
    })
    expect(run.code).not.toBe(0)
    expect(existsSync(join(run.to, "packages", "p", "node_modules"))).toBe(false)
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

// PG-714: a clone's cp works in its destination and only reads its source, so its holder line names both, for playground rm's refusal
describe("a node_modules clone's holder line", () => {
  const holderLine = async (args: (root: string) => string[]) => {
    const m = machine()
    const root = realpathSync(m.root)
    for (const dir of ["from/node_modules", "to"]) mkdirSync(join(root, dir), { recursive: true })
    const seen = join(root, "seen")
    const cp = join(m.bin, "cp")
    writeFileSync(cp, `#!/bin/bash\ncat "${join(m.ops, "run-slot-clone.holder")}" > "${seen}"\n`)
    chmodSync(cp, 0o755)
    const p = Bun.spawn(["bash", SCRIPT, "worker-c", "--", cp, "-cR", ...args(root)], {
      cwd: root,
      env: m.env(),
      stderr: "ignore",
    })
    expect(await p.exited).toBe(0)
    return { line: readFileSync(seen, "utf8"), root }
  }

  test("names the source checkout and the destination, which playground rm reads while the clone runs", async () => {
    const { line, root } = await holderLine((r) => [
      join(r, "from", "node_modules"),
      join(r, "to") + "/",
    ])
    expect(line).toMatch(/^worker-c \d+ \S+\t/)
    expect(clonesOf(line, () => true)).toEqual([
      {
        destination: join(root, "to"),
        pid: Number(line.split(" ")[1]),
        source: join(root, "from"),
        who: "worker-c",
      },
    ])
  })

  test("names them absolute for relative words and a destination's node_modules", async () => {
    const { line, root } = await holderLine(() => ["from/node_modules", "to/node_modules"])
    expect(clonesOf(line, () => true)[0]).toMatchObject({
      destination: join(root, "to"),
      source: join(root, "from"),
    })
  })
})
