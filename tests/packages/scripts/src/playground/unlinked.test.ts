import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { unlinked } from "../../../../../packages/scripts/src/playground/unlinked"

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "unlinked-")))
afterAll(() => rmSync(scratch, { force: true, recursive: true }))

let made = 0
const write = (file: string, body: unknown) => {
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, JSON.stringify(body))
}
const repo = () => {
  const dir = join(scratch, `repo-${++made}`)
  write(join(dir, "package.json"), { devDependencies: { turbo: "^2" }, workspaces: ["packages/*"] })
  write(join(dir, "packages", "settings", "package.json"), {
    dependencies: { "@packages/safe-delete": "workspace:*", zod: "catalog:" },
    devDependencies: { typescript: "catalog:" },
  })
  write(join(dir, "packages", "settings", "node_modules", "zod", "package.json"), {})
  write(join(dir, "packages", "settings", "node_modules", "typescript", "package.json"), {})
  return dir
}

test("names a workspace package's declared dependency no node_modules holds, and leaves out the checkout's own, which link-skills.sh never loads", async () => {
  expect(await unlinked(repo())).toEqual(["packages/settings: @packages/safe-delete"])
})

test("a dependency linked in the package's own node_modules or one above it counts", async () => {
  const dir = repo()
  write(join(dir, "node_modules", "@packages", "safe-delete", "package.json"), {})
  expect(await unlinked(dir)).toEqual([])
})

test("a commit's manifests, by path, stand in for the disk's, against the checkout's links", async () => {
  const dir = repo()
  const manifests = {
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "packages/settings/package.json": JSON.stringify({ dependencies: { zod: "catalog:" } }),
    "packages/new/package.json": JSON.stringify({ dependencies: { kleur: "^4" } }),
    "fixtures/x/package.json": JSON.stringify({ dependencies: { nope: "1" } }),
  }
  expect(await unlinked(dir, manifests)).toEqual(["packages/new: kleur"])
  expect(await unlinked(dir, {})).toEqual([])
})

test("a folder with no package.json declares nothing", async () => {
  expect(await unlinked(join(scratch, "nowhere"))).toEqual([])
})
