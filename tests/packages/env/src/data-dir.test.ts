import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dataDir, dataDirOf } from "../../../../packages/env/src/data-dir"

let home = ""

afterEach(() => rmSync(home, { force: true, recursive: true }))

const scratch = (...folders: string[]): string => {
  home = mkdtempSync(join(tmpdir(), "data-dir-"))
  for (const folder of folders) mkdirSync(join(home, folder), { recursive: true })
  return home
}

describe("dataDirOf", () => {
  test("with no PLAYGROUND_DATA_DIR, the data folder is .playground in the home folder", () => {
    expect(dataDirOf({}, scratch())).toBe(join(home, ".playground"))
  })

  test("Claude's config folder never places it, and an older folder is never read in its place", () => {
    const at = scratch(".playground", "config/playground")
    expect(dataDirOf({ CLAUDE_CONFIG_DIR: join(at, "config") }, at)).toBe(join(at, ".playground"))
    expect(dataDir({ CLAUDE_CONFIG_DIR: join(at, "config"), HOME: at })).toBe(
      join(at, ".playground"),
    )
  })

  test("PLAYGROUND_DATA_DIR names it outright, resolved to an absolute path", () => {
    expect(dataDirOf({ PLAYGROUND_DATA_DIR: "/data/dashboard" }, scratch())).toBe("/data/dashboard")
    expect(dataDirOf({ PLAYGROUND_DATA_DIR: "rel" }, home)).toBe(join(process.cwd(), "rel"))
  })
})

test("Bun loads it from its source, so a script run beside a dist built before a move reads today's folder", () => {
  const root = join(import.meta.dir, "../../../..")
  expect(Bun.resolveSync("@packages/env/data-dir", join(root, "packages/scripts"))).toBe(
    join(root, "packages/env/src/data-dir.ts"),
  )
})
