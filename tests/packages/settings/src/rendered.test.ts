import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  coreDir,
  currentDir,
  extensionsDir,
  loginOf,
  readRendered,
  scopeDir,
  writeRoot,
  writeTree,
} from "../../../../packages/settings/src"

const scratch = mkdtempSync(join(tmpdir(), "rendered-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

const data = (name: string) => join(scratch, name)

test("a machine with no extensions root reads nothing, so its caller takes its default", async () => {
  expect(await readRendered(data("none"), "policy.json")).toEqual({})
})

test("the root's derived files and a scope's files read back from their folders", async () => {
  writeRoot(extensionsDir(data("one")), new Map([["hooks/a.json", "[]"]]))
  writeTree(data("one"), "acme", new Map([["rules/short.md", "Keep it short."]]), {
    author: "test",
    reason: "seed",
  })
  expect(currentDir(data("one"))).toBe(join(data("one"), "extensions"))
  expect(await readRendered(data("one"), "hooks/a.json")).toEqual({
    path: join(extensionsDir(data("one")), "hooks/a.json"),
  })
  expect(await readRendered(data("one"), "acme/rules/short.md")).toEqual({
    path: join(scopeDir(data("one"), "acme"), "rules/short.md"),
  })
})

test("core reads from the checkout's own extensions/core, beside no link", async () => {
  mkdirSync(extensionsDir(data("core")), { recursive: true })
  expect(coreDir()).toBe(join(import.meta.dir, "../../../../extensions/core"))
  expect(scopeDir(data("core"), "core")).toBe(coreDir())
  expect((await readRendered(data("core"), "core/no-such.md")).refusal).toContain(
    "holds no core/no-such.md",
  )
  expect(existsSync(join(extensionsDir(data("core")), "core"))).toBe(false)
})

test("a root that lacks the file refuses, so a guard fails closed, and an empty root is never none", async () => {
  mkdirSync(extensionsDir(data("bad")), { recursive: true })
  expect((await readRendered(data("bad"), "hooks/b.json")).refusal).toBe(
    `the extensions root (${extensionsDir(data("bad"))}) holds no hooks/b.json: seed the guards' lists with playground ext import --from-tree extensions/core/lists`,
  )
})

test("a path that leaves the root is refused", async () => {
  mkdirSync(extensionsDir(data("escape")), { recursive: true })
  expect((await readRendered(data("escape"), "../escape/policy.json")).refusal).toContain(
    "is not a path inside the extensions",
  )
})

test("the login is PLAYGROUND_LOGIN, else the root's login file, else a refusal naming ext init", () => {
  expect(loginOf(data("login"), { PLAYGROUND_LOGIN: "tester" })).toBe("tester")
  expect(() => loginOf(data("login"), {})).toThrow("run playground ext init")
  mkdirSync(extensionsDir(data("login")), { recursive: true })
  writeFileSync(join(extensionsDir(data("login")), "login"), "octo\n")
  expect(loginOf(data("login"), {})).toBe("octo")
})
