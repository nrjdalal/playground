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

  test("PLAYGROUND_DATA_DIR names it outright when absolute, and a relative value is refused with why", () => {
    expect(dataDirOf({ PLAYGROUND_DATA_DIR: "/data/dashboard" }, scratch())).toBe("/data/dashboard")
    for (const relative of ["rel", "./rel", "~/rel"])
      expect(() => dataDirOf({ PLAYGROUND_DATA_DIR: relative }, home)).toThrow(
        `PLAYGROUND_DATA_DIR is relative (${relative})`,
      )
  })
})

// #1296: a relative value was read against each process's own folder, so spawn.sh after its cd / and the API in api/hono read two data folders
test("a value read from two working folders gives one path, or the same refusal in both", () => {
  const at = scratch("a", "b")
  const read = (value: string, cwd: string) => {
    const r = Bun.spawnSync(
      [
        process.execPath,
        "--no-env-file",
        "-e",
        `import { dataDir } from ${JSON.stringify(join(import.meta.dir, "../../../../packages/env/src/data-dir.ts"))}; console.log(dataDir())`,
      ],
      { cwd, env: { HOME: at, PATH: process.env.PATH, PLAYGROUND_DATA_DIR: value } },
    )
    return { code: r.exitCode, err: r.stderr.toString(), out: r.stdout.toString().trim() }
  }
  const absolute = [read(join(at, "data"), join(at, "a")), read(join(at, "data"), join(at, "b"))]
  expect(absolute.map((r) => r.out)).toEqual([join(at, "data"), join(at, "data")])
  for (const r of [read("data", join(at, "a")), read("data", join(at, "b"))]) {
    expect(r.code).not.toBe(0)
    expect(r.out).toBe("")
    expect(r.err).toContain("PLAYGROUND_DATA_DIR is relative (data)")
  }
})

test("Bun loads it from its source, so a script run beside a dist built before a move reads today's folder", () => {
  const root = join(import.meta.dir, "../../../..")
  expect(Bun.resolveSync("@packages/env/data-dir", join(root, "packages/scripts"))).toBe(
    join(root, "packages/env/src/data-dir.ts"),
  )
})
