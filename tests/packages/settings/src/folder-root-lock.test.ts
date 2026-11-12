import { afterAll, expect, spyOn, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  deriveRoot,
  extensionsDir,
  rootLocked,
  scopeDir,
  setRootLock,
  type Who,
  withLock,
} from "../../../../packages/settings/src"
import { judgeItem, putItem } from "../../../../packages/settings/src/items"

// The extensions root's file lock: macOS's user immutable flag on the root and everything under it, which withLock alone lifts; a machine with no chflags (Linux) has no lock, so the locked cases run on macOS alone.
process.env.PLAYGROUND_LOGIN = "made-up-me"
const ME = "made-up-me"
const CHFLAGS = Bun.which("chflags")

const scratch = mkdtempSync(join(tmpdir(), "ext-root-lock-"))
afterAll(() => {
  if (CHFLAGS) Bun.spawnSync([CHFLAGS, "-R", "nouchg", scratch])
  rmSync(scratch, { force: true, recursive: true })
})

const OWNER: Who = { actor: "cli", author: "owner", inboxRef: null, reason: "seeded" }
const WORKER: Who = { ...OWNER, author: "made-up-worker", reason: "a new version" }
const REVIEWER: Who = { ...OWNER, author: "made-up-reviewer", reason: "judged" }
const ref = { key: "relay", kind: "script" as const, scope: ME }
const files = (version: string) => ({
  attachments: [],
  body: null,
  files: { "cli.ts": `console.log("${version}")` },
  value: null,
})
const revOf = (outcome: ReturnType<typeof putItem>) => {
  if (!outcome.ok) throw new Error(outcome.message)
  return outcome.rev
}

// A data folder holding one accepted item, its root then locked as playground ext lock locks it.
const lockedData = (name: string) => {
  const data = join(scratch, name)
  revOf(putItem(data, ref, files("v1"), OWNER, true))
  setRootLock(data, true)
  return data
}
// The error code a plain write of the path meets, or null when it lands.
const writeCode = (path: string) => {
  try {
    writeFileSync(path, "x")
    return null
  } catch (error) {
    return (error as NodeJS.ErrnoException).code
  }
}

test.skipIf(!CHFLAGS)(
  "a locked root takes a put and a judge, logs each lift and relock, and stays locked",
  () => {
    const data = lockedData("put-judge")
    const said = spyOn(console, "error")
    try {
      const v2 = revOf(putItem(data, ref, files("v2"), WORKER, false))
      revOf(judgeItem(data, ref, v2, { kind: "score", score: 3 }, REVIEWER))
      const lines = said.mock.calls.map((call) => String(call[0]))
      expect(
        lines.filter((line) => /^extensions' lock: lifted and relocked .+ in \d+ ms$/.test(line)),
      ).toHaveLength(2)
    } finally {
      said.mockRestore()
    }
    expect(rootLocked(extensionsDir(data))).toBe(true)
    expect(writeCode(join(scopeDir(data, ME), "new.json"))).toBe("EPERM")
  },
)

test.skipIf(!CHFLAGS)(
  "a plain write into a locked root meets EPERM at its top, in a scope and in a scope's .git",
  () => {
    const data = lockedData("plain")
    const root = extensionsDir(data)
    const scope = scopeDir(data, ME)
    expect(
      [join(root, "new.json"), join(scope, "new.json"), join(scope, ".git", "new")].map(writeCode),
    ).toEqual(["EPERM", "EPERM", "EPERM"])
  },
)

test.skipIf(!CHFLAGS)("deriveRoot under withLock leaves a locked root locked", () => {
  const data = lockedData("derive")
  withLock(data, () => deriveRoot(data, ME))
  expect(rootLocked(extensionsDir(data))).toBe(true)
  expect(writeCode(join(extensionsDir(data), "new.json"))).toBe("EPERM")
})

test.skipIf(!CHFLAGS)("ext unlock clears the lock, and ext lock sets it again", () => {
  const data = lockedData("unlock")
  setRootLock(data, false)
  expect(rootLocked(extensionsDir(data))).toBe(false)
  expect(writeCode(join(scopeDir(data, ME), "new.json"))).toBeNull()
  setRootLock(data, true)
  expect(rootLocked(extensionsDir(data))).toBe(true)
})

// Every machine, Linux's test job included: a root with no lock takes its writes with no flag call.
test("an unlocked root sees no flag call", () => {
  const bin = join(scratch, "bin")
  const calls = join(scratch, "chflags.calls")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "chflags"), `#!/bin/sh\necho "$@" >> '${calls}'\n`)
  chmodSync(join(bin, "chflags"), 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bin}:${path}`
  try {
    const data = join(scratch, "unlocked")
    const v1 = revOf(putItem(data, ref, files("v1"), OWNER, false))
    revOf(judgeItem(data, ref, v1, { kind: "score", score: 3 }, REVIEWER))
    expect(rootLocked(extensionsDir(data))).toBe(false)
  } finally {
    process.env.PATH = path
  }
  expect(existsSync(calls)).toBe(false)
})
