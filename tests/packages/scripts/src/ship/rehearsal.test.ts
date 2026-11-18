import { afterAll, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { LIMITS, MARKER, makeScratch } from "../../../../../packages/safe-delete/src"
import {
  clearRehearsal,
  newRehearsal,
  REHEARSAL_PREFIX,
} from "../../../../../packages/scripts/src/ship/rehearsal"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})
const tmp = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ship-rehearsal-")))
  dirs.push(root)
  return root
}
// A sparse file of 3 GB, past the trash's 2 GB cap, which takes no real disk.
const big = (dir: string): void => {
  const at = join(dir, "home", ".bun", "cache.bin")
  mkdirSync(join(dir, "home", ".bun"), { recursive: true })
  writeFileSync(at, "")
  truncateSync(at, 3 * 1024 ** 3)
  expect(statSync(at).size).toBeGreaterThan(LIMITS.bytes)
}

describe("ship:rehearsal", () => {
  test("clear removes the rehearsal's own folder past the trash's 2 GB cap", () => {
    const t = tmp()
    const dir = newRehearsal(t)
    expect(dir.startsWith(join(t, REHEARSAL_PREFIX))).toBe(true)
    expect(existsSync(join(dir, MARKER))).toBe(true)
    big(dir)
    expect(clearRehearsal(dir, t)).toBeNull()
    expect(existsSync(dir)).toBe(false)
  })

  test("clear refuses a folder over 2 GB the rehearsal did not make", () => {
    const t = tmp()
    const unmarked = join(t, `${REHEARSAL_PREFIX}130b`)
    big(unmarked)
    expect(clearRehearsal(unmarked, t)).toContain(MARKER)
    const other = makeScratch("test-sandbox-", t)
    big(other)
    expect(clearRehearsal(other, t)).toContain("not a rehearsal folder")
    const deeper = newRehearsal(newRehearsal(t))
    big(deeper)
    expect(clearRehearsal(deeper, t)).toContain("temp folder")
    for (const dir of [unmarked, other, deeper]) expect(existsSync(dir)).toBe(true)
  })

  test("clear takes a legacy folder: ops-r<NNN>, its clone and logs, over 48 hours old, and no near miss", () => {
    const t = tmp()
    const old = new Date(Date.now() - 49 * 60 * 60 * 1000)
    const legacy = (name: string, parts = ["clone", "logs"], at = old): string => {
      const dir = join(t, name)
      mkdirSync(dir)
      for (const part of parts) mkdirSync(join(dir, part))
      utimesSync(dir, at, at)
      return dir
    }
    const taken = legacy(`${REHEARSAL_PREFIX}123b`)
    big(taken)
    utimesSync(taken, old, old)
    expect(clearRehearsal(taken, t)).toBeNull()
    expect(existsSync(taken)).toBe(false)
    const young = legacy(
      `${REHEARSAL_PREFIX}124`,
      undefined,
      new Date(Date.now() - 47 * 60 * 60 * 1000),
    )
    const linkTarget = legacy(`${REHEARSAL_PREFIX}128`)
    const link = join(t, `${REHEARSAL_PREFIX}129`)
    symlinkSync(linkTarget, link)
    const linkedParts = legacy(`${REHEARSAL_PREFIX}130`, [])
    symlinkSync(join(linkTarget, "clone"), join(linkedParts, "clone"))
    symlinkSync(join(linkTarget, "logs"), join(linkedParts, "logs"))
    utimesSync(linkedParts, old, old)
    const kept = [
      legacy(`${REHEARSAL_PREFIX}12`),
      legacy(`${REHEARSAL_PREFIX}x125`),
      legacy(`${REHEARSAL_PREFIX}126`, ["clone"]),
      legacy(`${REHEARSAL_PREFIX}127`, ["logs"]),
      young,
      link,
      linkedParts,
    ]
    for (const dir of kept) expect(clearRehearsal(dir, t)).not.toBeNull()
    for (const dir of [...kept, linkTarget]) expect(existsSync(dir)).toBe(true)
  })

  test("the command makes a folder in its TMPDIR and clears it, and refuses a usage it does not know", () => {
    const t = tmp()
    const run = (...args: string[]) =>
      Bun.spawnSync(["bun", "packages/scripts/src/ship/rehearsal.ts", ...args], {
        cwd: join(import.meta.dir, "..", "..", "..", "..", ".."),
        env: { ...process.env, TMPDIR: t },
      })
    const made = run("new")
    expect(made.exitCode).toBe(0)
    const dir = made.stdout.toString().trim()
    expect(dir.startsWith(join(t, REHEARSAL_PREFIX))).toBe(true)
    big(dir)
    const cleared = run("clear", dir)
    expect(cleared.exitCode).toBe(0)
    expect(existsSync(dir)).toBe(false)
    const kept = run("clear", join(t, "elsewhere"))
    expect(kept.exitCode).toBe(1)
    expect(kept.stderr.toString()).toContain("kept")
    expect(run("remove").exitCode).toBe(1)
  })
})
