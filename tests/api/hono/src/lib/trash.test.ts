import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { discard, trashRoots } from "../../../../../api/hono/src/lib/trash"
import { listTrash } from "../../../../../packages/safe-delete/src"

const root = mkdtempSync(join(tmpdir(), "trash-"))
afterAll(() => rmSync(root, { force: true, recursive: true }))

const ROOTS = {
  home: join(root, "home"),
  main: join(root, "main"),
  trash: join(root, "data", "trash"),
}

test("discard moves a folder into the trash of the roots given, and a path nothing stands at is no refusal", () => {
  const folder = join(root, "work", "old")
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, "a.txt"), "a")
  expect(discard(folder, { reason: "test", session: "trash-test" }, ROOTS)).toBeNull()
  expect(existsSync(folder)).toBe(false)
  const [entry] = listTrash(ROOTS.trash)
  expect(entry).toMatchObject({ path: folder, reason: "test", session: "trash-test" })
  expect(existsSync(join(ROOTS.trash, entry!.id, "old", "a.txt"))).toBe(true)
  expect(
    discard(join(root, "work", "none"), { reason: "test", session: "trash-test" }, ROOTS),
  ).toBeNull()
})

test("discard answers a protected path's refusal in its words and leaves it in place", () => {
  const folder = join(ROOTS.main, "src")
  mkdirSync(folder, { recursive: true })
  expect(discard(folder, { reason: "test", session: "trash-test" }, ROOTS)).toContain(
    "inside the main checkout",
  )
  expect(existsSync(folder)).toBe(true)
})

test("trashRoots names HOME, the main checkout of the folder given and the trash in the data folder", () => {
  const saved = process.env.PLAYGROUND_DATA_DIR
  process.env.PLAYGROUND_DATA_DIR = join(root, "data")
  try {
    const roots = trashRoots(root)
    expect(roots).toEqual({
      home: process.env.HOME!,
      main: root,
      trash: join(root, "data", "trash"),
    })
  } finally {
    if (saved === undefined) delete process.env.PLAYGROUND_DATA_DIR
    else process.env.PLAYGROUND_DATA_DIR = saved
  }
})
