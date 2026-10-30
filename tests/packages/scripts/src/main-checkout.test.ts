import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { mainCheckout } from "../../../../packages/scripts/src/main-checkout"

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "main-checkout-")))

const withEnv = <T>(env: { PLAYGROUND_REPO: string | undefined }, fn: () => T): T => {
  const before = process.env.PLAYGROUND_REPO
  if (env.PLAYGROUND_REPO === undefined) delete process.env.PLAYGROUND_REPO
  else process.env.PLAYGROUND_REPO = env.PLAYGROUND_REPO
  try {
    return fn()
  } finally {
    if (before === undefined) delete process.env.PLAYGROUND_REPO
    else process.env.PLAYGROUND_REPO = before
  }
}

test("mainCheckout() is PLAYGROUND_REPO first, then the main checkout of the folder it runs in, then the code root's playground", () => {
  const main = scratch()
  mkdirSync(join(main, "scripts"))
  writeFileSync(join(main, "scripts", "spawn.sh"), "")
  const git = (...args: string[]) =>
    expect(Bun.spawnSync(["git", "-C", main, ...args]).exitCode).toBe(0)
  git("init", "-q")
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "t")
  const tree = join(main, "wt")
  git("worktree", "add", "-q", tree, "-b", "wt")
  expect(withEnv({ PLAYGROUND_REPO: "/set/by/env" }, () => mainCheckout(tree))).toBe("/set/by/env")
  expect(withEnv({ PLAYGROUND_REPO: undefined }, () => mainCheckout(tree))).toBe(main)
  const code = scratch()
  mkdirSync(join(code, "elsewhere"))
  expect(withEnv({ PLAYGROUND_REPO: undefined }, () => mainCheckout(join(code, "elsewhere")))).toBe(
    join(code, "playground"),
  )
})
