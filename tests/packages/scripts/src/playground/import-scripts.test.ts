import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { importScripts } from "../../../../../packages/scripts/src/playground/import-scripts"
import { mustGit } from "../../../../../packages/settings/src/folder"
import { scopeDir } from "../../../../../packages/settings/src/rendered"

const scratch = mkdtempSync(join(tmpdir(), "import-scripts-"))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

// A made-up ops folder: a job's runner, its helper and config, and the state, lock, cache and old copy it keeps beside them.
const ops = join(scratch, "ops")
mkdirSync(join(ops, "watch", "__pycache__"), { recursive: true })
mkdirSync(join(ops, "empty"), { recursive: true })
for (const [name, text] of [
  ["config.json", '{"places":["made-up"]}'],
  ["owned.json", '{"hours":[9,17]}'],
  ["run.lock", ""],
  ["run.py", "print('watch')\n"],
  ["run.py.edits-wip", "old"],
  ["state.json", '{"seen":1}'],
  ["take.py", "print('take')\n"],
  ["watch.json", "{}"],
])
  writeFileSync(join(ops, "watch", name!), text!)
writeFileSync(join(ops, "empty", "state.json"), "{}")

const run = async (data: string, jobs: string[], dryRun: boolean) => {
  const out: string[] = []
  const code = await importScripts(
    data,
    ops,
    jobs,
    { dryRun, org: "acme", reason: "a made-up reason" },
    (line) => out.push(line),
  )
  return { code, out }
}

test("a job folder becomes one script in its org's folder, its code and config together, and its state stays behind by name", async () => {
  const data = join(scratch, "data")
  const { code, out } = await run(data, ["watch"], false)
  expect(code).toBe(0)
  const dir = scopeDir(data, "acme")
  expect(mustGit(dir, ["ls-files"]).split("\n")).toEqual([
    "scripts/watch/config.json",
    "scripts/watch/owned.json",
    "scripts/watch/run.py",
    "scripts/watch/take.py",
  ])
  expect(readFileSync(join(dir, "scripts/watch/run.py"), "utf8")).toBe("print('watch')\n")
  expect(mustGit(dir, ["log", "-1", "--format=%an|%s"])).toBe("owner|a made-up reason")
  expect(out).toEqual([
    "added script acme watch: config.json, owned.json, run.py, take.py",
    "kept in watch: __pycache__, run.lock, run.py.edits-wip, state.json, watch.json",
  ])
  expect((await run(data, ["watch"], false)).code).toBe(0)
  expect(mustGit(dir, ["rev-list", "--count", "HEAD"])).toBe("1")
})

test("a dry run writes nothing, and a folder with no code is refused, exit 1", async () => {
  const data = join(scratch, "dry")
  const { code, out } = await run(data, ["watch", "empty"], true)
  expect(existsSync(scopeDir(data, "acme"))).toBe(false)
  expect(code).toBe(1)
  expect(out[0]).toBe("would add script acme watch: config.json, owned.json, run.py, take.py")
  expect(out[2]).toBe(`refused empty: no .py or .sh file in ${join(ops, "empty")}`)
})
