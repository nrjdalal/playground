import { afterAll, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { swapBundles, unswapBundles } from "../../../../packages/scripts/src/swap-bundles"

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "swap-bundles-")))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const env = { GIT_CONFIG_NOSYSTEM: "1", HOME: scratch, PATH: process.env.PATH }
const bundled = join("scripts", "hooks", "bundled")
const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const spawn = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    env,
  })
  return { code: run.exitCode, out: run.stdout.toString() + run.stderr.toString() }
}

// A clone at origin's first commit, with origin's second changing no-raw-delete.js and adding zz-new.js.
const clone = (name: string) => {
  const origin = join(scratch, name, "origin")
  write(join(origin, bundled, "no-raw-delete.js"), "export const old = 1\n")
  spawn(scratch, "init", "-q", "-b", "main", origin)
  spawn(origin, "add", ".")
  spawn(origin, "commit", "-q", "-m", "one")
  const checkout = join(scratch, name, "checkout")
  spawn(scratch, "clone", "-q", origin, checkout)
  write(join(origin, bundled, "no-raw-delete.js"), "export const changed = 2\n")
  write(join(origin, bundled, "zz-new.js"), "export const added = 3\n")
  spawn(origin, "add", ".")
  spawn(origin, "commit", "-q", "-m", "two")
  spawn(checkout, "fetch", "-q", "origin")
  const git = async (...args: string[]) => spawn(checkout, ...args)
  return { checkout, git }
}

// A rename that threw once left its <path>.<pid>.tmp behind, untracked and unignored, so the checkout read dirty and every later pull skipped it.
test("a swap whose rename throws removes its temp file and puts back what it swapped, leaving git status clean", async () => {
  const { checkout, git } = clone("rename-throws")
  // an empty folder git never sees, standing where the target adds zz-new.js, so its rename throws
  mkdirSync(join(checkout, bundled, "zz-new.js"))
  expect((await git("status", "--porcelain")).out).toBe("")
  const result = await swapBundles(checkout, git, "origin/main")
  expect(result.code).not.toBe(0)
  expect(result.swapped).toEqual([])
  expect(readFileSync(join(checkout, bundled, "no-raw-delete.js"), "utf8")).toBe(
    "export const old = 1\n",
  )
  expect(readdirSync(join(checkout, bundled)).filter((file) => file.endsWith(".tmp"))).toEqual([])
  expect((await git("status", "--porcelain")).out).toBe("")
  expect(result.putBack?.code).toBe(0)
})

test("a put-back that cannot rename a bundle back answers non-zero, naming its path", async () => {
  const { checkout, git } = clone("put-back-fails")
  const path = join(bundled, "no-raw-delete.js")
  unlinkSync(join(checkout, path))
  write(join(checkout, path, "inside"), "\n")
  const result = await unswapBundles(checkout, git, [path])
  expect(result.code).toBe(1)
  expect(result.out).toContain(path)
})
