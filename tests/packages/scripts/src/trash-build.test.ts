import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { SCRIPT, trashBuild } from "../../../../packages/scripts/src/trash-build"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// A mkdtemp machine: HOME with its main checkout and data folder, and a notify that records each line.
const machine = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "trash-build-")))
  dirs.push(root)
  const home = join(root, "home")
  const data = join(home, ".playground")
  const builds = join(data, "ops", "dashboard", "builds")
  mkdirSync(builds, { recursive: true })
  const told: string[] = []
  const deps = {
    notify: (text: string) => void told.push(text),
    roots: { home, main: join(home, "playground"), trash: join(data, "trash") },
  }
  return { builds, data, deps, told }
}

test("moves a folder directly in the builds folder to the trash as the supervisor's session", () => {
  const { builds, data, deps, told } = machine()
  const build = join(builds, "abc")
  mkdirSync(join(build, "web"), { recursive: true })
  expect(trashBuild(build, "a test", deps)).toBeNull()
  expect(existsSync(build)).toBe(false)
  expect(readdirSync(join(data, "trash"))[0]).toEndWith(`-${SCRIPT}`)
  expect(told).toEqual([])
})

test("refuses a path outside the builds folder or deeper in it, keeps it, and tells the dispatcher", () => {
  const { builds, data, deps, told } = machine()
  const elsewhere = join(data, "ops", "dashboard", "staging")
  const deeper = join(builds, "abc", "web")
  for (const path of [elsewhere, deeper]) {
    mkdirSync(path, { recursive: true })
    expect(trashBuild(path, "a test", deps)).toContain(`is not directly in ${builds}`)
    expect(existsSync(path)).toBe(true)
  }
  expect(told).toEqual([
    `${SCRIPT}: ${elsewhere} is not directly in ${builds}, the only folder trash-build takes`,
    `${SCRIPT}: ${deeper} is not directly in ${builds}, the only folder trash-build takes`,
  ])
})
