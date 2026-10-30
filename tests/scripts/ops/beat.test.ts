import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ops = join(import.meta.dir, "..", "..", "..", "scripts", "ops")

const checkout = (env: Record<string, string>, cwd: string, dir = ops) => {
  const run = Bun.spawnSync(
    [
      "python3",
      "-I",
      "-c",
      `import sys; sys.path.insert(0, ${JSON.stringify(dir)}); import beat; print(beat.checkout())`,
    ],
    { cwd, env: { HOME: process.env.HOME ?? "", PATH: process.env.PATH ?? "", ...env } },
  )
  expect(run.exitCode).toBe(0)
  return run.stdout.toString().trim()
}

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "beat-checkout-")))

test("checkout() is PLAYGROUND_REPO first", () => {
  expect(checkout({ PLAYGROUND_REPO: "/set/by/env" }, scratch())).toBe("/set/by/env")
})

test("checkout() is the main checkout of the folder it runs in, from a worktree too", () => {
  const main = scratch()
  mkdirSync(join(main, "scripts"))
  writeFileSync(join(main, "scripts", "spawn.sh"), "")
  const git = (...args: string[]) =>
    expect(Bun.spawnSync(["git", "-C", main, ...args]).exitCode).toBe(0)
  git("init", "-q")
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "t")
  const tree = join(main, "wt")
  git("worktree", "add", "-q", tree, "-b", "wt")
  expect(checkout({}, tree)).toBe(main)
})

test("checkout() is its own checkout where the job's folder is none, else the code root's playground", () => {
  const code = scratch()
  const copy = join(code, "copy", "scripts", "ops")
  mkdirSync(copy, { recursive: true })
  writeFileSync(join(copy, "beat.py"), readFileSync(join(ops, "beat.py")))
  const from = (dir: string) => checkout({ HOME: scratch() }, scratch(), dir)
  expect(from(copy)).toBe(join(code, "playground"))
  writeFileSync(join(code, "copy", "scripts", "spawn.sh"), "")
  expect(from(copy)).toBe(join(code, "copy"))
})
