import { afterAll, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { toTrash } from "../../../../packages/scripts/src/trash"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

// A mkdtemp machine: a HOME, its main checkout and the data folder's trash.
const machine = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "trash-")))
  dirs.push(root)
  const home = join(root, "home")
  mkdirSync(join(home, "playground"), { recursive: true })
  return { home, main: join(home, "playground"), root, trash: join(home, ".playground", "trash") }
}

test("toTrash moves a folder into the trash root it is given", () => {
  const roots = machine()
  const ui = join(roots.root, "web", "ui")
  mkdirSync(ui, { recursive: true })
  writeFileSync(join(ui, "button.tsx"), "x")
  toTrash(ui, "a test", roots, "j6rjgy-worker")
  expect(existsSync(ui)).toBe(false)
  const [batch] = readdirSync(roots.trash)
  expect(readFileSync(join(roots.trash, batch!, "1", "ui", "button.tsx"), "utf8")).toBe("x")
})

test("toTrash throws a protected path's refusal and leaves it in place", () => {
  const roots = machine()
  const inMain = join(roots.main, "web")
  mkdirSync(inMain, { recursive: true })
  expect(() => toTrash(inMain, "a test", roots, "j6rjgy-worker")).toThrow("main checkout")
  expect(existsSync(inMain)).toBe(true)
})

test("toTrash passes over a path that is not there", () => {
  const roots = machine()
  expect(() => toTrash(join(roots.root, "gone"), "a test", roots, "j6rjgy-worker")).not.toThrow()
  expect(existsSync(roots.trash)).toBe(false)
})
