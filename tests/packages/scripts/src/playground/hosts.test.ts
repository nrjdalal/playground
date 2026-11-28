import { afterAll, expect, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

import { hostsCli, hostsOf, worktreeOf } from "../../../../../packages/scripts/src/playground/hosts"
import { scratchWorktree } from "../../../../scratch-worktree"

// portless names a stack's hosts from the branch of the folder it runs in, so a tester in the main checkout once read the live dashboard's bare names for its worktree's stack
const { linked, main, root } = scratchWorktree()
const env = { ...process.env, PORTLESS_STATE_DIR: join(root, "portless") }
afterAll(() => rmSync(root, { force: true, recursive: true }))

const host = (url: string) => new URL(url).hostname

test("from outside the worktree, by its path, it gets the worktree's own hosts", () => {
  expect(process.cwd()).not.toBe(linked)
  const hosts = hostsOf(linked, env)
  expect("error" in hosts ? hosts.error : [host(hosts.web), host(hosts.api)]).toEqual([
    "pg-1-made-up-hosts.playground.localhost",
    "pg-1-made-up-hosts.api.playground.localhost",
  ])
})

test("a folder inside the worktree gets the same hosts", () => {
  mkdirSync(join(linked, "sub"), { recursive: true })
  expect(hostsOf(join(linked, "sub"), env)).toEqual(hostsOf(linked, env))
})

test("the main checkout, a folder outside git and a detached worktree are refused, since portless gives each the bare live names", () => {
  const detached = scratchWorktree("PG-2-made-up-detached")
  try {
    Bun.spawnSync(["git", "-C", detached.linked, "checkout", "-q", "--detach"])
    for (const path of [main, root, detached.linked]) {
      const hosts = hostsOf(path, env)
      expect("error" in hosts && hosts.error).toContain("the live dashboard's")
    }
  } finally {
    rmSync(detached.root, { force: true, recursive: true })
  }
})

test("worktreeOf names the linked worktree's top and prefix, and none for the main checkout", () => {
  mkdirSync(join(linked, "sub"), { recursive: true })
  expect([worktreeOf(join(linked, "sub")), worktreeOf(main)]).toEqual([
    { prefix: "pg-1-made-up-hosts", top: linked },
    null,
  ])
})

test("playground hosts prints both URLs, or the one asked, and exits 1 on a refusal", () => {
  const hosts = hostsOf(linked, env)
  if ("error" in hosts) throw new Error(hosts.error)
  expect(hostsCli([linked], main, env)).toEqual({
    code: 0,
    out: `web ${hosts.web}\napi ${hosts.api}`,
  })
  expect(hostsCli([linked, "api"], main, env)).toEqual({ code: 0, out: hosts.api })
  expect(hostsCli(["web"], linked, env)).toEqual({ code: 0, out: hosts.web })
  expect(hostsCli([], main, env).code).toBe(1)
  expect(hostsCli([linked, main], main, env).code).toBe(1)
})
