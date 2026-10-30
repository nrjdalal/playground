import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { guardListExit } from "../../../../../packages/scripts/src/playground/guard-list"
import { writeRoot } from "../../../../../packages/settings/src/folder"
import { extensionsDir } from "../../../../../packages/settings/src/rendered"

const scratch = mkdtempSync(join(tmpdir(), "guard-list-cli-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// A checkout's hooks folder holding the list's copy, when given.
const hooks = (name: string, text?: string): string => {
  const dir = join(scratch, name, "hooks")
  mkdirSync(dir, { recursive: true })
  if (text !== undefined) writeFileSync(join(dir, "glm-refused-sources.json"), text)
  return dir
}
const exit = async (args: (string | undefined)[], data: string, folder: string) => {
  const out: string[] = []
  const err: string[] = []
  const code = await guardListExit(
    args[0],
    args[1],
    { PLAYGROUND_DATA_DIR: data },
    (l) => out.push(l),
    (l) => err.push(l),
    folder,
  )
  return { code, err: err.join("\n"), out: out.join("\n") }
}

test("with no extensions, it prints the checkout's copy", async () => {
  const r = await exit(
    ["spawn.sh", "glm-refused-sources"],
    join(scratch, "none"),
    hooks("copy", '["acme-db"]'),
  )
  expect(r).toEqual({ code: 0, err: "", out: '["acme-db"]' })
})

test("with no extensions and no copy, it prints the empty default", async () => {
  const r = await exit(["spawn.sh", "glm-refused-sources"], join(scratch, "bare"), hooks("bare"))
  expect(r).toEqual({ code: 0, err: "", out: "[]" })
})

test("with extensions, it prints their rendered list over the checkout's copy", async () => {
  const data = join(scratch, "rendered")
  writeRoot(extensionsDir(data), new Map([["hooks/glm-refused-sources.json", '["notion"]']]))
  const r = await exit(["spawn.sh", "glm-refused-sources"], data, hooks("over", '["acme-db"]'))
  expect(r).toEqual({ code: 0, err: "", out: '["notion"]' })
})

test.each([
  ["lack the list", new Map<string, string>(), "holds no hooks/glm-refused-sources.json"],
  ["hold one that is not words", new Map([["hooks/glm-refused-sources.json", "{}"]]), "wrong type"],
])("extensions that %s exit 2 with the refusal", async (name, files, says) => {
  const data = join(scratch, name.replaceAll(" ", "-"))
  writeRoot(extensionsDir(data), files)
  mkdirSync(extensionsDir(data), { recursive: true })
  const r = await exit(["spawn.sh", "glm-refused-sources"], data, hooks(`${name}-copy`, "[]"))
  expect(r.code).toBe(2)
  expect(r.err).toContain("spawn.sh hook refused this call")
  expect(r.err).toContain(says)
  expect(r.out).toBe("")
})

test.each([
  [[undefined, undefined], "usage: bun packages/scripts/src/playground/guard-list.ts"],
  [["spawn.sh", "no-such-list"], "no guard list no-such-list"],
])("%j exits 2 naming why", async (args, says) => {
  const r = await exit(args, join(scratch, "none"), hooks("args"))
  expect(r.code).toBe(2)
  expect(r.err).toContain(says)
})
